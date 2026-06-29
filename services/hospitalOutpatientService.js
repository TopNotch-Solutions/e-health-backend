'use strict';

const { v4: uuidv4 } = require('uuid');
const {
  QueueEntry,
  Visit,
  Patient,
  ClinicHospitalTransfer,
  Consultation,
  Referral,
  Vital,
  Bed,
  Ward,
  Admission,
  TransportRequest,
  sequelize,
} = require('../models');
const { departmentForRole, departmentLabel } = require('../config/hospitalOutpatientConfig');
const {
  vitalsProfileForDepartment,
  clinicalConfigForDepartment,
  admitWardTypesForDepartment,
  assertVitalsForProfile,
  formatVitalsSummary,
} = require('../config/hospitalOutpatientClinicalConfig');
const { confirmDepartmentReceipt, serializeTransferWithTimeline } = require('./clinicHospitalTransferService');
const queueService = require('./queueService');
const { finalizeOutpatientDischarge } = require('./visitDischargeService');
const notificationService = require('./notificationService');
const { getIO } = require('../socket');
const { emitTransportSocketRefresh } = require('../config/porterRoles');

const INPATIENT_WARD_TYPES = ['icu', 'specialized_inpatient', 'surgical_complex', 'outpatient_specialist'];

const WARD_TYPE_LABELS = {
  icu: 'ICU',
  specialized_inpatient: 'Specialized inpatient',
  surgical_complex: 'Surgical complex',
  outpatient_specialist: 'Outpatient specialist',
};

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function loadQueueEntryForUser(queueEntryId, user) {
  const department = departmentForRole(user?.role?.name);
  if (!department) throw httpError('Your role is not linked to a hospital outpatient department', 403);

  const entry = await QueueEntry.findByPk(queueEntryId, {
    include: [{ association: 'visit', include: [{ association: 'patient' }] }],
  });
  if (!entry) throw httpError('Queue entry not found', 404);
  if (entry.department !== department) throw httpError('Queue entry is not for your department', 403);

  return { entry, department };
}

async function assertActiveSession(entry, userId) {
  if (entry.status !== 'in_progress') {
    throw httpError('Patient must be started before continuing', 400);
  }
  if (entry.assigned_to !== userId) {
    throw httpError('You can only process patients assigned to you', 403);
  }
}

async function findTransferForEntry(entry) {
  return ClinicHospitalTransfer.findOne({
    where: { hospital_visit_id: entry.visit_id },
    order: [['created_at', 'DESC']],
    include: [
      { association: 'clinicFacility', attributes: ['id', 'name'] },
      { association: 'hospitalFacility', attributes: ['id', 'name'] },
      { association: 'referral' },
      { association: 'plannedBy', attributes: ['id', 'first_name', 'last_name'] },
    ],
  });
}

async function loadClinicConsultation(clinicVisitId) {
  if (!clinicVisitId) return null;
  return Consultation.findOne({
    where: { visit_id: clinicVisitId },
    include: [{ association: 'doctor', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['created_at', 'DESC']],
  });
}

async function loadClinicVitals(clinicVisitId) {
  if (!clinicVisitId) return null;
  return Vital.findOne({
    where: { visit_id: clinicVisitId },
    include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['recorded_at', 'DESC']],
  });
}

async function loadHospitalVitals(hospitalVisitId) {
  return Vital.findOne({
    where: { visit_id: hospitalVisitId },
    include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['recorded_at', 'DESC']],
  });
}

async function loadBedsByWardType(facilityId) {
  const beds = await Bed.findAll({
    where: { status: 'available' },
    include: [{
      model: Ward,
      as: 'ward',
      where: {
        facility_id: facilityId,
        ward_type: INPATIENT_WARD_TYPES,
      },
      attributes: ['id', 'name', 'ward_number', 'ward_type'],
    }],
    order: [
      [{ model: Ward, as: 'ward' }, 'name', 'ASC'],
      ['room_number', 'ASC'],
      ['bed_number', 'ASC'],
    ],
  });

  const grouped = {};
  for (const type of INPATIENT_WARD_TYPES) {
    grouped[type] = {
      label: WARD_TYPE_LABELS[type],
      beds: [],
    };
  }
  for (const bed of beds) {
    const type = bed.ward?.ward_type;
    if (!grouped[type]) continue;
    grouped[type].beds.push({
      id: bed.id,
      bed_number: bed.bed_number,
      room_number: bed.room_number,
      ward_id: bed.ward_id,
      ward_name: bed.ward.name,
      ward_number: bed.ward.ward_number,
    });
  }
  return grouped;
}

