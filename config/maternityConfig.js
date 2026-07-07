'use strict';

const { ROLES } = require('./roles');

/** Queue department slugs for maternity workflow. */
const MATERNITY_DEPARTMENTS = {
  FRONT_OFFICE: 'maternity_front_office',
  ANC: 'maternity_anc',
  ANW: 'maternity_anw',
  PNW: 'maternity_pnw',
  ICU: 'maternity_icu',
  NICU: 'maternity_nicu',
};

/** Hospital maternity role slugs. */
const MATERNITY_ROLE_SLUGS = [
  ROLES.MATERNITY_FRONT_OFFICER,
  ROLES.MATERNITY_ANC_STAFF,
  ROLES.MATERNITY_ANW_STAFF,
  ROLES.MATERNITY_PNW_STAFF,
  ROLES.MATERNITY_ICU_STAFF,
  ROLES.MATERNITY_NICU_STAFF,
];

const MATERNITY_ROLE_LABELS = {
  [ROLES.MATERNITY_FRONT_OFFICER]: 'Maternity Front Officer',
  [ROLES.MATERNITY_ANC_STAFF]: 'ANC Staff',
  [ROLES.MATERNITY_ANW_STAFF]: 'ANW Staff',
  [ROLES.MATERNITY_PNW_STAFF]: 'PNW Staff',
  [ROLES.MATERNITY_ICU_STAFF]: 'Maternity ICU Staff',
  [ROLES.MATERNITY_NICU_STAFF]: 'NICU Staff',
};

const DEPARTMENT_LABELS = {
  [MATERNITY_DEPARTMENTS.FRONT_OFFICE]: 'Maternity Front Office',
  [MATERNITY_DEPARTMENTS.ANC]: 'Antenatal Care (ANC)',
  [MATERNITY_DEPARTMENTS.ANW]: 'Antenatal Ward (ANW)',
  [MATERNITY_DEPARTMENTS.PNW]: 'Postnatal Ward (PNW)',
  [MATERNITY_DEPARTMENTS.ICU]: 'Maternity ICU',
  [MATERNITY_DEPARTMENTS.NICU]: 'NICU',
};

/** Role → default queue department. */
const ROLE_TO_DEPARTMENT = {
  [ROLES.MATERNITY_FRONT_OFFICER]: MATERNITY_DEPARTMENTS.FRONT_OFFICE,
  [ROLES.MATERNITY_ANC_STAFF]: MATERNITY_DEPARTMENTS.ANC,
  [ROLES.MATERNITY_ANW_STAFF]: MATERNITY_DEPARTMENTS.ANW,
  [ROLES.MATERNITY_PNW_STAFF]: MATERNITY_DEPARTMENTS.PNW,
  [ROLES.MATERNITY_ICU_STAFF]: MATERNITY_DEPARTMENTS.ICU,
  [ROLES.MATERNITY_NICU_STAFF]: MATERNITY_DEPARTMENTS.NICU,
};

const FRONT_OFFICE_ROUTING = [
  { value: MATERNITY_DEPARTMENTS.ANC, label: 'ANC Queue' },
  { value: MATERNITY_DEPARTMENTS.ANW, label: 'ANW Queue' },
];

const ANW_ROUTING = [
  { value: MATERNITY_DEPARTMENTS.ICU, label: 'Maternity ICU' },
  { value: MATERNITY_DEPARTMENTS.PNW, label: 'Postnatal Ward (PNW)' },
];

const PNW_ROUTING = [
  { value: MATERNITY_DEPARTMENTS.ICU, label: 'Maternity ICU' },
  { value: 'discharge', label: 'Discharge' },
];

const ICU_ROUTING = [
  { value: MATERNITY_DEPARTMENTS.ANW, label: 'Antenatal Ward (ANW)' },
  { value: 'discharge', label: 'Discharge' },
];

const MODE_OF_ARRIVAL_OPTIONS = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'ambulance', label: 'Ambulance' },
  { value: 'referral', label: 'Referral' },
  { value: 'transfer', label: 'Transfer from another facility' },
  { value: 'other', label: 'Other' },
];

const WARD_TYPES = ['anw', 'pnw', 'icu'];

/** Default maternity tariff amounts (NAD). */
const MATERNITY_TARIFFS = {
  FRONT_OFFICE_VISIT: 50,
  WARD_DAY_BY_TYPE: {
    anw: 500,
    pnw: 500,
    icu: 500,
  },
};

function defaultWardDayTariff(ward) {
  const key = String(ward || '').toLowerCase();
  return MATERNITY_TARIFFS.WARD_DAY_BY_TYPE[key] ?? MATERNITY_TARIFFS.WARD_DAY_BY_TYPE.anw;
}

function departmentLabel(dept) {
  return DEPARTMENT_LABELS[dept] || dept;
}

function isMaternityDepartment(dept) {
  return Object.values(MATERNITY_DEPARTMENTS).includes(dept);
}

function isMaternityRole(role) {
  return MATERNITY_ROLE_SLUGS.includes(role);
}

module.exports = {
  MATERNITY_DEPARTMENTS,
  MATERNITY_ROLE_SLUGS,
  MATERNITY_ROLE_LABELS,
  DEPARTMENT_LABELS,
  ROLE_TO_DEPARTMENT,
  FRONT_OFFICE_ROUTING,
  ANW_ROUTING,
  PNW_ROUTING,
  ICU_ROUTING,
  MODE_OF_ARRIVAL_OPTIONS,
  WARD_TYPES,
  MATERNITY_TARIFFS,
  defaultWardDayTariff,
  departmentLabel,
  isMaternityDepartment,
  isMaternityRole,
};
