const { v4: uuidv4 } = require('uuid');
const {
  Ward,
  Bed,
  Admission,
  Visit,
  Patient,
  User,
  TransportRequest,
  sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const notificationService = require('../services/notificationService');
const { getSupervisorMetrics } = require('../services/wardSupervisorMetricsService');

// Get all wards with bed summary
exports.getAll = async (req, res) => {
  try {
    const wards = await Ward.findAll({
      where: { facility_id: req.user.facility_id },
      include: [
        { association: 'supervisor', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'beds', attributes: ['id', 'room_number', 'bed_number', 'status', 'condition_note'] },
      ],
      order: [['ward_number', 'ASC']],
    });

    // Add summary stats per ward
    const result = wards.map(ward => {
      const beds = ward.beds || [];
      return {
        ...ward.toJSON(),
        stats: {
          total: beds.length,
          available: beds.filter(b => b.status === 'available').length,
          occupied: beds.filter((b) => b.status === 'occupied' || b.status === 'reserved').length,
          out_of_service: beds.filter(b => b.status === 'out_of_service').length,
        },
      };
    });

    return success(res, result);
  } catch (err) {
    console.error('Get wards error:', err);
    return error(res, 'Failed to fetch wards', 500);
  }
};

// Ward supervisor live analytics (registrations, admissions, charts)
exports.getSupervisorMetrics = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) {
      return error(res, 'Facility context required', 400);
    }
    const metrics = await getSupervisorMetrics(facilityId);
    return success(res, metrics);
  } catch (err) {
    console.error('Supervisor metrics error:', err);
    return error(res, 'Failed to fetch supervisor metrics', 500);
  }
};

// Get ward supervisor dashboard
exports.getDashboard = async (req, res) => {
  try {
    const { id } = req.params;
    const ward = await Ward.findByPk(id, {
      include: [
        { association: 'supervisor', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'beds' },
      ],
    });

    if (!ward) return error(res, 'Ward not found', 404);

    // Get current admissions for this ward
    const admissions = await Admission.findAll({
      where: { status: { [Op.in]: ['admitted', 'pending_arrival'] } },
      include: [
        {
          model: Bed,
          as: 'bed',
          where: { ward_id: id },
          attributes: ['id', 'bed_number'],
        },
        {
          association: 'visit',
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number', 'sex'] }],
        },
      ],
    });

    const beds = ward.beds || [];
    const dashboard = {
      ward: {
        id: ward.id,
        name: ward.name,
        ward_number: ward.ward_number,
        ward_type: ward.ward_type,
        supervisor: ward.supervisor,
      },
      stats: {
        total_beds: beds.length,
        available: beds.filter(b => b.status === 'available').length,
        occupied: beds.filter((b) => b.status === 'occupied' || b.status === 'reserved').length,
        out_of_service: beds.filter(b => b.status === 'out_of_service').length,
      },
      beds: beds.map(bed => {
        const admission = admissions.find(a => a.bed.id === bed.id);
        return {
          ...bed.toJSON(),
          patient: admission ? admission.visit.patient : null,
          admitted_at: admission ? admission.admitted_at : null,
        };
      }),
      current_admissions: admissions,
    };

    return success(res, dashboard);
  } catch (err) {
    console.error('Get dashboard error:', err);
    return error(res, 'Failed to fetch dashboard', 500);
  }
};

const VALID_BED_STATUSES = new Set(['available', 'occupied', 'out_of_service']);

function normalizeRoomPayload(rooms, roomCount, outOfServiceRoomNumbers) {
  if (Array.isArray(rooms) && rooms.length > 0) {
    return rooms.map((r, i) => {
      const roomNum = String(r.room_number ?? r.room ?? i + 1);
      const status = VALID_BED_STATUSES.has(r.status) ? r.status : 'available';
      return {
        room_number: roomNum,
        bed_number: String(r.bed_number ?? roomNum),
        status,
        condition_note: r.condition_note || (status === 'out_of_service' ? 'Not in service' : null),
      };
    });
  }

  const count = Number(roomCount) > 0 ? Number(roomCount) : 0;
  if (!count) return [];

  const oosSet = new Set(
    (Array.isArray(outOfServiceRoomNumbers) ? outOfServiceRoomNumbers : [])
      .map((n) => String(n))
  );

  return Array.from({ length: count }, (_, i) => {
    const roomNum = String(i + 1);
    const isOos = oosSet.has(roomNum);
    return {
      room_number: roomNum,
      bed_number: roomNum,
      status: isOos ? 'out_of_service' : 'available',
      condition_note: isOos ? 'Bed not in service' : null,
    };
  });
}

