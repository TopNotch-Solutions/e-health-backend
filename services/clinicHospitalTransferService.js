'use strict';

const { v4: uuidv4 } = require('uuid');
const {
  Facility,
  FacilityDepartment,
  Visit,
  Patient,
  Referral,
  TransportRequest,
  ClinicHospitalTransfer,
  QueueEntry,
  sequelize,
} = require('../models');
const { isHospitalFacility } = require('../config/clinicRoles');
const {
  HOSPITAL_OUTPATIENT_DEFINITIONS,
  isValidHospitalDepartment,
  departmentLabel,
  allowedHospitalDepartmentsForPatient,
} = require('../config/hospitalOutpatientConfig');
const { buildTransferTimeline } = require('../config/clinicHospitalTransferTimeline');
const { emitTransportSocketRefresh } = require('../config/porterRoles');
const queueService = require('./queueService');
const { generateVisitNumber } = require('../utils/idGenerator');
const { getIO } = require('../socket');

const TRANSFER_USER_INCLUDES = [
  { association: 'plannedBy', attributes: ['id', 'first_name', 'last_name'] },
  { association: 'initiatedBy', attributes: ['id', 'first_name', 'last_name'] },
  { association: 'externalPickedUpBy', attributes: ['id', 'first_name', 'last_name'] },
  { association: 'departureConfirmedBy', attributes: ['id', 'first_name', 'last_name'] },
  { association: 'internalPickedUpBy', attributes: ['id', 'first_name', 'last_name'] },
  { association: 'receivedBy', attributes: ['id', 'first_name', 'last_name'] },
];

const TIMELINE_TIMESTAMP_FIELDS = [
  'planned_at',
  'initiated_at',
  'external_picked_up_at',
  'departure_confirmed_at',
  'arrived_hospital_at',
  'internal_picked_up_at',
  'delivered_to_department_at',
  'received_at',
];

const TIMELINE_ACTOR_ID_FIELDS = [
  'planned_by',
  'initiated_by',
  'external_picked_up_by',
  'departure_confirmed_by',
  'internal_picked_up_by',
  'received_by',
];

const TIMELINE_ACTOR_ASSOCS = [
  'plannedBy',
  'initiatedBy',
  'externalPickedUpBy',
  'departureConfirmedBy',
  'internalPickedUpBy',
  'receivedBy',
];

function stripTimelineFields(plain) {
  const copy = { ...plain };
  for (const field of TIMELINE_TIMESTAMP_FIELDS) delete copy[field];
  for (const field of TIMELINE_ACTOR_ID_FIELDS) delete copy[field];
  for (const assoc of TIMELINE_ACTOR_ASSOCS) delete copy[assoc];
  delete copy.timeline;
  return copy;
}

function serializeTransfer(transfer, { includeTimeline = false } = {}) {
  if (!transfer) return null;
  const plain = transfer.toJSON ? transfer.toJSON() : { ...transfer };
  if (includeTimeline) {
    return {
      ...plain,
      timeline: buildTransferTimeline(transfer),
    };
  }
  return stripTimelineFields(plain);
}

/** @deprecated use serializeTransfer */
function serializeTransferWithTimeline(transfer) {
  return serializeTransfer(transfer, { includeTimeline: false });
}

const VALID_DEPARTMENT_KEYS = new Set(
  HOSPITAL_OUTPATIENT_DEFINITIONS.map((d) => d.key)
);

async function seedHospitalOutpatientDepartments(facilityId, transaction = null) {
  const created = [];
  for (const def of HOSPITAL_OUTPATIENT_DEFINITIONS) {
    const [row] = await FacilityDepartment.findOrCreate({
      where: { facility_id: facilityId, department_key: def.key },
      defaults: {
        id: uuidv4(),
        facility_id: facilityId,
        department_key: def.key,
        is_active: true,
      },
      transaction,
    });
    if (!row.is_active) {
      await row.update({ is_active: true }, { transaction });
    }
    created.push(row);
  }
  return created;
}

