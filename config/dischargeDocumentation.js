const REFUSAL_DISCHARGE_DIAGNOSIS =
  'Patient declined care — consultation ended without clinical diagnosis';

function resolveDischargeDiagnosis(diagnosis) {
  const trimmed = diagnosis && String(diagnosis).trim();
  return trimmed || REFUSAL_DISCHARGE_DIAGNOSIS;
}

function buildRefusalDischargeNotes(dischargeReason, notes) {
  const reason = String(dischargeReason || '').trim();
  const extra = notes && String(notes).trim();
  if (!extra || extra === reason) return reason;
  return `${reason}\n\nAdditional notes: ${extra}`;
}

function refusalDischargeActionsTaken(dischargeReason, extra = {}) {
  return JSON.stringify({
    documentation_type: 'patient_refused_care',
    discharge_reason: String(dischargeReason || '').trim(),
    ...extra,
  });
}

module.exports = {
  REFUSAL_DISCHARGE_DIAGNOSIS,
  resolveDischargeDiagnosis,
  buildRefusalDischargeNotes,
  refusalDischargeActionsTaken,
};