// Create ward (optional rooms/beds in same request)
exports.createWard = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      name,
      ward_number,
      ward_type,
      supervisor_id,
      rooms,
      room_count,
      out_of_service_rooms,
    } = req.body;

    if (!name || !ward_number || !ward_type) {
      if (!t.finished) await t.rollback();
      return error(res, 'name, ward_number, and ward_type are required', 400);
    }

    const ward = await Ward.create(
      {
        id: uuidv4(),
        facility_id: req.user.facility_id,
        name,
        ward_number,
        ward_type,
        supervisor_id: supervisor_id || null,
        total_beds: 0,
      },
      { transaction: t }
    );

    const roomRows = normalizeRoomPayload(rooms, room_count, out_of_service_rooms);
    const beds = [];

    for (const row of roomRows) {
      const bed = await Bed.create(
        {
          id: uuidv4(),
          ward_id: ward.id,
          room_number: row.room_number,
          bed_number: row.bed_number,
          status: row.status,
          condition_note: row.condition_note,
        },
        { transaction: t }
      );
      beds.push(bed);
    }

    if (beds.length) {
      await ward.update({ total_beds: beds.length }, { transaction: t });
    }

    await t.commit();

    const payload = {
      ward: { ...ward.toJSON(), total_beds: beds.length },
      beds,
      stats: {
        total: beds.length,
        available: beds.filter((b) => b.status === 'available').length,
        occupied: beds.filter((b) => b.status === 'occupied').length,
        out_of_service: beds.filter((b) => b.status === 'out_of_service').length,
      },
    };

    const message =
      beds.length > 0
        ? `Ward created with ${beds.length} room(s) and bed(s)`
        : 'Ward created';

    return created(res, payload, message);
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Create ward error:', err);
    return error(res, err.message || 'Failed to create ward', 500);
  }
};