async function getQueueDepartmentForHospitalRoleKey(departmentKey) {
  const def = HOSPITAL_OUTPATIENT_DEFINITIONS.find((d) => d.key === departmentKey);
  return def?.department || null;
}

async function assertHospitalQueueDepartmentActive(facilityId, queueDepartment) {
  const facility = await Facility.findByPk(facilityId);
  if (!facility || !isHospitalFacility(facility)) {
    const err = new Error('Hospital facility required');
    err.statusCode = 400;
    throw err;
  }
  const def = HOSPITAL_OUTPATIENT_DEFINITIONS.find((d) => d.department === queueDepartment);
  if (!def) {
    const err = new Error(`Unknown hospital department: ${queueDepartment}`);
    err.statusCode = 400;
    throw err;
  }
  const row = await FacilityDepartment.findOne({
    where: { facility_id: facilityId, department_key: def.key, is_active: true },
  });
  if (!row) {
    const err = new Error(`${def.label} is not active at this hospital`);
    err.statusCode = 400;
    throw err;
  }
}

async function validateDestinationForPatient({ patient, destinationDepartment, sourceRole }) {
  if (!isValidHospitalDepartment(destinationDepartment)) {
    return 'Invalid hospital destination department';
  }
  const allowed = allowedHospitalDepartmentsForPatient({
    dateOfBirth: patient?.date_of_birth,
    sourceRole,
  });
  if (!allowed.includes(destinationDepartment)) {
    return `Patient cannot be referred to ${departmentLabel(destinationDepartment)} based on age and source department rules`;
  }
  return null;
}

async function createTransferPlan({
  visitId,
  clinicFacilityId,
  destinationDepartment,
  plannedBy,
  sourceRole,
  transferReason,
  equipmentRequired,
  equipmentNotes,
  equipmentChecklist,
  externalPorterNotes,
  internalPorterNotes,
  criticalNotes,
  transaction,
}) {
  const visit = await Visit.findByPk(visitId, {
    include: [{ association: 'patient' }],
    transaction,
  });
  if (!visit) throw Object.assign(new Error('Visit not found'), { statusCode: 404 });

  const validationError = await validateDestinationForPatient({
    patient: visit.patient,
    destinationDepartment,
    sourceRole,
  });
  if (validationError) throw Object.assign(new Error(validationError), { statusCode: 400 });

  const existing = await ClinicHospitalTransfer.findOne({
    where: {
      visit_id: visitId,
      transfer_status: ['pending_booking', 'transport_initiated', 'external_in_transit', 'departed_clinic', 'arrived_hospital', 'internal_in_transit', 'delivered_to_department'],
    },
    transaction,
  });
  if (existing) return existing;

  return ClinicHospitalTransfer.create({
    id: uuidv4(),
    visit_id: visitId,
    clinic_facility_id: clinicFacilityId || visit.facility_id,
    destination_department: destinationDepartment,
    transfer_status: 'pending_booking',
    transfer_reason: transferReason?.trim() || null,
    equipment_required: equipmentRequired || 'stretcher',
    equipment_notes: equipmentNotes?.trim() || null,
    equipment_checklist: equipmentChecklist || null,
    external_porter_notes: externalPorterNotes?.trim() || null,
    internal_porter_notes: internalPorterNotes?.trim() || null,
    critical_notes: criticalNotes?.trim() || null,
    planned_by: plannedBy,
    planned_at: new Date(),
    source_role: sourceRole,
  }, { transaction });
}

async function getTransferForVisit(visitId) {
  const transfer = await ClinicHospitalTransfer.findOne({
    where: { visit_id: visitId },
    order: [['created_at', 'DESC']],
    include: [
      { association: 'clinicFacility', attributes: ['id', 'name', 'type'] },
      { association: 'hospitalFacility', attributes: ['id', 'name', 'type'] },
      { association: 'externalTransport' },
      { association: 'internalTransport' },
      { association: 'referral' },
      ...TRANSFER_USER_INCLUDES,
    ],
  });
  return serializeTransfer(transfer);
}

