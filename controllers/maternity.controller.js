const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Visit,
  Patient,
  QueueEntry,
  MaternityEpisode,
  MaternityAncSession,
  MaternityAnwDailyRecord,
  MaternityPnwDailyRecord,
  MaternityIcuDailyRecord,
  MaternityNicuRecord,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const maternityBillingService = require('../services/maternityBillingService');
const maternityAncService = require('../services/maternityAncService');
const maternityMedicalHistoryService = require('../services/maternityMedicalHistoryService');
const { listStateHospitalFacilities } = require('../services/stateHospitalFacilityService');
const visitService = require('../services/visitService');
const { generatePatientNumber, generateVisitNumber } = require('../utils/idGenerator');
const {
  validateNationalIdForRegistration,
  validatePhoneForRegistration,
  assertUniquePatientIdentifiers,
} = require('../services/patientDuplicateService');
const {
  resolveMaternityFrontOfficeRouting,
  buildMaternityAddress,
  buildIntakeNotes,
  assertMaternityEligibleSex,
} = require('../utils/maternityRouting');
const { getIO } = require('../socket');
const {
  MATERNITY_DEPARTMENTS,
  FRONT_OFFICE_ROUTING,
  ANW_ROUTING,
  PNW_ROUTING,
  ICU_ROUTING,
  MODE_OF_ARRIVAL_OPTIONS,
} = require('../config/maternityConfig');

async function emitQueueRefresh(department, facilityId) {
  const io = getIO();
  if (!io) return;
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

function emitQueuePatientMoved(entry, status) {
  const io = getIO();
  if (!io || !entry) return;
  io.to(`room:${entry.department}`).emit('queue:patient_moved', {
    entryId: entry.id,
    status,
    department: entry.department,
  });
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function assertActiveEntry(queueEntryId, visitId, department, userId, transaction) {
  const entry = await QueueEntry.findByPk(queueEntryId, { transaction });
  if (!entry || entry.visit_id !== visitId) {
    return { err: 'Invalid queue entry for this visit', status: 400 };
  }
  if (entry.department !== department) {
    return { err: `Queue entry is not for ${department}`, status: 400 };
  }
  if (entry.status !== 'in_progress') {
    return { err: 'Patient must be started before completing actions', status: 400 };
  }
  if (entry.assigned_to !== userId) {
    return { err: 'You can only process patients assigned to you', status: 403 };
  }
  return { entry };
}

function daysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function computeMissingDailyDates(admittedAt, records) {
  if (!admittedAt) return [];
  const today = todayDate();
  const admitted = new Date(admittedAt).toISOString().slice(0, 10);
  const recordedDates = new Set(records.map((r) => r.record_date));
  const missing = [];
  const cursor = new Date(admitted);
  const end = new Date(today);
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10);
    if (!recordedDates.has(d)) missing.push(d);
    cursor.setDate(cursor.getDate() + 1);
  }
  return missing;
}

// ─── Config / metadata ───────────────────────────────────────────────────────

exports.getConfig = (req, res) => {
  return success(res, {
    departments: MATERNITY_DEPARTMENTS,
    front_office_routing: FRONT_OFFICE_ROUTING,
    anw_routing: ANW_ROUTING,
    pnw_routing: PNW_ROUTING,
    icu_routing: ICU_ROUTING,
    mode_of_arrival_options: MODE_OF_ARRIVAL_OPTIONS,
  });
};

exports.getStateHospitals = async (req, res) => {
  try {
    const rows = await listStateHospitalFacilities();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message || 'Failed to fetch state hospitals', 500);
  }
};

exports.getPatientMedicalHistory = async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.patientId, { attributes: ['id'] });
    if (!patient) return error(res, 'Patient not found', 404);

    const history = await maternityMedicalHistoryService.getMaternityMedicalHistory(
      patient.id,
      req.user.facility_id
    );
    return success(res, history);
  } catch (err) {
    return error(res, err.message || 'Failed to fetch maternity medical history', 500);
  }
};

// ─── Front Office: route patient to ANC or ANW ───────────────────────────────