// Update ward
exports.updateWard = async (req, res) => {
  try {
    const ward = await Ward.findByPk(req.params.id);
    if (!ward) return error(res, 'Ward not found', 404);

    const allowed = ['name', 'ward_number', 'ward_type', 'supervisor_id'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    await ward.update(updates);
    return success(res, ward, 'Ward updated');
  } catch (err) {
    return error(res, 'Failed to update ward', 500);
  }
};

// Add bed to ward
exports.addBed = async (req, res) => {
  try {
    const { ward_id, bed_number, room_number, status, condition_note } = req.body;
    if (!ward_id || !bed_number) return error(res, 'ward_id and bed_number are required', 400);

    const ward = await Ward.findByPk(ward_id);
    if (!ward) return error(res, 'Ward not found', 404);
    if (ward.facility_id !== req.user.facility_id) return error(res, 'Ward not found', 404);

    const bedStatus = VALID_BED_STATUSES.has(status) ? status : 'available';

    const bed = await Bed.create({
      id: uuidv4(),
      ward_id,
      room_number: room_number != null ? String(room_number) : null,
      bed_number,
      status: bedStatus,
      condition_note: condition_note || null,
    });

    // Update total bed count
    await ward.update({ total_beds: ward.total_beds + 1 });

    return created(res, bed, 'Bed added');
  } catch (err) {
    return error(res, 'Failed to add bed', 500);
  }
};

// Toggle bed active/inactive (available ↔ out_of_service). Occupied beds cannot be changed.
exports.updateBed = async (req, res) => {
  try {
    const bed = await Bed.findByPk(req.params.id, {
      include: [{ model: Ward, as: 'ward' }],
    });
    if (!bed) return error(res, 'Bed not found', 404);
    if (!bed.ward || bed.ward.facility_id !== req.user.facility_id) {
      return error(res, 'Bed not found', 404);
    }

    if (bed.status === 'occupied' || bed.status === 'reserved') {
      return error(res, 'Cannot change status while a patient is assigned to this bed', 400);
    }

    let { status, condition_note } = req.body;

    // Empty body = toggle active / inactive
    if (!status) {
      status = bed.status === 'out_of_service' ? 'available' : 'out_of_service';
    }

    if (!['available', 'out_of_service'].includes(status)) {
      return error(res, 'Only available or out_of_service status is allowed from the ward supervisor', 400);
    }

    const updates = { status };
    if (status === 'out_of_service') {
      updates.condition_note =
        condition_note !== undefined && condition_note !== null && String(condition_note).trim()
          ? String(condition_note).trim()
          : 'Bed marked inactive by ward supervisor';
    } else {
      updates.condition_note = null;
    }

    await bed.update(updates);

    const refreshed = await Bed.findByPk(bed.id, {
      include: [{ model: Ward, as: 'ward', attributes: ['id', 'name', 'ward_number', 'facility_id'] }],
    });

    notificationService.emitWardUpdate({
      type: 'bed_status_change',
      bed_id: bed.id,
      ward_id: bed.ward_id,
      new_status: status,
    });

    return success(res, refreshed, status === 'available' ? 'Bed marked active' : 'Bed marked inactive');
  } catch (err) {
    console.error('Update bed error:', err);
    return error(res, 'Failed to update bed', 500);
  }
};

// Get available beds (for doctor when admitting)
exports.getAvailableBeds = async (req, res) => {
  try {
    const beds = await Bed.findAll({
      where: { status: 'available' },
      include: [{
        model: Ward,
        as: 'ward',
        where: { facility_id: req.user.facility_id },
        attributes: ['id', 'name', 'ward_number', 'ward_type'],
      }],
      order: [
        [{ model: Ward, as: 'ward' }, 'name', 'ASC'],
        ['room_number', 'ASC'],
        ['bed_number', 'ASC'],
      ],
    });

    return success(res, beds);
  } catch (err) {
    return error(res, 'Failed to fetch available beds', 500);
  }
};

const ADMISSION_STAFF_INCLUDES = [
  {
    model: Bed,
    as: 'bed',
    include: [
      {
        model: Ward,
        as: 'ward',
        where: { facility_id: null }, // replaced per-request
        required: true,
      },
    ],
  },
  {
    association: 'visit',
    include: [
      {
        model: Patient,
        as: 'patient',
        attributes: [
          'id',
          'patient_number',
          'first_name',
          'last_name',
          'sex',
          'date_of_birth',
          'phone',
          'is_emergency',
        ],
      },
      {
        model: TransportRequest,
        as: 'transportRequests',
        required: false,
        include: [
          { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
        ],
      },
    ],
  },
  { association: 'admittedBy', attributes: ['id', 'first_name', 'last_name'] },
];

function staffIncludesForFacility(facilityId) {
  return ADMISSION_STAFF_INCLUDES.map((inc) => {
    if (inc.as === 'bed') {
      return {
        ...inc,
        include: inc.include.map((nested) =>
          nested.as === 'ward' ? { ...nested, where: { facility_id: facilityId } } : nested
        ),
      };
    }
    return inc;
  });
}

function formatAdmissionForStaff(row) {
  const json = row.toJSON ? row.toJSON() : row;
  const bed = json.bed || {};
  const ward = bed.ward || {};
  const visit = json.visit || {};
  const patient = visit.patient || {};
  const transports = visit.transportRequests || [];
  const transport = transports[0] || null;

  return {
    id: json.id,
    status: json.status,
    visit_id: json.visit_id,
    bed_id: json.bed_id,
    requested_at: transport?.requested_at || null,
    admitted_at: json.admitted_at,
    patient: {
      id: patient.id,
      patient_number: patient.patient_number,
      first_name: patient.first_name,
      last_name: patient.last_name,
      sex: patient.sex,
      date_of_birth: patient.date_of_birth,
      phone: patient.phone,
      is_emergency: patient.is_emergency,
    },
    visit: {
      id: visit.id,
      visit_number: visit.visit_number,
      visit_type: visit.visit_type,
    },
    ward: {
      id: ward.id,
      name: ward.name,
      ward_number: ward.ward_number,
      ward_type: ward.ward_type,
    },
    bed: {
      id: bed.id,
      room_number: bed.room_number,
      bed_number: bed.bed_number,
      status: bed.status,
    },
    admitted_by: json.admittedBy
      ? {
          id: json.admittedBy.id,
          name: [json.admittedBy.first_name, json.admittedBy.last_name].filter(Boolean).join(' '),
        }
      : null,
    transport: transport
      ? {
          id: transport.id,
          status: transport.status,
          priority: transport.priority,
          from_location: transport.from_location,
          to_location: transport.to_location,
          equipment_required: transport.equipment_required,
          equipment_notes: transport.equipment_notes,
          critical_notes: transport.critical_notes,
          equipment_checklist: transport.equipment_checklist,
          requested_at: transport.requested_at,
        }
      : null,
  };
}

// Ward staff: patients awaiting arrival confirmation
exports.getStaffQueue = async (req, res) => {
  try {
    const admissions = await Admission.findAll({
      where: { status: 'pending_arrival' },
      include: staffIncludesForFacility(req.user.facility_id),
    });

    const payload = admissions.map(formatAdmissionForStaff);
    payload.sort((a, b) => {
      const ae = a.patient?.is_emergency ? 0 : 1;
      const be = b.patient?.is_emergency ? 0 : 1;
      if (ae !== be) return ae - be;
      const ap = a.transport?.priority === 'emergency' ? 0 : a.transport?.priority === 'urgent' ? 1 : 2;
      const bp = b.transport?.priority === 'emergency' ? 0 : b.transport?.priority === 'urgent' ? 1 : 2;
      if (ap !== bp) return ap - bp;
      const at = a.requested_at ? new Date(a.requested_at).getTime() : 0;
      const bt = b.requested_at ? new Date(b.requested_at).getTime() : 0;
      return at - bt;
    });

    return success(res, payload);
  } catch (err) {
    console.error('Get ward staff queue error:', err);
    return error(res, 'Failed to fetch ward arrival queue', 500);
  }
};

// Ward staff: single admission with full context
exports.getAdmissionById = async (req, res) => {
  try {
    const admission = await Admission.findByPk(req.params.id, {
      include: staffIncludesForFacility(req.user.facility_id),
    });
    if (!admission) return error(res, 'Admission not found', 404);
    return success(res, formatAdmissionForStaff(admission));
  } catch (err) {
    console.error('Get admission error:', err);
    return error(res, 'Failed to fetch admission', 500);
  }
};

// Ward staff: confirm patient arrived at ward (arrival time + bed marked occupied)
exports.confirmArrival = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    let arrivedDate = new Date();
    if (req.body?.arrived_at) {
      arrivedDate = new Date(req.body.arrived_at);
      if (Number.isNaN(arrivedDate.getTime())) {
        if (!t.finished) await t.rollback();
        return error(res, 'Invalid arrival date', 400);
      }
    }

    const admission = await Admission.findByPk(req.params.id, {
      include: [{ model: Bed, as: 'bed', include: [{ model: Ward, as: 'ward' }] }],
      transaction: t,
    });
    if (!admission) {
      if (!t.finished) await t.rollback();
      return error(res, 'Admission not found', 404);
    }
    if (!admission.bed?.ward || admission.bed.ward.facility_id !== req.user.facility_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'Admission not found', 404);
    }
    if (admission.status !== 'pending_arrival') {
      if (!t.finished) await t.rollback();
      return error(res, 'This admission is not awaiting arrival confirmation', 400);
    }

    await admission.update(
      {
        status: 'admitted',
        admitted_at: arrivedDate,
      },
      { transaction: t }
    );

    await admission.bed.update({ status: 'occupied' }, { transaction: t });

    await t.commit();

    const refreshed = await Admission.findByPk(admission.id, {
      include: staffIncludesForFacility(req.user.facility_id),
    });

    notificationService.emitWardUpdate({
      type: 'arrival_confirmed',
      admission_id: admission.id,
      bed_id: admission.bed_id,
      ward_id: admission.bed.ward_id,
      bed_status: 'occupied',
    });
    notificationService.emitWardStaffQueueRefresh({ reason: 'arrival_confirmed' });

    return success(res, formatAdmissionForStaff(refreshed), 'Patient arrival confirmed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Confirm arrival error:', err);
    return error(res, 'Failed to confirm arrival', 500);
  }
};

