const { v4: uuidv4 } = require('uuid');
const { QueueEntry, Visit, Patient, User, Vital, sequelize } = require('../models');
const { Op } = require('sequelize');
const { assertQueueDepartmentActiveAtFacility } = require('./clinicFacilityDepartmentService');
const { isBookingRoomDepartment } = require('../config/bookingRoomRouting');
const {
  expireStaleClinicVisitsAtFacility,
  assertClinicVisitNotExpired,
  getVisitExpiryInfo,
} = require('./clinicVisitExpiryService');
const {
  expireStaleHospitalVisitsAtFacility,
  assertHospitalVisitNotExpired,
} = require('./hospitalVisitExpiryService');
const { isClinicFacility, isHospitalFacility } = require('../config/clinicRoles');

const ACTIVE_QUEUE_STATUSES = ['waiting', 'in_progress'];

const DEPARTMENT_LABELS = {
  nurse: 'nurse',
  doctor: "doctor's",
  pharmacy: 'pharmacy',
  lab: 'lab',
  sonar: 'sonar',
  billing: 'billing',
  transport: 'transport',
};

/**
 * Active queue entry for this visit in a department (waiting or in progress).
 */
async function findActiveEntryForVisit(visitId, department, transaction = null) {
  return QueueEntry.findOne({
    where: {
      visit_id: visitId,
      department,
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    transaction,
  });
}

/**
 * Active queue entry for this patient in a department (any in-progress visit at facility).
 */
async function findActiveEntryForPatient(patientId, department, facilityId, transaction = null) {
  return QueueEntry.findOne({
    where: {
      department,
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    include: [
      {
        association: 'visit',
        where: {
          patient_id: patientId,
          facility_id: facilityId,
          status: 'in_progress',
        },
        required: true,
        attributes: ['id', 'patient_id', 'facility_id', 'visit_number'],
      },
    ],
    transaction,
  });
}

/**
 * Push a patient visit to a department queue.
 * Skips duplicate visit+department rows; rejects if patient already queued in that department.
 * Emergency patients get position 0 (top of queue).
 */
async function pushToQueue({ visit_id, department, priority = 'normal', pushed_by, notes = null }, transaction = null) {
  const visit = await Visit.findByPk(visit_id, {
    include: [{ association: 'facility', attributes: ['id', 'type'] }],
    transaction,
  });
  if (!visit) throw new Error('Visit not found');

  await assertClinicVisitNotExpired(visit, { autoExpire: true });
  await assertHospitalVisitNotExpired(visit, { autoExpire: true });

  await assertQueueDepartmentActiveAtFacility(visit.facility_id, department);

  const existingForVisit = await findActiveEntryForVisit(visit_id, department, transaction);
  if (existingForVisit) {
    return existingForVisit;
  }

  const existingForPatient = await findActiveEntryForPatient(
    visit.patient_id,
    department,
    visit.facility_id,
    transaction
  );
  if (existingForPatient) {
    if (existingForPatient.visit_id === visit_id) {
      return existingForPatient;
    }
    const label = DEPARTMENT_LABELS[department] || department;
    const visitNo = existingForPatient.visit?.visit_number || 'an active visit';
    const err = new Error(
      `Patient is already in the ${label} queue on visit ${visitNo}. `
      + 'They can only be routed within their current visit — not checked in again.'
    );
    err.statusCode = 409;
    throw err;
  }

  // Get next position in queue for this department
  let position;
  if (priority === 'emergency') {
    // Emergency goes to top - shift all others down
    await QueueEntry.increment('position', {
      by: 1,
      where: { department, status: 'waiting' },
      transaction,
    });
    position = 1;
  } else {
    const maxPos = await QueueEntry.max('position', {
      where: { department, status: { [Op.in]: ['waiting', 'in_progress'] } },
      transaction,
    });
    position = (maxPos || 0) + 1;
  }

  const entry = await QueueEntry.create({
    id: uuidv4(),
    visit_id,
    department,
    priority,
    status: 'waiting',
    position,
    pushed_by,
    notes,
  }, { transaction });

  // Update visit's current department
  await Visit.update(
    { current_department: department, current_queue_position: position },
    { where: { id: visit_id }, transaction }
  );

  return entry;
}

/**
 * Get current queue for a department with patient info.
 */
async function getQueue(department, facilityId) {
  const visitService = require('./visitService');
  const facility = await require('../models').Facility.findByPk(facilityId, { attributes: ['id', 'type'] });
  if (isClinicFacility(facility)) {
    await expireStaleClinicVisitsAtFacility(facilityId);
  } else if (isHospitalFacility(facility)) {
    await expireStaleHospitalVisitsAtFacility(facilityId);
  }
  await visitService.reconcileDepartmentStaleVisits(facilityId, department);

  const entries = await QueueEntry.findAll({
    where: {
      department,
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    include: [
      {
        association: 'visit',
        where: { facility_id: facilityId },
        include: [
          {
            model: Patient,
            as: 'patient',
            attributes: [
              'id', 'first_name', 'last_name', 'patient_number', 'sex', 'date_of_birth',
              'category', 'payment_type', 'is_emergency', 'temp_id',
            ],
          },
          {
            model: Vital,
            as: 'vitals',
            required: false,
          },
        ],
      },
      {
        association: 'assignedTo',
        attributes: ['id', 'first_name', 'last_name'],
        required: false,
      },
    ],
    order: [
      [sequelize.literal("FIELD(priority, 'emergency', 'urgent', 'normal')"), 'ASC'],
      ['position', 'ASC'],
    ],
  });

  if (isClinicFacility(facility)) {
    return entries.map((entry) => {
      const plain = entry.toJSON();
      if (plain.visit) {
        plain.visit.clinic_visit_expiry = getVisitExpiryInfo(plain.visit);
      }
      return plain;
    });
  }

  return entries;
}

/**
 * Start serving a patient (move from waiting to in_progress).
 */
async function startEntry(entryId, userId) {
  const entry = await QueueEntry.findByPk(entryId, {
    include: [
      {
        association: 'visit',
        include: [{ model: Patient, as: 'patient' }],
      },
      { association: 'assignedTo', attributes: ['id', 'first_name', 'last_name'], required: false },
    ],
  });
  if (!entry) throw new Error('Queue entry not found');

  if (entry.status === 'in_progress') {
    if (entry.assigned_to === userId) return entry;
    if (isBookingRoomDepartment(entry.department)) return entry;
    const nurse = entry.assignedTo;
    const name = nurse
      ? [nurse.first_name, nurse.last_name].filter(Boolean).join(' ').trim()
      : 'another nurse';
    throw new Error(`Patient is locked by ${name || 'another nurse'}`);
  }

  if (entry.status !== 'waiting') {
    throw new Error('Patient is not available in the queue');
  }

  await assertClinicVisitNotExpired(entry.visit, { autoExpire: true });
  await assertHospitalVisitNotExpired(entry.visit, { autoExpire: true });

  await entry.update({
    status: 'in_progress',
    assigned_to: userId,
    started_at: new Date(),
  });

  return entry;
}

/**
 * Complete a queue entry and optionally push to next department.
 */
async function completeEntry(entryId, { nextDepartment, nextPriority, notes, pushed_by }, transaction = null) {
  const t = transaction || await sequelize.transaction();
  try {
    const entry = await QueueEntry.findByPk(entryId, { transaction: t });
    if (!entry) throw new Error('Queue entry not found');

    await entry.update({
      status: 'completed',
      completed_at: new Date(),
    }, { transaction: t });

    const visitForCharge = await Visit.findByPk(entry.visit_id, { transaction: t });
    if (visitForCharge?.facility_id) {
      try {
        const billingChargeService = require('./billingChargeService');
        await billingChargeService.chargeDepartmentVisit(
          entry.visit_id,
          entry.department,
          visitForCharge.facility_id,
          entry.id,
          t
        );
      } catch (billErr) {
        console.error('Department visit charge error:', billErr.message);
      }
    }

    let nextEntry = null;
    if (nextDepartment) {
      nextEntry = await pushToQueue({
        visit_id: entry.visit_id,
        department: nextDepartment,
        priority: nextPriority || 'normal',
        pushed_by,
        notes,
      }, t);
    } else if (pushed_by) {
      const visit = await Visit.findByPk(entry.visit_id, { transaction: t });
      if (visit) {
        const clinicBillingService = require('./clinicBillingService');
        await clinicBillingService.applyVisitEndState({
          visitId: entry.visit_id,
          facilityId: visit.facility_id,
          userId: pushed_by,
          notes,
          transaction: t,
        });
      }
    }

    const visitForSync = await Visit.findByPk(entry.visit_id, { transaction: t });
    if (visitForSync?.status === 'in_progress') {
      const remainingActive = await QueueEntry.count({
        where: {
          visit_id: entry.visit_id,
          status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
        },
        transaction: t,
      });
      if (remainingActive === 0 && visitForSync.current_department) {
        await visitForSync.update(
          { current_department: null, current_queue_position: null },
          { transaction: t }
        );
      }
    }

    if (!transaction) await t.commit();
    return { completedEntry: entry, nextEntry };
  } catch (err) {
    if (!transaction && !t.finished) await t.rollback();
    throw err;
  }
}

/**
 * Skip a patient in queue.
 */
async function skipEntry(entryId, notes) {
  const entry = await QueueEntry.findByPk(entryId);
  if (!entry) throw new Error('Queue entry not found');

  await entry.update({
    status: 'skipped',
    completed_at: new Date(),
    notes: notes || 'Patient skipped',
  });

  const visit = await Visit.findByPk(entry.visit_id);
  if (visit?.status === 'in_progress') {
    const visitService = require('./visitService');
    await visitService.reconcileStaleQueueVisit(visit);
  }

  return entry;
}

/**
 * Release an in-progress entry back to waiting (same nurse can pick up again later).
 */
async function releaseEntry(entryId, userId) {
  const entry = await QueueEntry.findByPk(entryId);
  if (!entry) throw new Error('Queue entry not found');
  if (entry.status !== 'in_progress') {
    throw new Error('Patient is not in an active session');
  }
  if (entry.assigned_to !== userId) {
    if (!isBookingRoomDepartment(entry.department)) {
      throw new Error('You can only release patients assigned to you');
    }
  }

  await entry.update({
    status: 'waiting',
    assigned_to: null,
    started_at: null,
  });

  return entry;
}

/**
 * Get queue stats for a department.
 */
async function getQueueStats(department, facilityId) {
  const waiting = await QueueEntry.count({
    where: { department, status: 'waiting' },
    include: [{ association: 'visit', where: { facility_id: facilityId }, attributes: [] }],
  });

  const inProgress = await QueueEntry.count({
    where: { department, status: 'in_progress' },
    include: [{ association: 'visit', where: { facility_id: facilityId }, attributes: [] }],
  });

  return { department, waiting, inProgress, total: waiting + inProgress };
}

module.exports = {
  pushToQueue,
  findActiveEntryForVisit,
  findActiveEntryForPatient,
  getQueue,
  startEntry,
  completeEntry,
  skipEntry,
  releaseEntry,
  getQueueStats,
};