exports.routeFromFrontOffice = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      routing_destination,
      patient_id,
      mode_of_arrival,
      accompanied_by,
      is_emergency,
      immediate_triage,
    } = req.body || {};
    const userId = req.user.id;
    const facilityId = req.user.facility_id;

    const routing = resolveMaternityFrontOfficeRouting({
      routing_destination,
      is_emergency,
      immediate_triage,
    });
    const dest = routing.department;

    let visit;
    let queueEntry;

    if (patient_id && !visit_id) {
      const patient = await Patient.findByPk(patient_id, { transaction: t });
      if (!patient) {
        await t.rollback();
        return error(res, 'Patient not found', 404);
      }
      assertMaternityEligibleSex(patient.sex);
      await visitService.assertNoActiveVisitForPatient(patient.id, facilityId, t);

      const patientUpdates = { category: 'returning' };
      if (routing.isEmergency) patientUpdates.is_emergency = true;
      await patient.update(patientUpdates, { transaction: t });

      const visitType = routing.immediateTriage || routing.isEmergency ? 'emergency' : 'follow_up';

      visit = await Visit.create({
        id: uuidv4(),
        patient_id: patient.id,
        facility_id: facilityId,
        visit_number: generateVisitNumber(),
        visit_type: visitType,
        status: 'in_progress',
        current_department: MATERNITY_DEPARTMENTS.FRONT_OFFICE,
        created_by: userId,
      }, { transaction: t });

      queueEntry = await queueService.pushToQueue({
        visit_id: visit.id,
        department: MATERNITY_DEPARTMENTS.FRONT_OFFICE,
        priority: routing.priority,
        pushed_by: userId,
        notes: buildIntakeNotes(req.body, routing) || 'Maternity front office intake',
      }, t);
    } else {
      if (!visit_id || !queue_entry_id) {
        await t.rollback();
        return error(res, 'visit_id and queue_entry_id are required', 400);
      }
      const check = await assertActiveEntry(
        queue_entry_id, visit_id, MATERNITY_DEPARTMENTS.FRONT_OFFICE, userId, t
      );
      if (check.err) {
        await t.rollback();
        return error(res, check.err, check.status);
      }
      visit = await Visit.findByPk(visit_id, {
        include: [{ model: Patient, as: 'patient' }],
        transaction: t,
      });
      queueEntry = check.entry;
    }

    const patient = visit.patient || await Patient.findByPk(visit.patient_id, { transaction: t });

    if (patient?.payment_type === 'private') {
      await maternityBillingService.chargeFrontOfficeVisit({
        visitId: visit.id,
        facilityId,
        transaction: t,
      });
    }

    await maternityBillingService.getOrCreateEpisode(visit.id, t);

    if (dest === MATERNITY_DEPARTMENTS.ANW) {
      const episode = await MaternityEpisode.findOne({ where: { visit_id: visit.id }, transaction: t });
      if (episode) {
        await episode.update({
          current_ward: 'anw',
          admitted_at: episode.admitted_at || new Date(),
        }, { transaction: t });
      }
    } else if (dest === MATERNITY_DEPARTMENTS.ICU) {
      const episode = await MaternityEpisode.findOne({ where: { visit_id: visit.id }, transaction: t });
      if (episode) {
        await episode.update({ current_ward: 'icu' }, { transaction: t });
      }
    }

    const intakeNotes = buildIntakeNotes(req.body, routing);
    const { nextEntry } = await queueService.completeEntry(queueEntry.id, {
      nextDepartment: dest,
      pushed_by: userId,
      notes: intakeNotes || `Routed from maternity front office to ${dest}`,
    }, t);

    await t.commit();
    await emitQueueRefresh(MATERNITY_DEPARTMENTS.FRONT_OFFICE, facilityId);
    await emitQueueRefresh(dest, facilityId);

    return success(res, { visit, nextEntry }, `Patient routed to ${routing.routingLabel || dest}`);
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, err.message || 'Failed to route patient', err.statusCode || 500);
  }
};

// ─── Register new patient at maternity front office ────────────────────────────

