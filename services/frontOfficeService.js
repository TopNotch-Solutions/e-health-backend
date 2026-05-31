const { Op } = require('sequelize');
const { Visit, Patient, QueueEntry } = require('../models');
const { routingLabel } = require('../config/clinicQueueDepartments');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Visit registered today by this clerk at this facility.
 */
async function findEditableVisit(patientId, userId, facilityId) {
  return Visit.findOne({
    where: {
      patient_id: patientId,
      created_by: userId,
      facility_id: facilityId,
      created_at: { [Op.between]: [startOfToday(), endOfToday()] },
    },
    order: [['created_at', 'DESC']],
  });
}

async function assertCanEditPatientToday(patientId, userId, facilityId) {
  const visit = await findEditableVisit(patientId, userId, facilityId);
  if (!visit) {
    const err = new Error('You can only update patients you registered today');
    err.statusCode = 403;
    throw err;
  }
  return visit;
}

async function getMyRegistrations(userId, facilityId) {
  const visits = await Visit.findAll({
    where: {
      created_by: userId,
      facility_id: facilityId,
      created_at: { [Op.gte]: startOfToday() },
    },
    include: [
      {
        model: Patient,
        as: 'patient',
        attributes: [
          'id', 'patient_number', 'first_name', 'last_name', 'sex',
          'date_of_birth', 'id_number', 'phone', 'address', 'payment_type', 'category',
          'is_emergency', 'emergency_contact_name', 'emergency_contact_phone', 'temp_id',
        ],
      },
      {
        model: QueueEntry,
        as: 'queueEntries',
        attributes: ['id', 'department', 'priority', 'status', 'created_at'],
        separate: true,
        order: [['created_at', 'ASC']],
        limit: 1,
      },
    ],
    order: [['created_at', 'DESC']],
  });

  return visits.map((visit) => {
    const plain = visit.get({ plain: true });
    const queueEntry = plain.queueEntries?.[0];
    const department = plain.current_department || queueEntry?.department;
    return {
      visit_id: plain.id,
      visit_number: plain.visit_number,
      visit_type: plain.visit_type,
      registered_at: plain.created_at,
      routing_department: department,
      routing_label: routingLabel(department),
      queue_priority: queueEntry?.priority || 'normal',
      editable: true,
      patient: plain.patient,
    };
  });
}

module.exports = {
  startOfToday,
  endOfToday,
  findEditableVisit,
  assertCanEditPatientToday,
  getMyRegistrations,
};
