const {
  PharmacyInventory,
  StockTransaction,
  Prescription,
  PrescriptionItem,
  Visit,
  sequelize,
} = require('../models');
const { Op } = require('sequelize');

const STATUS_COLORS = {
  pending: '#d97706',
  partially_dispensed: '#0284c7',
  dispensed: '#059669',
  unavailable: '#e11d48',
};

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function buildHourlySlots() {
  const endHour = new Date().getHours();
  const slots = [];
  for (let h = 0; h <= endHour; h += 1) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
  }
  return slots;
}

function mapHourlyCounts(rows, hourKey = 'hour', countKey = 'count') {
  const byHour = {};
  for (const row of rows) {
    const h = Number(row[hourKey]);
    if (!Number.isNaN(h)) byHour[h] = Number(row[countKey]) || 0;
  }
  return byHour;
}

function formatStatusLabel(status) {
  const labels = {
    pending: 'Pending',
    partially_dispensed: 'Partial',
    dispensed: 'Dispensed',
    unavailable: 'Unavailable',
  };
  return labels[status] || status;
}

async function getSupervisorMetrics(facilityId) {
  const today = startOfDay();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const hourSlots = buildHourlySlots();

  const [
    totalMedications,
    lowStockItems,
    pendingPrescriptions,
    dispensedToday,
    receivedTodayRow,
    receivedHourRows,
    dispensedHourRows,
    categoryRows,
    statusRows,
    topLowStock,
  ] = await Promise.all([
    PharmacyInventory.count({ where: { facility_id: facilityId } }),
    PharmacyInventory.findAll({
      where: {
        facility_id: facilityId,
        [Op.and]: [
          sequelize.where(
            sequelize.col('quantity_in_stock'),
            Op.lte,
            sequelize.col('reorder_level')
          ),
        ],
      },
      order: [['quantity_in_stock', 'ASC']],
      limit: 20,
    }),
    Prescription.count({
      where: { status: { [Op.in]: ['pending', 'partially_dispensed'] } },
      include: [
        {
          association: 'visit',
          required: true,
          attributes: [],
          where: { facility_id: facilityId },
        },
      ],
    }),
    Prescription.count({
      where: {
        status: 'dispensed',
        created_at: { [Op.gte]: today, [Op.lt]: tomorrow },
      },
      include: [
        {
          association: 'visit',
          required: true,
          attributes: [],
          where: { facility_id: facilityId },
        },
      ],
    }),
    sequelize.query(
      `
      SELECT COALESCE(SUM(st.quantity), 0) AS total_units
      FROM stock_transactions st
      INNER JOIN pharmacy_inventory pi ON pi.id = st.inventory_id
      WHERE pi.facility_id = :facilityId
        AND st.type = 'received'
        AND st.status = 'confirmed'
        AND st.confirmed_at >= :today AND st.confirmed_at < :tomorrow
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT HOUR(st.confirmed_at) AS hour, SUM(st.quantity) AS count
      FROM stock_transactions st
      INNER JOIN pharmacy_inventory pi ON pi.id = st.inventory_id
      WHERE pi.facility_id = :facilityId
        AND st.type = 'received'
        AND st.status = 'confirmed'
        AND st.confirmed_at >= :today AND st.confirmed_at < :tomorrow
      GROUP BY HOUR(st.confirmed_at)
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT HOUR(st.created_at) AS hour, COUNT(*) AS count
      FROM stock_transactions st
      INNER JOIN pharmacy_inventory pi ON pi.id = st.inventory_id
      WHERE pi.facility_id = :facilityId
        AND st.type = 'dispensed'
        AND st.created_at >= :today AND st.created_at < :tomorrow
      GROUP BY HOUR(st.created_at)
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    PharmacyInventory.findAll({
      where: { facility_id: facilityId },
      attributes: [
        'category',
        [sequelize.fn('SUM', sequelize.col('quantity_in_stock')), 'total_qty'],
      ],
      group: ['category'],
      raw: true,
    }),
    Prescription.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('Prescription.id')), 'count'],
      ],
      include: [
        {
          association: 'visit',
          required: true,
          attributes: [],
          where: { facility_id: facilityId },
        },
      ],
      group: ['status'],
      raw: true,
    }),
    PharmacyInventory.findAll({
      where: {
        facility_id: facilityId,
        [Op.and]: [
          sequelize.where(
            sequelize.col('quantity_in_stock'),
            Op.lte,
            sequelize.col('reorder_level')
          ),
        ],
      },
      order: [['quantity_in_stock', 'ASC']],
      limit: 8,
      attributes: ['medication_name', 'quantity_in_stock', 'reorder_level', 'unit'],
    }),
  ]);

  const receivedByHour = mapHourlyCounts(receivedHourRows);
  const dispensedByHour = mapHourlyCounts(dispensedHourRows);

  const stockReceivedVelocity = hourSlots.map((hour) => {
    const h = parseInt(hour.slice(0, 2), 10);
    return { hour, count: receivedByHour[h] || 0 };
  });

  const hourlyDispensed = hourSlots.map((hour) => {
    const h = parseInt(hour.slice(0, 2), 10);
    return { hour, dispensed: dispensedByHour[h] || 0 };
  });

  const stockByCategory = categoryRows
    .map((row) => ({
      name: row.category || 'Uncategorized',
      value: Number(row.total_qty) || 0,
    }))
    .filter((s) => s.value > 0);

  if (stockByCategory.length === 0) {
    stockByCategory.push({ name: 'No stock loaded', value: 1 });
  }

  const prescriptionStatus = statusRows.map((row) => ({
    status: formatStatusLabel(row.status),
    count: Number(row.count) || 0,
    fill: STATUS_COLORS[row.status] || '#475569',
  }));

  const lowStockBar = topLowStock.map((item) => ({
    name: item.medication_name,
    count: item.quantity_in_stock,
    reorder: item.reorder_level,
    fill: '#e11d48',
  }));

  return {
    kpis: {
      totalMedications,
      lowStockCount: lowStockItems.length,
      pendingPrescriptions,
      dispensedToday,
      unitsReceivedToday: Number(receivedTodayRow?.[0]?.total_units) || 0,
    },
    stockReceivedVelocity,
    stockByCategory,
    hourlyDispensed,
    prescriptionStatus,
    lowStockBar,
    lowStockAlerts: lowStockItems.map((i) => ({
      id: i.id,
      medication_name: i.medication_name,
      quantity_in_stock: i.quantity_in_stock,
      reorder_level: i.reorder_level,
      unit: i.unit,
    })),
    updatedAt: new Date().toISOString(),
  };
}

async function getRecentPrescriptions(facilityId, limit = 25) {
  const prescriptions = await Prescription.findAll({
    include: [
      {
        association: 'visit',
        required: true,
        where: { facility_id: facilityId },
        attributes: ['id', 'visit_number'],
        include: [],
      },
      { association: 'prescribedBy', attributes: ['id', 'first_name', 'last_name'] },
      {
        association: 'items',
        include: [
          { association: 'dispensedBy', attributes: ['id', 'first_name', 'last_name'] },
        ],
      },
    ],
    order: [['created_at', 'DESC']],
    limit,
  });

  return prescriptions.map((rx) => {
    const doctor = rx.prescribedBy;
    const doctorName = doctor
      ? `${doctor.first_name || ''} ${doctor.last_name || ''}`.trim()
      : 'Unknown';

    return {
      id: rx.id,
      status: rx.status,
      created_at: rx.created_at,
      prescribed_by: doctorName,
      prescribed_by_id: rx.prescribed_by,
      items: (rx.items || []).map((item) => {
        const pharm = item.dispensedBy;
        return {
          id: item.id,
          medication_name: item.medication_name,
          quantity: item.quantity,
          is_dispensed: item.is_dispensed,
          dispensed_at: item.dispensed_at,
          pharmacist_name: pharm
            ? `${pharm.first_name || ''} ${pharm.last_name || ''}`.trim()
            : null,
        };
      }),
    };
  });
}

module.exports = { getSupervisorMetrics, getRecentPrescriptions };
