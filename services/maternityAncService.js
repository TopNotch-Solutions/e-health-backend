'use strict';

const { MaternityAncSession } = require('../models');

function extractHivResult(specialInvestigations) {
  if (!specialInvestigations || typeof specialInvestigations !== 'object') return null;
  const hiv = specialInvestigations.hiv_panel;
  if (!hiv || typeof hiv !== 'object') return null;
  if (hiv.result === 'positive' || hiv.status === 'positive' || hiv.status === 'positive_on_record') {
    return 'positive';
  }
  if (hiv.result === 'negative') return 'negative';
  return null;
}

async function getPatientHivRecord(patientId, transaction) {
  const sessions = await MaternityAncSession.findAll({
    where: { patient_id: patientId },
    order: [['signed_off_at', 'ASC'], ['created_at', 'ASC']],
    transaction,
  });

  for (const session of sessions) {
    if (extractHivResult(session.special_investigations) === 'positive') {
      return {
        positive: true,
        session_number: session.session_number,
        visit_id: session.visit_id,
        recorded_at: session.signed_off_at || session.created_at,
      };
    }
  }

  return { positive: false };
}

function normalizeBaselineListInput(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function buildBaselineHistory(payload, isFirstVisit) {
  if (!isFirstVisit) return null;
  const { baseline_obstetric, baseline_gynae, baseline_past_medical } = payload || {};
  const obstetric = normalizeBaselineListInput(baseline_obstetric);
  const gynae = normalizeBaselineListInput(baseline_gynae);
  const pastMedical = normalizeBaselineListInput(baseline_past_medical);
  const missing = [];
  if (!obstetric.length) missing.push('obstetric history');
  if (!gynae.length) missing.push('gynae history');
  if (!pastMedical.length) missing.push('past medical history');
  if (missing.length) {
    const err = new Error(
      `Baseline ${missing.join(', ')} is required on the first ANC visit of this pregnancy.`
    );
    err.statusCode = 400;
    throw err;
  }
  return {
    obstetric,
    gynae,
    past_medical: pastMedical,
  };
}

function buildGeneralPhysicalExam(payload) {
  const fields = {
    blood_pressure: payload.bp?.trim?.() || null,
    pulse: payload.pulse?.trim?.() || null,
    temperature: payload.temperature?.trim?.() || null,
    saturation: payload.saturation?.trim?.() || null,
    weight: payload.weight?.trim?.() || null,
    pallor: payload.pallor?.trim?.() || null,
    thyroid: payload.thyroid?.trim?.() || null,
    breast_exam: payload.breast_exam?.trim?.() || null,
    oedema: payload.oedema?.trim?.() || null,
    varicose_veins: payload.varicose_veins?.trim?.() || null,
  };
  const hasValue = Object.values(fields).some(Boolean);
  return hasValue ? fields : null;
}

function buildSpecialInvestigations(payload, hivOnRecord) {
  const serology = payload.serology?.trim?.() || null;
  const tetanus = payload.tetanus_toxoid_immunization?.trim?.() || null;

  let hivPanel;
  if (hivOnRecord?.positive) {
    hivPanel = {
      conducted: false,
      result: 'positive_on_record',
      status: 'positive',
      note: 'HIV positive on record — test not repeated this session',
      recorded_session_number: hivOnRecord.session_number || null,
    };
  } else {
    const result = payload.hiv_result?.trim?.() || '';
    if (!result) {
      const err = new Error('HIV panel result is required (negative or positive) unless already on record.');
      err.statusCode = 400;
      throw err;
    }
    if (!['negative', 'positive'].includes(result)) {
      const err = new Error('HIV panel result must be negative or positive.');
      err.statusCode = 400;
      throw err;
    }
    hivPanel = {
      conducted: true,
      result,
      status: result,
    };
  }

  return {
    hiv_panel: hivPanel,
    serology,
    tetanus_toxoid_immunization: tetanus,
  };
}

function buildDeliveryDetails(payload) {
  const chemoprophylaxis = payload.chemoprophylaxis?.trim?.() || null;
  const placeOfDelivery = payload.place_of_delivery?.trim?.() || null;
  if (!chemoprophylaxis && !placeOfDelivery) return null;
  return { chemoprophylaxis, place_of_delivery: placeOfDelivery };
}

function buildAncSessionPayload(body, { isFirstVisit, hivOnRecord }) {
  return {
    is_first_visit: isFirstVisit,
    baseline_history: buildBaselineHistory(body, isFirstVisit),
    general_physical_exam: buildGeneralPhysicalExam(body),
    special_investigations: buildSpecialInvestigations(body, hivOnRecord),
    delivery_details: buildDeliveryDetails(body),
  };
}

module.exports = {
  extractHivResult,
  getPatientHivRecord,
  buildAncSessionPayload,
};
