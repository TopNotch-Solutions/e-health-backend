const {
  Patient, Visit, QueueEntry, Admission, User, Role, Bill, RevenueShift,
  MortuaryRecord, Consultation, Prescription, LabRequest, SonarRequest,
  TransportRequest, Vital, Facility, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, error } = require('../utils/response');

// Executive Overview Dashboard - all key metrics
exports.getOverview = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    const [
      totalPatients,
      todayRegistrations,
      monthRegistrations,
      yearRegistrations,
      totalVisits,
      todayVisits,
      activeVisits,
      emergenciesToday,
      emergenciesMonth,
      admittedNow,
      totalAdmissionsMonth,
      totalDischargesMonth,
      totalDeaths,
      deathsMonth,
      totalStaff,
      activeStaff,
    ] = await Promise.all([
      Patient.count(),
      Patient.count({ where: { created_at: { [Op.gte]: today } } }),
      Patient.count({ where: { created_at: { [Op.gte]: startOfMonth } } }),
      Patient.count({ where: { created_at: { [Op.gte]: startOfYear } } }),
      Visit.count(),
      Visit.count({ where: { created_at: { [Op.gte]: today } } }),
      Visit.count({ where: { status: 'in_progress' } }),
      Visit.count({ where: { visit_type: 'emergency', created_at: { [Op.gte]: today } } }),
      Visit.count({ where: { visit_type: 'emergency', created_at: { [Op.gte]: startOfMonth } } }),
      Admission.count({ where: { status: 'admitted' } }),
      Admission.count({ where: { admitted_at: { [Op.gte]: startOfMonth } } }),
      Admission.count({ where: { status: 'discharged', discharged_at: { [Op.gte]: startOfMonth } } }),
      MortuaryRecord.count(),
      MortuaryRecord.count({ where: { date_of_death: { [Op.gte]: startOfMonth } } }),
      User.count(),
      User.count({ where: { is_active: true } }),
    ]);

    return success(res, {
      patients: { total: totalPatients, today: todayRegistrations, month: monthRegistrations, year: yearRegistrations },
      visits: { total: totalVisits, today: todayVisits, active: activeVisits },
      emergencies: { today: emergenciesToday, month: emergenciesMonth },
      admissions: { current: admittedNow, month_total: totalAdmissionsMonth, discharges_month: totalDischargesMonth },
      deaths: { total: totalDeaths, month: deathsMonth },
      staff: { total: totalStaff, active: activeStaff },
    });
  } catch (err) {
    console.error('Executive overview error:', err);
    return error(res, 'Failed to fetch overview', 500);
  }
};

// Employee statistics (staff by role, active/inactive)
exports.getEmployeeStats = async (req, res) => {
  try {
    const byRole = await User.findAll({
      attributes: ['role_id', [sequelize.fn('COUNT', sequelize.col('User.id')), 'count']],
      include: [{ model: Role, as: 'role', attributes: ['name', 'display_name'] }],
      group: ['role_id', 'role.id', 'role.name', 'role.display_name'],
      raw: false,
    });

    const activeVsInactive = await User.findAll({
      attributes: [
        'is_active',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['is_active'],
      raw: true,
    });

    // Staff who logged in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const loggedInToday = await User.count({
      where: { last_login: { [Op.gte]: today } },
    });

    return success(res, {
      by_role: byRole,
      active_vs_inactive: activeVsInactive,
      logged_in_today: loggedInToday,
      total: await User.count(),
    });
  } catch (err) {
    return error(res, 'Failed to fetch employee stats', 500);
  }
};

// Individual staff performance (queue start/complete times, patients served)
exports.getStaffPerformance = async (req, res) => {
  try {
    const { from, to, user_id } = req.query;
    const startDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const endDate = to ? new Date(to) : new Date();

    const where = {
      status: 'completed',
      completed_at: { [Op.between]: [startDate, endDate] },
    };
    if (user_id) where.assigned_to = user_id;

    // Get completed queue entries grouped by staff
    const performance = await QueueEntry.findAll({
      attributes: [
        'assigned_to',
        'department',
        [sequelize.fn('COUNT', sequelize.col('QueueEntry.id')), 'patients_served'],
        [sequelize.fn('AVG', sequelize.literal('TIMESTAMPDIFF(MINUTE, started_at, completed_at)')), 'avg_service_time_minutes'],
        [sequelize.fn('MIN', sequelize.literal('TIMESTAMPDIFF(MINUTE, started_at, completed_at)')), 'min_service_time'],
        [sequelize.fn('MAX', sequelize.literal('TIMESTAMPDIFF(MINUTE, started_at, completed_at)')), 'max_service_time'],
      ],
      where,
      group: ['assigned_to', 'department'],
      include: [{ association: 'assignedTo', attributes: ['id', 'first_name', 'last_name', 'employee_id'] }],
      raw: false,
    });

    return success(res, { period: { from: startDate, to: endDate }, performance });
  } catch (err) {
    console.error('Staff performance error:', err);
    return error(res, 'Failed to fetch staff performance', 500);
  }
};