exports.registerPatient = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      first_name, last_name, sex, date_of_birth, id_number, phone, address,
      city, region, physical_notes,
      payment_type, emergency_contact_name, emergency_contact_phone,
      routing_destination, is_emergency, immediate_triage,
      mode_of_arrival, accompanied_by,
    } = req.body || {};

    if (!first_name?.trim() || !last_name?.trim() || !sex) {
      await t.rollback();
      return error(res, 'First name, last name, and sex are required', 400);
    }

    if (!date_of_birth) {
      await t.rollback();
      return error(res, 'Date of birth is required', 400);
    }

    assertMaternityEligibleSex(sex);

    const routing = resolveMaternityFrontOfficeRouting({
      routing_destination,
      is_emergency,
      immediate_triage,
    });

    let normalizedIdNumber = null;
    let normalizedPhone = null;
    if (!routing.immediateTriage) {
      normalizedIdNumber = validateNationalIdForRegistration(id_number);
      normalizedPhone = validatePhoneForRegistration(phone);
      await assertUniquePatientIdentifiers(
        { id_number: normalizedIdNumber, phone: normalizedPhone },
        t
      );
    }

    const patient = await Patient.create({
      id: uuidv4(),
      patient_number: generatePatientNumber(),
      category: 'known',
      payment_type: payment_type === 'private' ? 'private' : 'state',
      is_emergency: routing.isEmergency,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      sex,
      date_of_birth: date_of_birth || null,
      id_number: normalizedIdNumber,
      phone: normalizedPhone,
      address: buildMaternityAddress(req.body),
      emergency_contact_name: emergency_contact_name?.trim() || null,
      emergency_contact_phone: emergency_contact_phone?.trim() || null,
    }, { transaction: t });

    const visitType = routing.immediateTriage || routing.isEmergency ? 'emergency' : 'new';

    const visit = await Visit.create({
      id: uuidv4(),
      patient_id: patient.id,
      facility_id: req.user.facility_id,
      visit_number: generateVisitNumber(),
      visit_type: visitType,
      status: 'in_progress',
      current_department: MATERNITY_DEPARTMENTS.FRONT_OFFICE,
      created_by: req.user.id,
    }, { transaction: t });

    const queueEntry = await queueService.pushToQueue({
      visit_id: visit.id,
      department: MATERNITY_DEPARTMENTS.FRONT_OFFICE,
      priority: routing.priority,
      pushed_by: req.user.id,
      notes: buildIntakeNotes(req.body, routing) || 'New maternity patient registration',
    }, t);

    if (patient.payment_type === 'private') {
      await maternityBillingService.chargeFrontOfficeVisit({
        visitId: visit.id,
        facilityId: req.user.facility_id,
        transaction: t,
      });
    }

    await maternityBillingService.getOrCreateEpisode(visit.id, t);

    const dest = routing.department;
    if (dest === MATERNITY_DEPARTMENTS.ANW) {
      const episode = await MaternityEpisode.findOne({ where: { visit_id: visit.id }, transaction: t });
      if (episode) {
        await episode.update({
          current_ward: 'anw',
          admitted_at: episode.admitted_at || new Date(),
        }, { transaction: t });
      }
    } else if (dest === MATERNITY_DEPARTMENTS.ICU) {
      const episode = await MaternityEpisode.findOne({ where: { visit_id: visit.id }, transaction: t });
      if (episode) {
        await episode.update({ current_ward: 'icu' }, { transaction: t });
      }
    }

    const { nextEntry } = await queueService.completeEntry(queueEntry.id, {
      nextDepartment: dest,
      pushed_by: req.user.id,
      notes: buildIntakeNotes(req.body, routing) || `Routed from maternity front office to ${dest}`,
    }, t);

    await t.commit();
    await emitQueueRefresh(MATERNITY_DEPARTMENTS.FRONT_OFFICE, req.user.facility_id);
    await emitQueueRefresh(dest, req.user.facility_id);

    return created(
      res,
      { patient, visit, queueEntry: nextEntry },
      `Patient registered and routed to ${routing.routingLabel || dest}`
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, err.message || 'Failed to register patient', err.statusCode || 500);
  }
};

// ─── Episode context (ward tracking) ─────────────────────────────────────────