async function pickAvailableBedForWardType(facilityId, wardType, transaction = null) {
  const bed = await Bed.findOne({
    where: { status: 'available' },
    include: [{
      model: Ward,
      as: 'ward',
      where: { facility_id: facilityId, ward_type: wardType },
      attributes: ['id', 'name', 'ward_number', 'ward_type', 'facility_id'],
    }],
    order: [
      [{ model: Ward, as: 'ward' }, 'name', 'ASC'],
      ['room_number', 'ASC'],
      ['bed_number', 'ASC'],
    ],
    transaction,
  });

  if (!bed) {
    throw httpError(
      `No available beds in ${WARD_TYPE_LABELS[wardType] || wardType}`,
      409
    );
  }

  return bed;
}

async function buildWorkspace(entry, user) {
  const transfer = await findTransferForEntry(entry);
  const clinicVisitId = transfer?.visit_id || null;
  const [clinicConsultation, clinicVitals, hospitalVitals, bedsByWardType] = await Promise.all([
    loadClinicConsultation(clinicVisitId),
    loadClinicVitals(clinicVisitId),
    loadHospitalVitals(entry.visit_id),
    loadBedsByWardType(user.facility_id),
  ]);

  return {
    entry,
    transfer: serializeTransferWithTimeline(transfer),
    clinic_consultation: clinicConsultation,
    clinic_vitals: clinicVitals,
    hospital_vitals: hospitalVitals,
    beds_by_ward_type: bedsByWardType,
    department_label: departmentLabel(entry.department),
  };
}

async function startSession({ queueEntryId, user }) {
  const { entry, department } = await loadQueueEntryForUser(queueEntryId, user);
  const transfer = await findTransferForEntry(entry);

  if (transfer?.transfer_status === 'delivered_to_department') {
    await confirmDepartmentReceipt({ transferId: transfer.id, receivedBy: user.id });
  } else if (transfer && transfer.transfer_status !== 'received') {
    throw httpError('Patient must be delivered to the department before starting a session', 400);
  }

  if (entry.status === 'waiting') {
    await queueService.startEntry(entry.id, user.id);
  } else if (entry.status === 'in_progress' && entry.assigned_to !== user.id) {
    throw httpError('Patient is being seen by another staff member', 409);
  }

  const refreshed = await QueueEntry.findByPk(entry.id, {
    include: [{ association: 'visit', include: [{ association: 'patient' }] }],
  });

  return buildWorkspace(refreshed, user);
}

const DECIMAL_VITAL_FIELDS = new Set(['temperature', 'oxygen_saturation', 'weight', 'blood_glucose']);
const TEXT_VITAL_FIELDS = new Set(['pupillary_check']);

function parseVitalFieldValue(field, raw) {
  if (TEXT_VITAL_FIELDS.has(field)) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text || null;
  }
  if (raw === '' || raw == null) return null;
  const num = Number(raw);
  if (Number.isNaN(num)) return null;
  return DECIMAL_VITAL_FIELDS.has(field) ? num : Math.round(num);
}

