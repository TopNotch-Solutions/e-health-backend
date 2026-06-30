'use strict';

const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Admission,
  Bed,
  Ward,
  Patient,
  TransportRequest,
  SpecializedInpatientDailyRecord,
  MortuaryRecord,
  sequelize,
} = require('../models');
const notificationService = require('./notificationService');
const { finalizeOutpatientDischarge } = require('./visitDischargeService');
const { ADMIT_TRANSPORT_CHECKLIST_OPTIONS } = require('../constants/admitTransportChecklist');
const {
  validateSpecializedInpatientDailyRecord,
  validateSpecializedInpatientPorterTransport,
  validateSpecializedInpatientMortuaryTransfer,
  validateSpecializedInpatientWardTransfer,
  validateSpecializedInpatientDischarge,
} = require('../config/specializedInpatientWardValidation');
const { onIcuTransferTransportCompleted } = require('./icuWardService');

const WARD_TYPE = 'specialized_inpatient';

const WARD_TYPE_LABELS = {
  general: 'General ward',
  icu: 'ICU',
  surgical_complex: 'Surgical complex',
  outpatient_specialist: 'Outpatient specialist',
};

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function bedLocationLabel(bed) {
  const ward = bed?.ward || {};
  return [
    ward.name,
    bed.room_number ? `Room ${bed.room_number}` : null,
    bed.bed_number ? `Bed ${bed.bed_number}` : null,
  ].filter(Boolean).join(' — ');
}

async function pickAvailableBedForWardType(facilityId, wardType, transaction) {
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
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });

  if (!bed) {
    throw httpError(`No available beds in ${WARD_TYPE_LABELS[wardType] || wardType}`, 409);
  }

  return bed;
}

function parseEquipmentChecklist(equipment_checklist) {
  const allowedIds = new Set(ADMIT_TRANSPORT_CHECKLIST_OPTIONS.map((o) => o.id));
  if (!Array.isArray(equipment_checklist) || equipment_checklist.length === 0) return null;
  const picked = equipment_checklist
    .filter((row) => row && row.checked && allowedIds.has(row.id))
    .map((row) => {
      const opt = ADMIT_TRANSPORT_CHECKLIST_OPTIONS.find((o) => o.id === row.id);
      return opt ? { id: opt.id, label: opt.label } : null;
    })
    .filter(Boolean);
  return picked.length ? picked : null;
}

function resolveTransportFields(transport = {}, fallbackCriticalNotes = null) {
  const critical = transport.critical_notes?.trim() || fallbackCriticalNotes || null;
  return {
    equipment_required: transport.equipment_required || 'stretcher',
    equipment_notes: transport.equipment_notes?.trim() || null,
    critical_notes: critical,
    equipment_checklist: parseEquipmentChecklist(transport.equipment_checklist),
  };
}