// Update admission (ward staff updates admitted/discharged dates)
exports.updateAdmission = async (req, res) => {
  try {
    const admission = await Admission.findByPk(req.params.id, {
      include: [{ model: Bed, as: 'bed' }],
    });
    if (!admission) return error(res, 'Admission not found', 404);

    const { status, discharge_notes } = req.body;

    if (status === 'discharged') {
      await admission.update({
        status: 'discharged',
        discharged_at: new Date(),
        discharged_by: req.user.id,
        discharge_notes: discharge_notes || null,
      });

      // Free bed
      await admission.bed.update({ status: 'available' });

      notificationService.emitWardUpdate({
        type: 'discharge',
        bed_id: admission.bed_id,
        ward_id: admission.bed.ward_id,
      });
    } else if (status) {
      await admission.update({ status });
    }

    return success(res, admission, 'Admission updated');
  } catch (err) {
    return error(res, 'Failed to update admission', 500);
  }
};

// Get all current admissions for the facility
exports.getAdmissions = async (req, res) => {
  try {
    const { status = 'admitted' } = req.query;
    const admissions = await Admission.findAll({
      where: { status },
      include: [
        {
          model: Bed, as: 'bed',
          include: [{ model: Ward, as: 'ward', where: { facility_id: req.user.facility_id } }],
        },
        {
          association: 'visit',
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
        },
      ],
      order: [['admitted_at', 'DESC']],
    });

    return success(res, admissions);
  } catch (err) {
    return error(res, 'Failed to fetch admissions', 500);
  }
};