async function saveVitals({
  visitId,
  queueEntryId,
  temperature,
  pulse_rate,
  oxygen_saturation,
  blood_pressure_systolic,
  blood_pressure_diastolic,
  respiratory_rate,
  gcs_score,
  pain_score,
  weight,
  blood_glucose,
  pupillary_check,
  is_critical,
  notes,
  user,
}) {
  const { entry } = await loadQueueEntryForUser(queueEntryId, user);
  if (entry.visit_id !== visitId) throw httpError('Invalid queue entry for this visit', 400);
  await assertActiveSession(entry, user.id);

  const profile = vitalsProfileForDepartment(entry.department);
  if (!profile) throw httpError('Clinical vitals are not configured for this department', 400);

  const vitalPayload = {
    notes: notes?.trim() || (is_critical ? 'Critical patient — ICU routing considered' : null),
  };

  const inputs = {
    temperature,
    pulse_rate,
    oxygen_saturation,
    blood_pressure_systolic,
    blood_pressure_diastolic,
    respiratory_rate,
    gcs_score,
    pain_score,
    weight,
    blood_glucose,
    pupillary_check,
  };

  for (const field of profile.required) {
    const parsed = parseVitalFieldValue(field, inputs[field]);
    if (parsed == null) {
      const label = profile.labels[field] || field;
      throw httpError(`${label} is required`, 400);
    }
    if (field === 'gcs_score' && (parsed < 3 || parsed > 15)) {
      throw httpError('GCS must be between 3 and 15', 400);
    }
    if (field === 'pain_score' && (parsed < 0 || parsed > 10)) {
      throw httpError('Pain score must be between 0 and 10', 400);
    }
    vitalPayload[field] = parsed;
  }

  const existing = await loadHospitalVitals(visitId);
  let vital;
  if (existing) {
    await existing.update(vitalPayload);
    vital = existing;
  } else {
    vital = await Vital.create({
      id: uuidv4(),
      visit_id: visitId,
      recorded_by: user.id,
      ...vitalPayload,
    });
  }

  return {
    vital,
    is_critical: Boolean(is_critical),
    beds_by_ward_type: await loadBedsByWardType(user.facility_id),
  };
}

