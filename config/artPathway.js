/**
 * ART Treatment Pathway — five strict system states.
 */

const PATHWAY_STATES = [
  {
    value: 'day_1',
    label: 'Day 1 — Diagnosis & Immediate Counseling',
    order: 0,
    description: 'Clinical actions locked until supportive counseling and HIV education are completed.',
  },
  {
    value: 'week_1',
    label: 'Week 1 — Baseline Bloodwork & Treat All',
    order: 1,
    description: 'Days 1–7: log baseline bloodwork and issue initial 30-day ART supply (e.g. TLD).',
  },
  {
    value: 'month_1',
    label: 'Month 1 — Tolerance & Adherence Check',
    order: 2,
    description: '4-week follow-up: adherence, timing hurdles, and side-effect tolerance.',
  },
  {
    value: 'month_3_6',
    label: 'Month 3–6 — Suppression Check',
    order: 3,
    description: 'Order and record follow-up viral load toward undetectable status.',
  },
  {
    value: 'maintenance',
    label: 'Month 6+ — Long-Term Maintenance',
    order: 4,
    description: 'Viral suppression confirmed; 6–12 month monitoring and multi-month dispensing.',
  },
];

const STATE_ORDER = PATHWAY_STATES.map((s) => s.value);

const HIV_TESTER_DEPARTMENT = 'hiv_tester';
const ART_NURSE_DEPARTMENT = 'art_nurse';

const COUNSELING_MILESTONE_KEY = 'counseling_completed';

function stateLabel(state) {
  return PATHWAY_STATES.find((s) => s.value === state)?.label || state;
}

function nextState(current) {
  const idx = STATE_ORDER.indexOf(current);
  if (idx < 0 || idx >= STATE_ORDER.length - 1) return null;
  return STATE_ORDER[idx + 1];
}

function isValidPathwayState(value) {
  return STATE_ORDER.includes(value);
}

/** Days since enrollment for time-based UI flags. */
function pathwayFlags(enrolledAt, stateEnteredAt) {
  const enrolled = enrolledAt ? new Date(enrolledAt) : new Date();
  const now = Date.now();
  const daysSinceEnrollment = Math.floor((now - enrolled.getTime()) / (24 * 60 * 60 * 1000));

  return {
    daysSinceEnrollment,
    week1WindowOpen: daysSinceEnrollment >= 0,
    month1Due: daysSinceEnrollment >= 28,
    suppressionWindowDue: daysSinceEnrollment >= 84,
    maintenanceEligible: daysSinceEnrollment >= 180,
    stateEnteredAt,
  };
}

function emptyPathwayData() {
  return {
    counseling_completed: false,
    counseling_completed_at: null,
    baseline_bloodwork: null,
    initial_prescription: null,
    month_1_followup: null,
    suppression_check: null,
    maintenance: null,
  };
}

function canAdvanceFromDay1(pathwayData) {
  return pathwayData?.[COUNSELING_MILESTONE_KEY] === true;
}

function canAdvanceFromWeek1(pathwayData) {
  const bw = pathwayData?.baseline_bloodwork;
  const rx = pathwayData?.initial_prescription;
  return !!(bw?.cd4_count != null && bw?.viral_load != null && rx?.medication);
}

function canAdvanceFromMonth1(pathwayData) {
  return !!pathwayData?.month_1_followup?.documented_at;
}

function canAdvanceFromMonth36(pathwayData) {
  return pathwayData?.suppression_check?.viral_suppression_confirmed === true;
}

function advanceReadiness(state, pathwayData) {
  switch (state) {
    case 'day_1':
      return { ready: canAdvanceFromDay1(pathwayData), reason: 'Complete supportive counseling milestone first.' };
    case 'week_1':
      return { ready: canAdvanceFromWeek1(pathwayData), reason: 'Log baseline bloodwork and issue initial ART prescription.' };
    case 'month_1':
      return { ready: canAdvanceFromMonth1(pathwayData), reason: 'Document Month 1 adherence and tolerance follow-up.' };
    case 'month_3_6':
      return { ready: canAdvanceFromMonth36(pathwayData), reason: 'Confirm viral suppression in follow-up results.' };
    case 'maintenance':
      return { ready: false, reason: 'Patient is in long-term maintenance.' };
    default:
      return { ready: false, reason: 'Unknown pathway state.' };
  }
}

module.exports = {
  PATHWAY_STATES,
  STATE_ORDER,
  HIV_TESTER_DEPARTMENT,
  ART_NURSE_DEPARTMENT,
  COUNSELING_MILESTONE_KEY,
  stateLabel,
  nextState,
  isValidPathwayState,
  pathwayFlags,
  emptyPathwayData,
  canAdvanceFromDay1,
  canAdvanceFromWeek1,
  canAdvanceFromMonth1,
  canAdvanceFromMonth36,
  advanceReadiness,
};