exports.getEpisode = async (req, res) => {
  try {
    const { visitId } = req.params;
    const episode = await MaternityEpisode.findOne({
      where: { visit_id: visitId },
      include: [
        { association: 'anwRecords', required: false },
        { association: 'pnwRecords', required: false },
        { association: 'icuRecords', required: false },
      ],
    });
    if (!episode) {
      return success(res, { episode: null, missing_daily_dates: [] });
    }

    let missingDaily = [];
    if (episode.current_ward === 'anw') {
      missingDaily = computeMissingDailyDates(episode.admitted_at, episode.anwRecords || []);
    } else if (episode.current_ward === 'pnw') {
      missingDaily = computeMissingDailyDates(episode.admitted_at, episode.pnwRecords || []);
    } else if (episode.current_ward === 'icu') {
      missingDaily = computeMissingDailyDates(episode.admitted_at, episode.icuRecords || []);
    }

    return success(res, {
      episode,
      missing_daily_dates: missingDaily,
      has_missing_daily: missingDaily.length > 0,
    });
  } catch (err) {
    return error(res, err.message || 'Failed to load episode', 500);
  }
};

// ─── ANC session ───────────────────────────────────────────────────────────────

exports.getAncSessions = async (req, res) => {
  try {
    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, { attributes: ['id', 'patient_id'] });
    if (!visit) return error(res, 'Visit not found', 404);

    const sessions = await MaternityAncSession.findAll({
      where: { visit_id: visitId },
      order: [['session_number', 'ASC']],
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });

    const hivOnRecord = await maternityAncService.getPatientHivRecord(visit.patient_id);

    return success(res, {
      sessions,
      is_first_visit: sessions.length === 0,
      hiv_positive_on_record: hivOnRecord.positive,
      hiv_recorded_session_number: hivOnRecord.session_number || null,
      hiv_recorded_at: hivOnRecord.recorded_at || null,
    });
  } catch (err) {
    return error(res, err.message || 'Failed to load ANC sessions', 500);
  }
};

exports.completeAncSession = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id, queue_entry_id,
      no_further_session_required, follow_up_date,
      ...ancFields
    } = req.body || {};
    const userId = req.user.id;
    const facilityId = req.user.facility_id;

    const check = await assertActiveEntry(
      queue_entry_id, visit_id, MATERNITY_DEPARTMENTS.ANC, userId, t
    );
    if (check.err) {
      await t.rollback();
      return error(res, check.err, check.status);
    }

    if (!no_further_session_required && !follow_up_date) {
      await t.rollback();
      return error(res, 'Follow-up date is required unless no further session is needed', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ model: Patient, as: 'patient' }],
      transaction: t,
    });

    const priorCount = await MaternityAncSession.count({ where: { visit_id }, transaction: t });
    const isFirstVisit = priorCount === 0;
    const hivOnRecord = await maternityAncService.getPatientHivRecord(visit.patient_id, t);

    const sessionPayload = maternityAncService.buildAncSessionPayload(ancFields, {
      isFirstVisit,
      hivOnRecord,
    });

    const session = await MaternityAncSession.create({
      id: uuidv4(),
      visit_id,
      patient_id: visit.patient_id,
      session_number: priorCount + 1,
      ...sessionPayload,
      no_further_session_required: Boolean(no_further_session_required),
      follow_up_date: no_further_session_required ? null : follow_up_date,
      recorded_by: userId,
      signed_off_at: new Date(),
    }, { transaction: t });

    const { completedEntry } = await queueService.completeEntry(check.entry.id, {
      nextDepartment: null,
      pushed_by: userId,
      notes: 'ANC session completed',
    }, t);

    let billingResult = { routed: false };
    if (visit.patient?.payment_type === 'private') {
      billingResult = await maternityBillingService.routeMaternityPrivateToBilling({
        visitId: visit_id,
        facilityId,
        userId,
        notes: 'ANC session — private patient billing',
        transaction: t,
      });
    }

    const episode = await maternityBillingService.getOrCreateEpisode(visit_id, t);
    let discharged = false;

    if (!billingResult.routed) {
      if (no_further_session_required) {
        discharged = true;
        if (episode) {
          await episode.update({
            status: 'discharged',
            discharged_at: new Date(),
          }, { transaction: t });
        }
        await visit.update({ status: 'discharged', current_department: null }, { transaction: t });
      } else {
        await visit.update({ status: 'completed', current_department: null }, { transaction: t });
      }
    }

    await t.commit();
    emitQueuePatientMoved(completedEntry, 'completed');
    await emitQueueRefresh(MATERNITY_DEPARTMENTS.ANC, facilityId);

    return success(res, {
      session,
      discharged,
      routedToBilling: Boolean(billingResult.routed),
      queueEntry: billingResult.queueEntry || null,
      bill: billingResult.bill || null,
      total_amount: billingResult.total_amount || null,
      visit_status: billingResult.routed ? 'in_progress' : (discharged ? 'discharged' : 'completed'),
    }, billingResult.routed
      ? 'Patient sent to billing — payment required (cash + EFT)'
      : discharged ? 'ANC completed — patient discharged' : 'ANC session completed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, err.message || 'Failed to complete ANC session', 500);
  }
};