async function admitToWard({
  visitId,
  queueEntryId,
  bedId,
  wardType,
  criticalNotes,
  user,
}) {
  if (!INPATIENT_WARD_TYPES.includes(wardType)) {
    throw httpError('Invalid ward type for inpatient admission', 400);
  }

  const { entry, department } = await loadQueueEntryForUser(queueEntryId, user);
  if (entry.visit_id !== visitId) throw httpError('Invalid queue entry for this visit', 400);
  await assertActiveSession(entry, user.id);

  const allowedWardTypes = admitWardTypesForDepartment(department);
  if (allowedWardTypes && !allowedWardTypes.includes(wardType)) {
    throw httpError('This ward type is not available for your department', 400);
  }

  const hospitalVitals = await loadHospitalVitals(visitId);
  const profile = vitalsProfileForDepartment(entry.department);
  try {
    assertVitalsForProfile(hospitalVitals, profile);
  } catch (err) {
    throw httpError(err.message, err.statusCode || 400);
  }

  const t = await sequelize.transaction();
  try {
    const visit = await Visit.findByPk(visitId, {
      include: [{ model: Patient, as: 'patient', attributes: ['id', 'is_emergency'] }],
      transaction: t,
    });
    if (!visit) throw httpError('Visit not found', 404);

    let bed;
    if (bedId) {
      bed = await Bed.findByPk(bedId, {
        include: [{ model: Ward, as: 'ward' }],
        transaction: t,
      });
      if (!bed) throw httpError('Bed not found', 404);
      if (bed.status !== 'available') throw httpError('Bed is not available', 400);
      if (bed.ward?.facility_id !== user.facility_id) throw httpError('Bed is not in your facility', 403);
      if (bed.ward?.ward_type !== wardType) {
        throw httpError(`Selected bed is not in a ${WARD_TYPE_LABELS[wardType] || wardType} ward`, 400);
      }
    } else {
      bed = await pickAvailableBedForWardType(user.facility_id, wardType, t);
    }

    const resolvedBedId = bed.id;

    const transportPriority =
      visit.patient?.is_emergency || wardType === 'icu' ? 'emergency' : 'normal';

    const admission = await Admission.create({
      id: uuidv4(),
      visit_id: visitId,
      bed_id: resolvedBedId,
      admitted_by: user.id,
      status: 'pending_arrival',
      admitted_at: null,
    }, { transaction: t });

    await bed.update({ status: 'reserved' }, { transaction: t });

    const fromLocation = departmentLabel(department) || 'Hospital Outpatient';
    const transportReq = await TransportRequest.create({
      id: uuidv4(),
      visit_id: visitId,
      facility_id: visit.facility_id,
      transport_scope: 'internal',
      from_location: fromLocation,
      to_location: [
        bed.ward.name,
        bed.room_number ? `Room ${bed.room_number}` : null,
        `Bed ${bed.bed_number}`,
      ].filter(Boolean).join(' — '),
      equipment_required: 'wheelchair',
      critical_notes: criticalNotes?.trim() || hospitalVitals.notes || null,
      priority: transportPriority,
      requested_by: user.id,
    }, { transaction: t });

    await Consultation.create({
      id: uuidv4(),
      visit_id: visitId,
      doctor_id: user.id,
      diagnosis: `Admitted to ${WARD_TYPE_LABELS[wardType]}`,
      notes: [
        formatVitalsSummary(hospitalVitals, profile),
        criticalNotes?.trim(),
      ].filter(Boolean).join('\n'),
      actions_taken: {
        hospital_outpatient_disposition: 'admit',
        ward_type: wardType,
        bed_id: resolvedBedId,
        admission_id: admission.id,
      },
    }, { transaction: t });

    await visit.update({ current_department: 'ward' }, { transaction: t });

    await queueService.completeEntry(
      queueEntryId,
      { pushed_by: user.id, notes: `Admitted to ${WARD_TYPE_LABELS[wardType]}` },
      t
    );

    await t.commit();

    notificationService.emitTransportRequest({
      transportRequest: transportReq,
      admission,
      bed: { id: bed.id, bed_number: bed.bed_number, ward_name: bed.ward.name },
    });
    notificationService.emitWardStaffAdmission({
      admission_id: admission.id,
      visit_id: visitId,
      bed_id: bed.id,
      ward_id: bed.ward_id,
      facility_id: user.facility_id,
    });

    try {
      const io = getIO();
      emitTransportSocketRefresh(io, 'internal', 'transport:queue_refresh', { reason: 'new_request' });
      const entries = await queueService.getQueue(department, user.facility_id);
      io.to(`room:${department}`).emit('queue:refresh', { department, entries });
    } catch (e) {
      /* ignore */
    }

    return { admission, bed, transport_request: transportReq };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function dischargePatient({
  visitId,
  queueEntryId,
  dischargeReason,
  notes,
  user,
}) {
  const reason = (dischargeReason || '').trim();
  if (!reason) throw httpError('discharge_reason is required', 400);

  const { entry, department } = await loadQueueEntryForUser(queueEntryId, user);
  if (entry.visit_id !== visitId) throw httpError('Invalid queue entry for this visit', 400);
  await assertActiveSession(entry, user.id);

  const hospitalVitals = await loadHospitalVitals(visitId);
  const profile = vitalsProfileForDepartment(entry.department);
  const deptConfig = clinicalConfigForDepartment(entry.department);
  try {
    assertVitalsForProfile(hospitalVitals, profile);
  } catch (err) {
    throw httpError(err.message, err.statusCode || 400);
  }

  const t = await sequelize.transaction();
  try {
    await Consultation.create({
      id: uuidv4(),
      visit_id: visitId,
      doctor_id: user.id,
      diagnosis: deptConfig?.dischargeDiagnosis || 'Discharged from hospital outpatient',
      notes: [
        reason,
        notes?.trim(),
        formatVitalsSummary(hospitalVitals, profile),
      ].filter(Boolean).join('\n'),
      actions_taken: {
        hospital_outpatient_disposition: 'discharge',
        discharge_reason: reason,
      },
    }, { transaction: t });

    await queueService.completeEntry(
      queueEntryId,
      { pushed_by: user.id, notes: `Discharged: ${reason}` },
      t
    );

    const dischargeResult = await finalizeOutpatientDischarge({
      visitId,
      dischargeNotes: reason,
      userId: user.id,
      facilityId: user.facility_id,
      transaction: t,
    });

    await t.commit();

    try {
      const io = getIO();
      const entries = await queueService.getQueue(department, user.facility_id);
      io.to(`room:${department}`).emit('queue:refresh', { department, entries });
    } catch (e) {
      /* ignore */
    }

    return dischargeResult;
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

module.exports = {
  INPATIENT_WARD_TYPES,
  WARD_TYPE_LABELS,
  loadQueueEntryForUser,
  buildWorkspace,
  startSession,
  saveVitals,
  admitToWard,
  dischargePatient,
};