async function initiateTransportFromBooking({
  transferId,
  hospitalFacilityId,
  initiatedBy,
  transferReason,
  transaction,
}) {
  const transfer = await ClinicHospitalTransfer.findByPk(transferId, {
    include: [
      { association: 'visit', include: [{ association: 'patient' }] },
      { association: 'clinicFacility' },
    ],
    transaction,
  });
  if (!transfer) throw Object.assign(new Error('Transfer plan not found'), { statusCode: 404 });
  if (transfer.transfer_status !== 'pending_booking') {
    throw Object.assign(new Error('Transport has already been initiated for this patient'), { statusCode: 400 });
  }

  const hospital = await Facility.findByPk(hospitalFacilityId, { transaction });
  if (!hospital || !isHospitalFacility(hospital)) {
    throw Object.assign(new Error('Select a valid state hospital'), { statusCode: 400 });
  }

  const clinic = transfer.clinicFacility || await Facility.findByPk(transfer.clinic_facility_id, { transaction });
  const patient = transfer.visit?.patient;
  const patientName = patient
    ? [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim()
    : 'Patient';

  const referral = await Referral.create({
    id: uuidv4(),
    visit_id: transfer.visit_id,
    referred_by: initiatedBy,
    referral_type: 'external_facility',
    reason: (transferReason || transfer.transfer_reason || 'Clinic referral to state hospital').trim(),
    destination: hospital.name,
    destination_facility_id: hospital.id,
    destination_department: transfer.destination_department,
    clinic_hospital_transfer_id: transfer.id,
    status: 'pending',
  }, { transaction });

  const externalTransport = await TransportRequest.create({
    id: uuidv4(),
    visit_id: transfer.visit_id,
    facility_id: hospital.id,
    origin_facility_id: clinic.id,
    transport_scope: 'external',
    origin_facility_name: clinic.name,
    external_patient_name: patientName,
    from_location: `${clinic.name} — Booking Room`,
    to_location: `${hospital.name} — Receiving`,
    destination_department: transfer.destination_department,
    equipment_required: transfer.equipment_required || 'stretcher',
    equipment_notes: transfer.equipment_notes,
    equipment_checklist: transfer.equipment_checklist,
    critical_notes: [transfer.critical_notes, transfer.external_porter_notes].filter(Boolean).join('\n\n') || null,
    priority: transfer.visit?.visit_type === 'emergency' ? 'emergency' : 'normal',
    requested_by: initiatedBy,
    clinic_hospital_transfer_id: transfer.id,
    status: 'pending',
  }, { transaction });

  const now = new Date();
  await transfer.update({
    hospital_facility_id: hospital.id,
    referral_id: referral.id,
    external_transport_id: externalTransport.id,
    transfer_status: 'transport_initiated',
    initiated_by: initiatedBy,
    initiated_at: now,
    transfer_reason: (transferReason || transfer.transfer_reason || '').trim() || transfer.transfer_reason,
  }, { transaction });

  return { transfer, referral, externalTransport, clinic, hospital };
}

async function onExternalTransportStarted(transferId, porterId) {
  const transfer = await ClinicHospitalTransfer.findByPk(transferId);
  if (!transfer || transfer.transfer_status !== 'transport_initiated') return;
  const now = new Date();
  await transfer.update({
    transfer_status: 'external_in_transit',
    external_picked_up_at: now,
    external_picked_up_by: porterId || null,
  });
}

async function confirmClinicDeparture({ transferId, confirmedBy }) {
  const transfer = await ClinicHospitalTransfer.findByPk(transferId);
  if (!transfer) throw Object.assign(new Error('Transfer not found'), { statusCode: 404 });
  if (!['transport_initiated', 'external_in_transit'].includes(transfer.transfer_status)) {
    throw Object.assign(new Error('External pickup must be in progress before confirming departure'), { statusCode: 400 });
  }
  const now = new Date();
  await transfer.update({
    transfer_status: 'departed_clinic',
    departure_confirmed_by: confirmedBy,
    departure_confirmed_at: now,
  });
  return ClinicHospitalTransfer.findByPk(transferId, { include: TRANSFER_USER_INCLUDES });
}

async function createHospitalVisitForTransfer(transfer, transaction) {
  const clinicVisit = await Visit.findByPk(transfer.visit_id, {
    include: [{ association: 'patient' }],
    transaction,
  });
  if (!clinicVisit) throw new Error('Clinic visit not found');

  const hospitalVisit = await Visit.create({
    id: uuidv4(),
    patient_id: clinicVisit.patient_id,
    facility_id: transfer.hospital_facility_id,
    visit_number: generateVisitNumber(),
    visit_type: clinicVisit.visit_type === 'emergency' ? 'emergency' : 'new',
    status: 'in_progress',
    current_department: transfer.destination_department,
    created_by: transfer.initiated_by || transfer.planned_by,
  }, { transaction });

  return hospitalVisit;
}

async function onExternalTransportCompleted(transferId) {
  const t = await sequelize.transaction();
  try {
    const transfer = await ClinicHospitalTransfer.findByPk(transferId, { transaction: t });
    if (!transfer) {
      await t.rollback();
      return null;
    }

    let hospitalVisitId = transfer.hospital_visit_id;
    if (!hospitalVisitId) {
      const hospitalVisit = await createHospitalVisitForTransfer(transfer, t);
      hospitalVisitId = hospitalVisit.id;
    }

    const deptLabel = departmentLabel(transfer.destination_department);
    const internalTransport = await TransportRequest.create({
      id: uuidv4(),
      visit_id: hospitalVisitId,
      facility_id: transfer.hospital_facility_id,
      transport_scope: 'internal',
      from_location: 'Hospital receiving / ambulance bay',
      to_location: deptLabel,
      destination_department: transfer.destination_department,
      equipment_required: transfer.equipment_required || 'stretcher',
      equipment_notes: transfer.equipment_notes,
      equipment_checklist: transfer.equipment_checklist,
      critical_notes: [transfer.critical_notes, transfer.internal_porter_notes].filter(Boolean).join('\n\n') || null,
      priority: 'normal',
      requested_by: transfer.initiated_by,
      clinic_hospital_transfer_id: transfer.id,
      status: 'pending',
    }, { transaction: t });

    await transfer.update({
      hospital_visit_id: hospitalVisitId,
      internal_transport_id: internalTransport.id,
      transfer_status: 'arrived_hospital',
      arrived_hospital_at: new Date(),
    }, { transaction: t });

    await t.commit();

    try {
      const io = getIO();
      emitTransportSocketRefresh(io, 'internal', 'transport:new_request', { transportRequest: internalTransport });
      emitTransportSocketRefresh(io, 'internal', 'transport:queue_refresh', { reason: 'clinic_arrival' });
      io.to(`room:${transfer.destination_department}`).emit('hospital:inbound_patient', {
        transferId: transfer.id,
        destinationDepartment: transfer.destination_department,
      });
    } catch (e) {
      /* ignore */
    }

    return { transfer, internalTransport };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function onInternalTransportStarted(transferId, porterId) {
  const transfer = await ClinicHospitalTransfer.findByPk(transferId);
  if (!transfer) return;
  if (['arrived_hospital', 'internal_in_transit'].includes(transfer.transfer_status)) {
    const now = new Date();
    await transfer.update({
      transfer_status: 'internal_in_transit',
      internal_picked_up_at: transfer.internal_picked_up_at || now,
      internal_picked_up_by: porterId || transfer.internal_picked_up_by || null,
    });
  }
}

async function onInternalTransportCompleted(transferId) {
  const t = await sequelize.transaction();
  try {
    const transfer = await ClinicHospitalTransfer.findByPk(transferId, { transaction: t });
    if (!transfer || !transfer.hospital_visit_id) {
      await t.rollback();
      return null;
    }

    await assertHospitalQueueDepartmentActive(transfer.hospital_facility_id, transfer.destination_department);

    await queueService.pushToQueue({
      visit_id: transfer.hospital_visit_id,
      department: transfer.destination_department,
      priority: 'normal',
      pushed_by: transfer.initiated_by,
      notes: `Clinic referral — ${departmentLabel(transfer.destination_department)}`,
    }, t);

    await transfer.update({
      transfer_status: 'delivered_to_department',
      delivered_to_department_at: new Date(),
    }, { transaction: t });
    await Referral.update({ status: 'accepted' }, { where: { id: transfer.referral_id }, transaction: t });

    await t.commit();

    try {
      const io = getIO();
      const entries = await queueService.getQueue(transfer.destination_department, transfer.hospital_facility_id);
      io.to(`room:${transfer.destination_department}`).emit('queue:refresh', {
        department: transfer.destination_department,
        entries,
      });
    } catch (e) {
      /* ignore */
    }

    return transfer;
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function confirmDepartmentReceipt({ transferId, receivedBy }) {
  const transfer = await ClinicHospitalTransfer.findByPk(transferId);
  if (!transfer) throw Object.assign(new Error('Transfer not found'), { statusCode: 404 });
  if (transfer.transfer_status !== 'delivered_to_department') {
    throw Object.assign(new Error('Patient must be delivered before confirming receipt'), { statusCode: 400 });
  }

  await transfer.update({
    transfer_status: 'received',
    received_by: receivedBy,
    received_at: new Date(),
  });

  if (transfer.referral_id) {
    await Referral.update({ status: 'completed' }, { where: { id: transfer.referral_id } });
  }

  const clinicVisit = await Visit.findByPk(transfer.visit_id);
  if (clinicVisit && clinicVisit.status === 'in_progress') {
    await clinicVisit.update({
      status: 'completed',
      completed_at: new Date(),
      current_department: null,
      current_queue_position: null,
    });
  }

  return ClinicHospitalTransfer.findByPk(transferId, { include: TRANSFER_USER_INCLUDES });
}

async function applyClinicalTransferPlan({
  visitId,
  clinicFacilityId,
  plannedBy,
  sourceRole,
  body,
  transaction,
}) {
  const {
    destination_department: destinationDepartment,
    transfer_reason: transferReason,
    equipment_required: equipmentRequired,
    equipment_notes: equipmentNotes,
    equipment_checklist: equipmentChecklist,
    external_porter_notes: externalPorterNotes,
    internal_porter_notes: internalPorterNotes,
    critical_notes: criticalNotes,
  } = body || {};

  if (!destinationDepartment) {
    const visit = await Visit.findByPk(visitId, {
      include: [{ association: 'patient' }],
      transaction,
    });
    const ageDefault = allowedHospitalDepartmentsForPatient({
      dateOfBirth: visit?.patient?.date_of_birth,
      sourceRole,
    });
    if (ageDefault.length === 1) {
      return createTransferPlan({
        visitId,
        clinicFacilityId,
        destinationDepartment: ageDefault[0],
        plannedBy,
        sourceRole,
        transferReason,
        equipmentRequired,
        equipmentNotes,
        equipmentChecklist,
        externalPorterNotes,
        internalPorterNotes,
        criticalNotes,
        transaction,
      });
    }
    throw Object.assign(new Error('destination_department is required for hospital referral'), { statusCode: 400 });
  }

  return createTransferPlan({
    visitId,
    clinicFacilityId,
    destinationDepartment,
    plannedBy,
    sourceRole,
    transferReason,
    equipmentRequired,
    equipmentNotes,
    equipmentChecklist,
    externalPorterNotes,
    internalPorterNotes,
    criticalNotes,
    transaction,
  });
}

module.exports = {
  VALID_DEPARTMENT_KEYS,
  seedHospitalOutpatientDepartments,
  getQueueDepartmentForHospitalRoleKey,
  assertHospitalQueueDepartmentActive,
  validateDestinationForPatient,
  createTransferPlan,
  applyClinicalTransferPlan,
  getTransferForVisit,
  initiateTransportFromBooking,
  onExternalTransportStarted,
  confirmClinicDeparture,
  onExternalTransportCompleted,
  onInternalTransportStarted,
  onInternalTransportCompleted,
  confirmDepartmentReceipt,
  serializeTransfer,
  serializeTransferWithTimeline,
  buildTransferTimeline,
  TRANSFER_USER_INCLUDES,
};