async function loadSpecializedInpatientAdmission(admissionId, facilityId, { transaction, lock } = {}) {
  const admission = await Admission.findByPk(admissionId, {
    include: [
      { model: Bed, as: 'bed', include: [{ model: Ward, as: 'ward' }] },
      { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
    ],
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined,
  });

  if (!admission) throw httpError('Admission not found', 404);
  if (!admission.bed?.ward || admission.bed.ward.facility_id !== facilityId) {
    throw httpError('Admission not found', 404);
  }
  if (admission.bed.ward.ward_type !== WARD_TYPE) {
    throw httpError('This action is only available for specialized inpatient admissions', 400);
  }
  if (admission.status !== 'admitted') {
    throw httpError('Patient must be actively admitted in specialized inpatient', 400);
  }

  return admission;
}

async function assertNoActiveOutboundTransfer(admissionId, transaction) {
  const active = await TransportRequest.findOne({
    where: {
      source_admission_id: admissionId,
      status: { [Op.in]: ['pending', 'in_transit'] },
    },
    transaction,
  });
  if (active) {
    throw httpError('A transport is already in progress for this patient', 409);
  }
}

async function assertTodayDailyRecordSaved(admissionId, transaction) {
  const record = await SpecializedInpatientDailyRecord.findOne({
    where: { admission_id: admissionId, record_date: todayDateString() },
    transaction,
  });
  if (!record) {
    throw httpError("Save today's specialized inpatient daily record before this action", 400);
  }
}

function formatDailyRecord(row) {
  const json = row.toJSON ? row.toJSON() : row;
  return {
    id: json.id,
    admission_id: json.admission_id,
    visit_id: json.visit_id,
    record_date: json.record_date,
    heart_rate: json.heart_rate,
    oxygen_saturation: json.oxygen_saturation,
    respiration_rate: json.respiration_rate,
    body_temperature: json.body_temperature,
    blood_pressure_systolic: json.blood_pressure_systolic,
    blood_pressure_diastolic: json.blood_pressure_diastolic,
    recorded_by: json.recordedBy
      ? {
          id: json.recordedBy.id,
          name: [json.recordedBy.first_name, json.recordedBy.last_name].filter(Boolean).join(' '),
        }
      : null,
    created_at: json.created_at,
    updated_at: json.updated_at,
  };
}

async function listAdmittedPatients(facilityId) {
  const today = todayDateString();

  const admissions = await Admission.findAll({
    where: { status: 'admitted' },
    include: [
      {
        model: Bed,
        as: 'bed',
        required: true,
        include: [{
          model: Ward,
          as: 'ward',
          required: true,
          where: { facility_id: facilityId, ward_type: WARD_TYPE },
        }],
      },
      { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
      {
        association: 'specializedInpatientDailyRecords',
        required: false,
        attributes: ['id', 'record_date'],
        where: { record_date: today },
      },
    ],
    order: [['admitted_at', 'ASC']],
  });

  if (!admissions.length) return [];

  const admissionIds = admissions.map((a) => a.id);
  const activeTransfers = await TransportRequest.findAll({
    where: {
      source_admission_id: { [Op.in]: admissionIds },
      status: { [Op.in]: ['pending', 'in_transit'] },
    },
    attributes: ['source_admission_id'],
  });
  const transferPending = new Set(activeTransfers.map((t) => t.source_admission_id));

  return admissions.filter(
    (admission) => !admission.specializedInpatientDailyRecords?.length && !transferPending.has(admission.id)
  );
}

async function listDailyRecords(admissionId, facilityId) {
  await loadSpecializedInpatientAdmission(admissionId, facilityId);
  const records = await SpecializedInpatientDailyRecord.findAll({
    where: { admission_id: admissionId },
    include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['record_date', 'DESC']],
  });
  return records.map(formatDailyRecord);
}

function normalizeRecordDate(value) {
  if (!value) return todayDateString();
  const d = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw httpError('Invalid record_date', 400);
  }
  return d;
}

function pickVitals(body) {
  return {
    heart_rate: body.heart_rate != null && body.heart_rate !== '' ? Number(body.heart_rate) : null,
    oxygen_saturation:
      body.oxygen_saturation != null && body.oxygen_saturation !== ''
        ? Number(body.oxygen_saturation)
        : null,
    respiration_rate:
      body.respiration_rate != null && body.respiration_rate !== ''
        ? Number(body.respiration_rate)
        : null,
    body_temperature:
      body.body_temperature != null && body.body_temperature !== ''
        ? Number(body.body_temperature)
        : null,
    blood_pressure_systolic:
      body.blood_pressure_systolic != null && body.blood_pressure_systolic !== ''
        ? Number(body.blood_pressure_systolic)
        : null,
    blood_pressure_diastolic:
      body.blood_pressure_diastolic != null && body.blood_pressure_diastolic !== ''
        ? Number(body.blood_pressure_diastolic)
        : null,
  };
}

async function upsertDailyRecordForAdmission({ admission, userId, body, transaction }) {
  validateSpecializedInpatientDailyRecord(body);
  const recordDate = normalizeRecordDate(body.record_date);
  const vitals = pickVitals(body);

  const [record, created] = await SpecializedInpatientDailyRecord.findOrCreate({
    where: { admission_id: admission.id, record_date: recordDate },
    defaults: {
      id: uuidv4(),
      visit_id: admission.visit_id,
      recorded_by: userId,
      ...vitals,
    },
    transaction,
  });

  if (!created) {
    await record.update({ ...vitals, recorded_by: userId }, { transaction });
  }

  return record;
}

