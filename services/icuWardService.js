'use strict';

const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Admission,
  Bed,
  Ward,
  Visit,
  Patient,
  TransportRequest,
  IcuDailyRecord,
  MortuaryRecord,
  sequelize,
} = require('../models');
const notificationService = require('./notificationService');
const { ADMIT_TRANSPORT_CHECKLIST_OPTIONS } = require('../constants/admitTransportChecklist');
const {
  validateIcuDailyRecord,
  validateIcuPorterTransport,
  validateIcuMortuaryTransfer,
} = require('../config/icuWardValidation');

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function assertTodayDailyRecordSaved(admissionId, transaction) {
  const record = await IcuDailyRecord.findOne({
    where: { admission_id: admissionId, record_date: todayDateString() },
    transaction,
  });
  if (!record) {
    throw httpError("Save today's ICU daily record before requesting transfer", 400);
  }
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
    throw httpError(`No available beds in ${wardType} ward`, 409);
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
  const critical =
    transport.critical_notes?.trim() ||
    fallbackCriticalNotes ||
    null;
  return {
    equipment_required: transport.equipment_required || 'stretcher',
    equipment_notes: transport.equipment_notes?.trim() || null,
    critical_notes: critical,
    equipment_checklist: parseEquipmentChecklist(transport.equipment_checklist),
  };
}

async function loadIcuAdmission(admissionId, facilityId, { transaction, lock } = {}) {
  const admission = await Admission.findByPk(admissionId, {
    include: [
      {
        model: Bed,
        as: 'bed',
        include: [{ model: Ward, as: 'ward' }],
      },
      {
        association: 'visit',
        include: [{ model: Patient, as: 'patient' }],
      },
    ],
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined,
  });

  if (!admission) throw httpError('Admission not found', 404);
  if (!admission.bed?.ward || admission.bed.ward.facility_id !== facilityId) {
    throw httpError('Admission not found', 404);
  }
  if (admission.bed.ward.ward_type !== 'icu') {
    throw httpError('This action is only available for ICU admissions', 400);
  }
  if (admission.status !== 'admitted') {
    throw httpError('Patient must be actively admitted in ICU', 400);
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
    ventilator_pressures_volumes: json.ventilator_pressures_volumes,
    urine_output: json.urine_output,
    arterial_blood_gases: json.arterial_blood_gases,
    neurological_checks: json.neurological_checks,
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
          where: { facility_id: facilityId, ward_type: 'icu' },
        }],
      },
      {
        association: 'visit',
        include: [{ model: Patient, as: 'patient' }],
      },
      {
        association: 'icuDailyRecords',
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
    (admission) => !admission.icuDailyRecords?.length && !transferPending.has(admission.id)
  );
}

async function listDailyRecords(admissionId, facilityId) {
  await loadIcuAdmission(admissionId, facilityId);
  const records = await IcuDailyRecord.findAll({
    where: { admission_id: admissionId },
    include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['record_date', 'DESC']],
  });
  return records.map(formatDailyRecord);
}

function normalizeRecordDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
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
    ventilator_pressures_volumes: body.ventilator_pressures_volumes?.trim() || null,
    urine_output: body.urine_output?.trim() || null,
    arterial_blood_gases: body.arterial_blood_gases?.trim() || null,
    neurological_checks: body.neurological_checks?.trim() || null,
  };
}