// ─── ANW daily record ────────────────────────────────────────────────────────

exports.getAnwRecords = async (req, res) => {
  try {
    const records = await MaternityAnwDailyRecord.findAll({
      where: { visit_id: req.params.visitId },
      order: [['record_date', 'ASC']],
    });
    return success(res, { records });
  } catch (err) {
    return error(res, err.message || 'Failed to load ANW records', 500);
  }
};

exports.signOffAnwDaily = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id, queue_entry_id, record_date,
      is_admission_day, admission_reason, mode_of_arrival,
      vitals, abdominal_update, active_labour, serial_progress,
      routing_destination,
    } = req.body || {};
    const userId = req.user.id;
    const facilityId = req.user.facility_id;
    const date = record_date || todayDate();

    const check = await assertActiveEntry(
      queue_entry_id, visit_id, MATERNITY_DEPARTMENTS.ANW, userId, t
    );
    if (check.err) {
      await t.rollback();
      return error(res, check.err, check.status);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ model: Patient, as: 'patient' }],
      transaction: t,
    });

    const episode = await maternityBillingService.getOrCreateEpisode(visit_id, t);
    await episode.update({ current_ward: 'anw', admitted_at: episode.admitted_at || new Date() }, { transaction: t });

    if (is_admission_day) {
      if (!admission_reason?.trim() || !mode_of_arrival) {
        await t.rollback();
        return error(res, 'Admission reason and mode of arrival are required on admission day', 400);
      }
    }

    const [record, createdFlag] = await MaternityAnwDailyRecord.findOrCreate({
      where: { episode_id: episode.id, record_date: date },
      defaults: {
        id: uuidv4(),
        visit_id,
        is_admission_day: Boolean(is_admission_day),
        admission_reason: admission_reason?.trim() || null,
        mode_of_arrival: mode_of_arrival || null,
        vitals: vitals || null,
        abdominal_update: abdominal_update || null,
        active_labour: active_labour || null,
        serial_progress: serial_progress || null,
        recorded_by: userId,
        signed_off_at: new Date(),
      },
      transaction: t,
    });

    if (!createdFlag) {
      await record.update({
        is_admission_day: Boolean(is_admission_day),
        admission_reason: admission_reason?.trim() || record.admission_reason,
        mode_of_arrival: mode_of_arrival || record.mode_of_arrival,
        vitals: vitals || record.vitals,
        abdominal_update: abdominal_update || record.abdominal_update,
        active_labour: active_labour || record.active_labour,
        serial_progress: serial_progress || record.serial_progress,
        signed_off_at: new Date(),
      }, { transaction: t });
    }

    if (visit.patient?.payment_type === 'private') {
      await maternityBillingService.chargeWardDay({
        visitId: visit_id,
        facilityId,
        ward: 'anw',
        recordDate: date,
        transaction: t,
      });
    }

    let nextDept = null;
    if (routing_destination) {
      const valid = ANW_ROUTING.map((r) => r.value);
      if (!valid.includes(routing_destination)) {
        await t.rollback();
        return error(res, 'Invalid routing destination', 400);
      }
      nextDept = routing_destination;
      if (nextDept === MATERNITY_DEPARTMENTS.PNW) {
        await episode.update({ current_ward: 'pnw' }, { transaction: t });
      } else if (nextDept === MATERNITY_DEPARTMENTS.ICU) {
        await episode.update({ current_ward: 'icu' }, { transaction: t });
      }
    }

    await queueService.completeEntry(check.entry.id, {
      nextDepartment: nextDept,
      pushed_by: userId,
      notes: nextDept ? `ANW sign-off — routed to ${nextDept}` : 'ANW daily sign-off',
    }, t);

    await t.commit();
    await emitQueueRefresh(MATERNITY_DEPARTMENTS.ANW, facilityId);
    if (nextDept) await emitQueueRefresh(nextDept, facilityId);

    return success(res, { record, routed_to: nextDept }, 'ANW daily record signed off');
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, err.message || 'Failed to sign off ANW record', 500);
  }
};