async function saveDailyRecord({ admissionId, facilityId, userId, body }) {
  const t = await sequelize.transaction();
  try {
    const admission = await loadSpecializedInpatientAdmission(admissionId, facilityId, { transaction: t, lock: true });
    await assertNoActiveOutboundTransfer(admissionId, t);

    const record = await upsertDailyRecordForAdmission({
      admission,
      userId,
      body,
      transaction: t,
    });

    await t.commit();

    notificationService.emitWardStaffQueueRefresh({ reason: 'specialized_inpatient_daily_saved' });

    const refreshed = await SpecializedInpatientDailyRecord.findByPk(record.id, {
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });
    return formatDailyRecord(refreshed);
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function transferToWard({ admissionId, facilityId, userId, targetWardType, bedId, transport }) {
  validateSpecializedInpatientWardTransfer({ target_ward_type: targetWardType, transport });
  const transportFields = resolveTransportFields(
    transport,
    `Specialized inpatient to ${WARD_TYPE_LABELS[targetWardType] || targetWardType} transfer`
  );

  const t = await sequelize.transaction();
  try {
    const admission = await loadSpecializedInpatientAdmission(admissionId, facilityId, { transaction: t, lock: true });
    await assertNoActiveOutboundTransfer(admissionId, t);
    await assertTodayDailyRecordSaved(admissionId, t);

    let targetBed;
    if (bedId) {
      targetBed = await Bed.findByPk(bedId, {
        include: [{ model: Ward, as: 'ward' }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!targetBed) throw httpError('Target bed not found', 404);
      if (targetBed.status !== 'available') throw httpError('Selected bed is not available', 400);
      if (targetBed.ward?.facility_id !== facilityId) throw httpError('Bed is not in your facility', 403);
      if (targetBed.ward?.ward_type !== targetWardType) {
        throw httpError(`Selected bed is not in ${WARD_TYPE_LABELS[targetWardType] || targetWardType}`, 400);
      }
    } else {
      targetBed = await pickAvailableBedForWardType(facilityId, targetWardType, t);
    }

    const targetAdmission = await Admission.create({
      id: uuidv4(),
      visit_id: admission.visit_id,
      bed_id: targetBed.id,
      admitted_by: userId,
      status: 'pending_arrival',
      admitted_at: null,
    }, { transaction: t });

    await targetBed.update({ status: 'reserved' }, { transaction: t });

    const transportReq = await TransportRequest.create({
      id: uuidv4(),
      visit_id: admission.visit_id,
      facility_id: facilityId,
      transport_scope: 'internal',
      from_location: bedLocationLabel(admission.bed),
      to_location: bedLocationLabel(targetBed),
      equipment_required: transportFields.equipment_required,
      equipment_notes: transportFields.equipment_notes,
      critical_notes: transportFields.critical_notes,
      equipment_checklist: transportFields.equipment_checklist,
      priority: admission.visit?.patient?.is_emergency ? 'emergency' : 'normal',
      requested_by: userId,
      source_admission_id: admission.id,
      target_admission_id: targetAdmission.id,
      transfer_type: 'ward_transfer',
    }, { transaction: t });

    await t.commit();

    notificationService.emitWardStaffQueueRefresh({ reason: 'specialized_inpatient_transfer' });
    notificationService.emitTransportRequest({
      transportRequest: transportReq,
      admission,
      bed: {
        id: admission.bed.id,
        bed_number: admission.bed.bed_number,
        ward_name: admission.bed.ward?.name,
      },
    });

    return {
      transport: transportReq,
      target_admission_id: targetAdmission.id,
      target_bed: bedLocationLabel(targetBed),
      target_ward_type: targetWardType,
    };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function dischargePatient({ admissionId, facilityId, userId, discharge_notes }) {
  validateSpecializedInpatientDischarge({ discharge_notes });

  const t = await sequelize.transaction();
  try {
    const admission = await loadSpecializedInpatientAdmission(admissionId, facilityId, { transaction: t, lock: true });
    await assertNoActiveOutboundTransfer(admissionId, t);
    await assertTodayDailyRecordSaved(admissionId, t);

    const notes = discharge_notes?.trim() || 'Discharged from specialized inpatient';

    await admission.update({
      status: 'discharged',
      discharged_at: new Date(),
      discharged_by: userId,
      discharge_notes: notes,
    }, { transaction: t });

    if (admission.bed) {
      await admission.bed.update({ status: 'available' }, { transaction: t });
      notificationService.emitWardUpdate({
        type: 'discharge',
        admission_id: admission.id,
        bed_id: admission.bed_id,
        ward_id: admission.bed.ward_id,
        bed_status: 'available',
      });
    }

    const otherActiveAdmission = await Admission.findOne({
      where: {
        visit_id: admission.visit_id,
        id: { [Op.ne]: admission.id },
        status: { [Op.in]: ['admitted', 'pending_arrival'] },
      },
      transaction: t,
    });

    let dischargeResult = { visit_id: admission.visit_id, status: 'admitted_elsewhere' };
    if (!otherActiveAdmission) {
      dischargeResult = await finalizeOutpatientDischarge({
        visitId: admission.visit_id,
        dischargeNotes: notes,
        userId,
        facilityId,
        transaction: t,
      });
    }

    await t.commit();

    notificationService.emitWardStaffQueueRefresh({ reason: 'specialized_inpatient_discharge' });

    return dischargeResult;
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function transferToMortuary({
  admissionId,
  facilityId,
  userId,
  cause_of_death,
  date_of_death,
  notes,
  transport,
}) {
  const resolvedDateOfDeath = date_of_death || todayDateString();
  validateSpecializedInpatientMortuaryTransfer({ cause_of_death, transport });
  const mortuaryNote = notes?.trim() || cause_of_death?.trim() || null;
  const transportFields = resolveTransportFields(transport, mortuaryNote || 'Specialized inpatient to mortuary');

  const t = await sequelize.transaction();
  try {
    const admission = await loadSpecializedInpatientAdmission(admissionId, facilityId, { transaction: t, lock: true });
    await assertNoActiveOutboundTransfer(admissionId, t);
    await assertTodayDailyRecordSaved(admissionId, t);

    const patient = admission.visit?.patient;
    if (!patient?.id) throw httpError('Patient not found for this admission', 404);

    const mortuaryRecord = await MortuaryRecord.create({
      id: uuidv4(),
      patient_id: patient.id,
      visit_id: admission.visit_id,
      cause_of_death: cause_of_death?.trim() || null,
      date_of_death: resolvedDateOfDeath,
      declared_by: userId,
      notes: notes?.trim() || null,
    }, { transaction: t });

    const transportReq = await TransportRequest.create({
      id: uuidv4(),
      visit_id: admission.visit_id,
      facility_id: facilityId,
      transport_scope: 'internal',
      from_location: bedLocationLabel(admission.bed),
      to_location: 'Mortuary',
      equipment_required: transportFields.equipment_required,
      equipment_notes: transportFields.equipment_notes,
      critical_notes: transportFields.critical_notes,
      equipment_checklist: transportFields.equipment_checklist,
      priority: 'urgent',
      requested_by: userId,
      source_admission_id: admission.id,
      transfer_type: 'mortuary',
      mortuary_record_id: mortuaryRecord.id,
    }, { transaction: t });

    await t.commit();

    notificationService.emitTransportRequest({
      transportRequest: transportReq,
      admission,
      bed: {
        id: admission.bed.id,
        bed_number: admission.bed.bed_number,
        ward_name: admission.bed.ward?.name,
      },
    });

    return { transport: transportReq, mortuary_record_id: mortuaryRecord.id };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

module.exports = {
  WARD_TYPE,
  WARD_TYPE_LABELS,
  listAdmittedPatients,
  listDailyRecords,
  saveDailyRecord,
  upsertDailyRecordForAdmission,
  transferToWard,
  transferToMortuary,
  dischargePatient,
  formatDailyRecord,
  onTransferTransportCompleted: onIcuTransferTransportCompleted,
};