async function upsertDailyRecordForAdmission({ admission, userId, body, transaction }) {
  validateIcuDailyRecord(body);
  const recordDate = normalizeRecordDate(body.record_date);
  const vitals = pickVitals(body);

  const [record, created] = await IcuDailyRecord.findOrCreate({
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
    const admission = await loadIcuAdmission(admissionId, facilityId, { transaction: t, lock: true });
    await assertNoActiveOutboundTransfer(admissionId, t);

    const record = await upsertDailyRecordForAdmission({
      admission,
      userId,
      body,
      transaction: t,
    });

    await t.commit();

    notificationService.emitWardStaffQueueRefresh({ reason: 'icu_daily_saved' });

    const refreshed = await IcuDailyRecord.findByPk(record.id, {
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });
    return formatDailyRecord(refreshed);
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function transferToGeneralWard({ admissionId, facilityId, userId, bedId, transport }) {
  validateIcuPorterTransport(transport);
  const transportFields = resolveTransportFields(transport, 'ICU to general ward transfer');

  const t = await sequelize.transaction();
  try {
    const admission = await loadIcuAdmission(admissionId, facilityId, { transaction: t, lock: true });
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
      if (targetBed.ward?.ward_type !== 'general') {
        throw httpError('Transfer destination must be a general ward bed', 400);
      }
    } else {
      targetBed = await pickAvailableBedForWardType(facilityId, 'general', t);
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

    notificationService.emitWardUpdate({
      type: 'icu_transfer_requested',
      admission_id: admission.id,
      ward_id: admission.bed.ward_id,
    });
    notificationService.emitWardStaffQueueRefresh({ reason: 'icu_transfer_general' });
    notificationService.emitTransportRequest({
      transportRequest: transportReq,
      admission,
      bed: {
        id: admission.bed.id,
        bed_number: admission.bed.bed_number,
        ward_name: admission.bed.ward?.name,
      },
    });

    return { transport: transportReq, target_admission_id: targetAdmission.id, target_bed: bedLocationLabel(targetBed) };
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
  const resolvedDateOfDeath = date_of_death || new Date().toISOString().slice(0, 10);
  validateIcuMortuaryTransfer({ cause_of_death, transport });
  const mortuaryNote = notes?.trim() || cause_of_death?.trim() || null;
  const transportFields = resolveTransportFields(
    transport,
    mortuaryNote || 'ICU to mortuary'
  );

  const t = await sequelize.transaction();
  try {
    const admission = await loadIcuAdmission(admissionId, facilityId, { transaction: t, lock: true });
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

    notificationService.emitWardUpdate({
      type: 'icu_mortuary_transfer_requested',
      admission_id: admission.id,
      ward_id: admission.bed.ward_id,
    });
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

async function onIcuTransferTransportCompleted(transport) {
  if (!transport?.transfer_type || !transport.source_admission_id) return;

  const t = await sequelize.transaction();
  try {
    const sourceAdmission = await Admission.findByPk(transport.source_admission_id, {
      include: [{ model: Bed, as: 'bed', include: [{ model: Ward, as: 'ward' }] }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!sourceAdmission || sourceAdmission.status !== 'admitted') {
      await t.commit();
      return;
    }

    if (transport.transfer_type === 'ward_transfer') {
      await sourceAdmission.update({
        status: 'transferred',
        discharged_at: new Date(),
        discharged_by: transport.requested_by,
        discharge_notes: 'Transferred from ICU to general ward',
      }, { transaction: t });

      if (sourceAdmission.bed) {
        await sourceAdmission.bed.update({ status: 'available' }, { transaction: t });
      }

      notificationService.emitWardUpdate({
        type: 'icu_transfer_completed',
        admission_id: sourceAdmission.id,
        bed_id: sourceAdmission.bed_id,
        ward_id: sourceAdmission.bed?.ward_id,
        bed_status: 'available',
      });
      notificationService.emitWardStaffQueueRefresh({ reason: 'icu_transfer_delivered' });
    } else if (transport.transfer_type === 'mortuary') {
      await sourceAdmission.update({
        status: 'deceased',
        discharged_at: new Date(),
        discharged_by: transport.requested_by,
        discharge_notes: 'Deceased — transported to mortuary',
      }, { transaction: t });

      if (sourceAdmission.bed) {
        await sourceAdmission.bed.update({ status: 'available' }, { transaction: t });
      }

      if (transport.visit_id) {
        await Visit.update(
          { status: 'deceased', completed_at: new Date() },
          { where: { id: transport.visit_id }, transaction: t }
        );
      }

      notificationService.emitWardUpdate({
        type: 'icu_mortuary_completed',
        admission_id: sourceAdmission.id,
        bed_id: sourceAdmission.bed_id,
        ward_id: sourceAdmission.bed?.ward_id,
        bed_status: 'available',
      });
    }

    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('ICU transfer completion error:', err);
  }
}

module.exports = {
  listAdmittedPatients,
  listDailyRecords,
  saveDailyRecord,
  upsertDailyRecordForAdmission,
  pickAvailableBedForWardType,
  transferToGeneralWard,
  transferToMortuary,
  onIcuTransferTransportCompleted,
  formatDailyRecord,
};