// ─── PNW daily record ────────────────────────────────────────────────────────

exports.getPnwRecords = async (req, res) => {
  try {
    const records = await MaternityPnwDailyRecord.findAll({
      where: { visit_id: req.params.visitId },
      order: [['record_date', 'ASC']],
    });
    return success(res, { records });
  } catch (err) {
    return error(res, err.message || 'Failed to load PNW records', 500);
  }
};

exports.signOffPnwDaily = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id, queue_entry_id, record_date,
      is_post_delivery_day, delivery_type, post_op_recovery,
      vitals, uterine_index, physiological_output, breast_examination,
      routing_destination,
      feeding_counselling_done, six_week_follow_up_date,
    } = req.body || {};
    const userId = req.user.id;
    const facilityId = req.user.facility_id;
    const date = record_date || todayDate();

    const check = await assertActiveEntry(
      queue_entry_id, visit_id, MATERNITY_DEPARTMENTS.PNW, userId, t
    );
    if (check.err) {
      await t.rollback();
      return error(res, check.err, check.status);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ model: Patient, as: 'patient' }],
      transaction: t,
    });

    const episode = await maternityBillingService.getOrCreateEpisode(visit_id, t);
    await episode.update({ current_ward: 'pnw' }, { transaction: t });

    if (is_post_delivery_day && (!delivery_type?.trim() || !post_op_recovery?.trim())) {
      await t.rollback();
      return error(res, 'Delivery type and post-op recovery are required on post-delivery day', 400);
    }

    if (routing_destination === 'discharge') {
      if (!feeding_counselling_done) {
        await t.rollback();
        return error(res, 'Feeding counselling review must be completed before discharge', 400);
      }
      if (!six_week_follow_up_date) {
        await t.rollback();
        return error(res, '6-week follow-up date is required before discharge', 400);
      }
    }

    const [record, createdFlag] = await MaternityPnwDailyRecord.findOrCreate({
      where: { episode_id: episode.id, record_date: date },
      defaults: {
        id: uuidv4(),
        visit_id,
        is_post_delivery_day: Boolean(is_post_delivery_day),
        delivery_type: delivery_type?.trim() || null,
        post_op_recovery: post_op_recovery?.trim() || null,
        vitals: vitals || null,
        uterine_index: uterine_index || null,
        physiological_output: physiological_output || null,
        breast_examination: breast_examination || null,
        recorded_by: userId,
        signed_off_at: new Date(),
      },
      transaction: t,
    });

    if (!createdFlag) {
      await record.update({
        is_post_delivery_day: Boolean(is_post_delivery_day),
        delivery_type: delivery_type?.trim() || record.delivery_type,
        post_op_recovery: post_op_recovery?.trim() || record.post_op_recovery,
        vitals: vitals || record.vitals,
        uterine_index: uterine_index || record.uterine_index,
        physiological_output: physiological_output || record.physiological_output,
        breast_examination: breast_examination || record.breast_examination,
        signed_off_at: new Date(),
      }, { transaction: t });
    }

    if (visit.patient?.payment_type === 'private') {
      await maternityBillingService.chargeWardDay({
        visitId: visit_id,
        facilityId,
        ward: 'pnw',
        recordDate: date,
        transaction: t,
      });
    }

    let nextDept = null;
    if (routing_destination === MATERNITY_DEPARTMENTS.ICU) {
      nextDept = routing_destination;
      await episode.update({ current_ward: 'icu' }, { transaction: t });
    }

    await queueService.completeEntry(check.entry.id, {
      nextDepartment: nextDept,
      pushed_by: userId,
      notes: routing_destination === 'discharge' ? 'PNW discharge' : 'PNW daily sign-off',
    }, t);

    let billingResult = { routed: false };
    if (routing_destination === 'discharge') {
      if (visit.patient?.payment_type === 'private') {
        billingResult = await maternityBillingService.routeMaternityPrivateToBilling({
          visitId: visit_id,
          facilityId,
          userId,
          notes: 'PNW discharge — private patient billing',
          transaction: t,
        });
      }

      if (!billingResult.routed) {
        await episode.update({
          status: 'discharged',
          discharged_at: new Date(),
          feeding_counselling_done: true,
          six_week_follow_up_date,
        }, { transaction: t });
        await visit.update({ status: 'discharged', current_department: null }, { transaction: t });
      }
    }

    await t.commit();
    await emitQueueRefresh(MATERNITY_DEPARTMENTS.PNW, facilityId);
    if (nextDept) await emitQueueRefresh(nextDept, facilityId);

    return success(res, {
      record,
      discharged: routing_destination === 'discharge' && !billingResult.routed,
      routedToBilling: Boolean(billingResult.routed),
      queueEntry: billingResult.queueEntry || null,
      bill: billingResult.bill || null,
      total_amount: billingResult.total_amount || null,
    }, billingResult.routed
      ? 'Patient sent to billing — payment required (cash + EFT)'
      : 'PNW record signed off');
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, err.message || 'Failed to sign off PNW record', 500);
  }
};