// Revenue analytics (daily/monthly revenue, billing stats)
exports.getRevenueAnalytics = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    const [
      todayRevenue,
      monthRevenue,
      yearRevenue,
      pendingBills,
      totalOutstanding,
      paidBillsMonth,
      waivedBillsMonth,
      shiftsWithDiscrepancy,
    ] = await Promise.all([
      Bill.sum('paid_amount', { where: { status: 'paid', created_at: { [Op.gte]: today } } }),
      Bill.sum('paid_amount', { where: { status: 'paid', created_at: { [Op.gte]: startOfMonth } } }),
      Bill.sum('paid_amount', { where: { status: 'paid', created_at: { [Op.gte]: startOfYear } } }),
      Bill.count({ where: { status: 'pending_payment' } }),
      Bill.sum('total_amount', { where: { status: { [Op.in]: ['accumulating', 'pending_payment'] } } }),
      Bill.count({ where: { status: 'paid', created_at: { [Op.gte]: startOfMonth } } }),
      Bill.count({ where: { status: 'waived', created_at: { [Op.gte]: startOfMonth } } }),
      RevenueShift.count({ where: { status: 'discrepancy' } }),
    ]);

    return success(res, {
      revenue: { today: todayRevenue || 0, month: monthRevenue || 0, year: yearRevenue || 0 },
      bills: { pending: pendingBills, outstanding: totalOutstanding || 0, paid_month: paidBillsMonth, waived_month: waivedBillsMonth },
      shifts: { discrepancies: shiftsWithDiscrepancy },
    });
  } catch (err) {
    return error(res, 'Failed to fetch revenue analytics', 500);
  }
};

// Patient registration trends (daily counts for last 30 days)
exports.getRegistrationTrends = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date(Date.now() - days * 86400000);

    const registrations = await Patient.findAll({
      attributes: [
        [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        'category',
      ],
      where: { created_at: { [Op.gte]: startDate } },
      group: [sequelize.fn('DATE', sequelize.col('created_at')), 'category'],
      order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
      raw: true,
    });

    // Patient type breakdown
    const byPaymentType = await Patient.findAll({
      attributes: ['payment_type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['payment_type'],
      raw: true,
    });

    const byCategory = await Patient.findAll({
      attributes: ['category', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['category'],
      raw: true,
    });

    const bySex = await Patient.findAll({
      attributes: ['sex', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['sex'],
      raw: true,
    });

    return success(res, {
      daily_registrations: registrations,
      by_payment_type: byPaymentType,
      by_category: byCategory,
      by_sex: bySex,
    });
  } catch (err) {
    return error(res, 'Failed to fetch registration trends', 500);
  }
};

// Department workload (queue throughput per department)
exports.getDepartmentWorkload = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Current queue sizes
    const currentQueues = await QueueEntry.findAll({
      attributes: ['department', [sequelize.fn('COUNT', sequelize.col('id')), 'waiting']],
      where: { status: 'waiting' },
      group: ['department'],
      raw: true,
    });

    // Completed today per department
    const completedToday = await QueueEntry.findAll({
      attributes: ['department', [sequelize.fn('COUNT', sequelize.col('id')), 'completed']],
      where: { status: 'completed', completed_at: { [Op.gte]: today } },
      group: ['department'],
      raw: true,
    });

    // Average wait time per department (this month)
    const avgWaitTimes = await QueueEntry.findAll({
      attributes: [
        'department',
        [sequelize.fn('AVG', sequelize.literal('TIMESTAMPDIFF(MINUTE, created_at, started_at)')), 'avg_wait_minutes'],
        [sequelize.fn('AVG', sequelize.literal('TIMESTAMPDIFF(MINUTE, started_at, completed_at)')), 'avg_service_minutes'],
      ],
      where: {
        status: 'completed',
        started_at: { [Op.ne]: null },
        completed_at: { [Op.gte]: startOfMonth },
      },
      group: ['department'],
      raw: true,
    });

    return success(res, { currentQueues, completedToday, avgWaitTimes });
  } catch (err) {
    return error(res, 'Failed to fetch department workload', 500);
  }
};

// Mortality analytics
exports.getMortalityStats = async (req, res) => {
  try {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);

    const total = await MortuaryRecord.count();
    const thisYear = await MortuaryRecord.count({ where: { date_of_death: { [Op.gte]: startOfYear } } });

    // Monthly breakdown for current year
    const monthly = await MortuaryRecord.findAll({
      attributes: [
        [sequelize.fn('MONTH', sequelize.col('date_of_death')), 'month'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: { date_of_death: { [Op.gte]: startOfYear } },
      group: [sequelize.fn('MONTH', sequelize.col('date_of_death'))],
      order: [[sequelize.fn('MONTH', sequelize.col('date_of_death')), 'ASC']],
      raw: true,
    });

    // Body status breakdown
    const byStatus = await MortuaryRecord.findAll({
      attributes: ['body_status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['body_status'],
      raw: true,
    });

    return success(res, { total, this_year: thisYear, monthly, by_status: byStatus });
  } catch (err) {
    return error(res, 'Failed to fetch mortality stats', 500);
  }
};

// Admission & discharge analytics
exports.getAdmissionStats = async (req, res) => {
  try {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const currentlyAdmitted = await Admission.count({ where: { status: 'admitted' } });
    const admissionsThisMonth = await Admission.count({ where: { admitted_at: { [Op.gte]: startOfMonth } } });
    const dischargesThisMonth = await Admission.count({ where: { status: 'discharged', discharged_at: { [Op.gte]: startOfMonth } } });

    // Average length of stay (completed admissions this month)
    const avgStay = await Admission.findAll({
      attributes: [
        [sequelize.fn('AVG', sequelize.literal('TIMESTAMPDIFF(HOUR, admitted_at, discharged_at)')), 'avg_hours'],
      ],
      where: { status: 'discharged', discharged_at: { [Op.gte]: startOfMonth } },
      raw: true,
    });

    return success(res, {
      currently_admitted: currentlyAdmitted,
      admissions_month: admissionsThisMonth,
      discharges_month: dischargesThisMonth,
      avg_length_of_stay_hours: avgStay[0]?.avg_hours || 0,
    });
  } catch (err) {
    return error(res, 'Failed to fetch admission stats', 500);
  }
};