// ─── ICU daily record ────────────────────────────────────────────────────────

exports.getIcuRecords = async (req, res) => {
  try {
    const records = await MaternityIcuDailyRecord.findAll({
      where: { visit_id: req.params.visitId },
      order: [['record_date', 'ASC']],
    });
    return success(res, { records });
  } catch (err) {
    return error(res, err.message || 'Failed to load ICU records', 500);
  }
};

exports.signOffIcuDaily = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id, queue_entry_id, record_date,
      extreme_indicators, continuous_parameters, multiple_origin_tracking,
      routing_destination,
    } = req.body || {};
    const userId = req.user.id;
    const facilityId = req.user.facility_id;
    const date = record_date || todayDate();

    const check = await assertActiveEntry(
      queue_entry_id, visit_id, MATERNITY_DEPARTMENTS.ICU, userId, t
    );
    if (check.err) {
      await t.rollback();
      return error(res, check.err, check.status);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ model: Patient, as: 'patient' }],
      transaction: t,
    });

    const episode = await maternityBillingService.getOrCreateEpisode(visit_id, t);
    await episode.update({ current_ward: 'icu' }, { transaction: t });

    const [record, createdFlag] = await MaternityIcuDailyRecord.findOrCreate({
      where: { episode_id: episode.id, record_date: date },
      defaults: {
        id: uuidv4(),
        visit_id,
        extreme_indicators: extreme_indicators || null,
        continuous_parameters: continuous_parameters || null,
        multiple_origin_tracking: multiple_origin_tracking || null,
        recorded_by: userId,
        signed_off_at: new Date(),
      },
      transaction: t,
    });

    if (!createdFlag) {
      await record.update({
        extreme_indicators: extreme_indicators || record.extreme_indicators,
        continuous_parameters: continuous_parameters || record.continuous_parameters,
        multiple_origin_tracking: multiple_origin_tracking || record.multiple_origin_tracking,
        signed_off_at: new Date(),
      }, { transaction: t });
    }

    if (visit.patient?.payment_type === 'private') {
      await maternityBillingService.chargeWardDay({
        visitId: visit_id,
        facilityId,
        ward: 'icu',
        recordDate: date,
        transaction: t,
      });
    }

    let nextDept = null;
    if (routing_destination === MATERNITY_DEPARTMENTS.ANW) {
      nextDept = routing_destination;
      await episode.update({ current_ward: 'anw' }, { transaction: t });
    }

    await queueService.completeEntry(check.entry.id, {
      nextDepartment: nextDept,
      pushed_by: userId,
      notes: routing_destination === 'discharge' ? 'Maternity ICU discharge' : 'ICU daily sign-off',
    }, t);

    let billingResult = { routed: false };
    if (routing_destination === 'discharge') {
      if (visit.patient?.payment_type === 'private') {
        billingResult = await maternityBillingService.routeMaternityPrivateToBilling({
          visitId: visit_id,
          facilityId,
          userId,
          notes: 'Maternity ICU discharge — private patient billing',
          transaction: t,
        });
      }

      if (!billingResult.routed) {
        await episode.update({ status: 'discharged', discharged_at: new Date() }, { transaction: t });
        await visit.update({ status: 'discharged', current_department: null }, { transaction: t });
      }
    }

    await t.commit();
    await emitQueueRefresh(MATERNITY_DEPARTMENTS.ICU, facilityId);
    if (nextDept) await emitQueueRefresh(nextDept, facilityId);

    return success(res, {
      record,
      discharged: routing_destination === 'discharge' && !billingResult.routed,
      routedToBilling: Boolean(billingResult.routed),
      queueEntry: billingResult.queueEntry || null,
      bill: billingResult.bill || null,
      total_amount: billingResult.total_amount || null,
    }, billingResult.routed
      ? 'Patient sent to billing — payment required (cash + EFT)'
      : 'ICU record signed off');
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, err.message || 'Failed to sign off ICU record', 500);
  }
};

// ─── NICU newborn registration ───────────────────────────────────────────────

exports.getNicuRecords = async (req, res) => {
  try {
    const records = await MaternityNicuRecord.findAll({
      where: { mother_visit_id: req.params.visitId },
      include: [
        { association: 'child', attributes: ['id', 'patient_number', 'first_name', 'last_name', 'sex'] },
        { association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'ASC']],
    });
    return success(res, { records });
  } catch (err) {
    return error(res, err.message || 'Failed to load NICU records', 500);
  }
};

exports.registerNewborn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id, queue_entry_id,
      date_time_of_birth, sex, name, gestation_weeks,
      clinical_status, apgar_matrix,
    } = req.body || {};
    const userId = req.user.id;
    const facilityId = req.user.facility_id;

    const check = await assertActiveEntry(
      queue_entry_id, visit_id, MATERNITY_DEPARTMENTS.NICU, userId, t
    );
    if (check.err) {
      await t.rollback();
      return error(res, check.err, check.status);
    }

    if (!date_time_of_birth || !sex) {
      await t.rollback();
      return error(res, 'Date/time of birth and sex are required', 400);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    if (!visit) {
      await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const childPatient = await Patient.create({
      id: uuidv4(),
      patient_number: generatePatientNumber(),
      category: 'known',
      payment_type: 'state',
      first_name: name?.trim() || 'Newborn',
      last_name: `of ${visit.patient_id}`,
      sex,
      date_of_birth: new Date(date_time_of_birth).toISOString().slice(0, 10),
    }, { transaction: t });

    const record = await MaternityNicuRecord.create({
      id: uuidv4(),
      mother_patient_id: visit.patient_id,
      mother_visit_id: visit_id,
      child_patient_id: childPatient.id,
      date_time_of_birth: new Date(date_time_of_birth),
      sex,
      name: name?.trim() || null,
      gestation_weeks: gestation_weeks ? parseInt(gestation_weeks, 10) : null,
      clinical_status: clinical_status || null,
      apgar_matrix: apgar_matrix || null,
      recorded_by: userId,
    }, { transaction: t });

    await queueService.completeEntry(check.entry.id, {
      nextDepartment: null,
      pushed_by: userId,
      notes: 'NICU newborn registered and linked to mother',
    }, t);

    await t.commit();
    await emitQueueRefresh(MATERNITY_DEPARTMENTS.NICU, facilityId);

    return created(res, { record, child_patient: childPatient }, 'Newborn registered and linked to mother');
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, err.message || 'Failed to register newborn', 500);
  }
};
