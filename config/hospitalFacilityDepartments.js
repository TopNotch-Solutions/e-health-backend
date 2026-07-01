'use strict';

const { ROLES } = require('./roles');
const { MATERNITY_DEPARTMENTS } = require('./maternityConfig');
const {
  HOSPITAL_OUTPATIENT_DEPARTMENTS,
  HOSPITAL_OUTPATIENT_DEFINITIONS,
} = require('./hospitalOutpatientConfig');
const { WARD_STAFF_DEFINITIONS } = require('./wardStaffConfig');

/**
 * Hospital facility department template — each department maps to one staff role.
 * queue_department drives queue activity and front-office routing where applicable.
 */
const CORE_HOSPITAL_DEFINITIONS = [
  { key: ROLES.FRONT_OFFICE, label: 'Front Office', queue_department: null, activity_mode: 'intake' },
  { key: ROLES.FRONT_OFFICE_SUPERVISOR, label: 'Front Office Supervisor', queue_department: null, activity_mode: 'intake' },
  {
    key: ROLES.NURSE,
    label: 'Nurse',
    queue_department: 'nurse',
    activity_mode: 'queue',
    front_office_route: { value: 'nurse', label: 'Nurse' },
  },
  { key: ROLES.NURSE_SUPERVISOR, label: 'Nurse Supervisor', queue_department: 'nurse', activity_mode: 'queue' },
  { key: ROLES.DOCTOR, label: 'Doctor', queue_department: 'doctor', activity_mode: 'queue' },
  { key: ROLES.DOCTOR_SUPERVISOR, label: 'Doctor Supervisor', queue_department: 'doctor', activity_mode: 'queue' },
  {
    key: ROLES.PHARMACIST,
    label: 'Pharmacy',
    queue_department: 'pharmacy',
    activity_mode: 'queue',
    front_office_route: { value: 'pharmacy', label: 'Pharmacy' },
  },
  { key: ROLES.PHARMACY_SUPERVISOR, label: 'Pharmacy Supervisor', queue_department: 'pharmacy', activity_mode: 'queue' },
  { key: ROLES.LAB_TECHNICIAN, label: 'Laboratory', queue_department: 'lab', activity_mode: 'queue' },
  { key: ROLES.LABORATORY_SUPERVISOR, label: 'Laboratory Supervisor', queue_department: 'lab', activity_mode: 'queue' },
  { key: ROLES.RADIOLOGIST, label: 'Radiology (Sonar)', queue_department: 'sonar', activity_mode: 'queue' },
  { key: ROLES.RADIOLOGIST_SUPERVISOR, label: 'Radiology Supervisor', queue_department: 'sonar', activity_mode: 'queue' },
  { key: ROLES.BILLING_CLERK, label: 'Billing', queue_department: 'billing', activity_mode: 'queue' },
  { key: ROLES.REVENUE_OFFICER, label: 'Revenue Office', queue_department: 'billing', activity_mode: 'queue' },
  { key: ROLES.INTERNAL_PORTER, label: 'Internal Porter', queue_department: 'transport', activity_mode: 'queue' },
  { key: ROLES.EXTERNAL_PORTER, label: 'External Porter (Ambulance)', queue_department: 'transport', activity_mode: 'queue' },
  { key: ROLES.WARD_SUPERVISOR, label: 'Ward Supervisor', queue_department: null, activity_mode: 'ward' },
  { key: ROLES.WARD_STAFF, label: 'Ward Staff', queue_department: null, activity_mode: 'ward' },
  { key: ROLES.KITCHEN_STAFF, label: 'Kitchen Staff', queue_department: null, activity_mode: 'support' },
  { key: ROLES.KITCHEN_MANAGER, label: 'Kitchen Manager', queue_department: null, activity_mode: 'support' },
  { key: ROLES.MORTUARY_STAFF, label: 'Mortuary', queue_department: null, activity_mode: 'support' },
  { key: ROLES.SOCIAL_WORKER, label: 'Social Worker', queue_department: null, activity_mode: 'queue' },
  { key: ROLES.DATA_ANALYST, label: 'Data Analyst', queue_department: null, activity_mode: 'support' },
];

const MATERNITY_HOSPITAL_DEFINITIONS = [
  { key: ROLES.MATERNITY_FRONT_OFFICER, label: 'Maternity Front Officer', queue_department: MATERNITY_DEPARTMENTS.FRONT_OFFICE, activity_mode: 'intake' },
  { key: ROLES.MATERNITY_ANC_STAFF, label: 'ANC Staff', queue_department: MATERNITY_DEPARTMENTS.ANC, activity_mode: 'queue' },
  { key: ROLES.MATERNITY_ANW_STAFF, label: 'ANW Staff', queue_department: MATERNITY_DEPARTMENTS.ANW, activity_mode: 'queue' },
  { key: ROLES.MATERNITY_PNW_STAFF, label: 'PNW Staff', queue_department: MATERNITY_DEPARTMENTS.PNW, activity_mode: 'queue' },
  { key: ROLES.MATERNITY_ICU_STAFF, label: 'Maternity ICU Staff', queue_department: MATERNITY_DEPARTMENTS.ICU, activity_mode: 'queue' },
  { key: ROLES.MATERNITY_NICU_STAFF, label: 'NICU Staff', queue_department: MATERNITY_DEPARTMENTS.NICU, activity_mode: 'queue' },
];

const OUTPATIENT_HOSPITAL_DEFINITIONS = HOSPITAL_OUTPATIENT_DEFINITIONS.map((row) => {
  const def = {
    key: row.key,
    label: row.nurseLabel,
    queue_department: row.department,
    activity_mode: 'queue',
  };
  if (row.department === HOSPITAL_OUTPATIENT_DEPARTMENTS.EMERGENCY) {
    def.front_office_route = { value: 'hospital_emergency_unit', label: 'Emergency Unit' };
  }
  if (row.department === HOSPITAL_OUTPATIENT_DEPARTMENTS.ADULT) {
    def.front_office_route = { value: 'adult_outpatient', label: 'Outpatient' };
  }
  return def;
});

const WARD_HOSPITAL_DEFINITIONS = WARD_STAFF_DEFINITIONS.map((row) => ({
  key: row.key,
  label: row.nurseLabel,
  queue_department: null,
  activity_mode: 'ward',
}));

const HOSPITAL_DEPARTMENT_DEFINITIONS = [
  ...CORE_HOSPITAL_DEFINITIONS,
  ...MATERNITY_HOSPITAL_DEFINITIONS,
  ...OUTPATIENT_HOSPITAL_DEFINITIONS,
  ...WARD_HOSPITAL_DEFINITIONS,
];

const HOSPITAL_DEPARTMENT_BY_KEY = Object.fromEntries(
  HOSPITAL_DEPARTMENT_DEFINITIONS.map((d) => [d.key, d])
);

const VALID_HOSPITAL_DEPARTMENT_KEYS = new Set(HOSPITAL_DEPARTMENT_DEFINITIONS.map((d) => d.key));

/** Foundation departments — always required for every hospital. */
const FOUNDATION_HOSPITAL_DEPARTMENT_KEYS = [
  ROLES.FRONT_OFFICE,
  ROLES.NURSE,
  ROLES.DOCTOR,
];

const FOUNDATION_HOSPITAL_DEPARTMENT_SET = new Set(FOUNDATION_HOSPITAL_DEPARTMENT_KEYS);

const FULL_HOSPITAL_TEMPLATE_KEYS = HOSPITAL_DEPARTMENT_DEFINITIONS.map((d) => d.key);

const HOSPITAL_DEPARTMENT_REQUIRES = {
  [ROLES.REVENUE_OFFICER]: ROLES.BILLING_CLERK,
};

const HOSPITAL_REMOVAL_CASCADE = {
  [ROLES.BILLING_CLERK]: [ROLES.REVENUE_OFFICER],
};

function getHospitalRequiredDepartment(departmentKey) {
  return HOSPITAL_DEPARTMENT_REQUIRES[departmentKey] || null;
}

function getHospitalCascadeRemovals(departmentKey) {
  return HOSPITAL_REMOVAL_CASCADE[departmentKey] ? [...HOSPITAL_REMOVAL_CASCADE[departmentKey]] : [];
}

function isFoundationHospitalDepartment(key) {
  return FOUNDATION_HOSPITAL_DEPARTMENT_SET.has(key);
}

function ensureFoundationHospitalDepartments(keys) {
  return [...new Set([...FOUNDATION_HOSPITAL_DEPARTMENT_KEYS, ...keys.filter(isValidHospitalDepartmentKey)])];
}

function normalizeCustomHospitalDepartmentKeys(keys) {
  const normalized = ensureFoundationHospitalDepartments(keys);
  if (!normalized.includes(ROLES.BILLING_CLERK)) {
    return normalized.filter((k) => k !== ROLES.REVENUE_OFFICER);
  }
  return normalized;
}

function hospitalDepartmentLabel(key) {
  return HOSPITAL_DEPARTMENT_BY_KEY[key]?.label || key;
}

function isValidHospitalDepartmentKey(key) {
  return VALID_HOSPITAL_DEPARTMENT_KEYS.has(key);
}

function resolveHospitalTemplateKeys(template, customKeys) {
  if (template === 'full') return [...FULL_HOSPITAL_TEMPLATE_KEYS];
  if (template === 'custom' && Array.isArray(customKeys)) {
    return normalizeCustomHospitalDepartmentKeys(customKeys);
  }
  if (template === 'foundation') return [...FOUNDATION_HOSPITAL_DEPARTMENT_KEYS];
  return [...FULL_HOSPITAL_TEMPLATE_KEYS];
}

/** Front-office routing options enabled by active hospital department keys. */
function buildHospitalFrontOfficeRouting(activeDepartmentKeys) {
  const routes = new Map();
  for (const key of activeDepartmentKeys) {
    const def = HOSPITAL_DEPARTMENT_BY_KEY[key];
    if (def?.front_office_route) {
      routes.set(def.front_office_route.value, def.front_office_route);
    }
  }
  return [...routes.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function hospitalFrontOfficeRoutingLabel(value) {
  for (const def of HOSPITAL_DEPARTMENT_DEFINITIONS) {
    if (def.front_office_route?.value === value) return def.front_office_route.label;
  }
  const { routingLabel } = require('./clinicQueueDepartments');
  return routingLabel(value);
}

function isValidHospitalFrontOfficeRouting(value, allowedRoutes) {
  if (!value) return false;
  const allowed = allowedRoutes || buildHospitalFrontOfficeRouting(FULL_HOSPITAL_TEMPLATE_KEYS);
  return allowed.some((row) => row.value === value);
}

module.exports = {
  HOSPITAL_DEPARTMENT_DEFINITIONS,
  HOSPITAL_DEPARTMENT_BY_KEY,
  FOUNDATION_HOSPITAL_DEPARTMENT_KEYS,
  FULL_HOSPITAL_TEMPLATE_KEYS,
  FOUNDATION_HOSPITAL_DEPARTMENT_SET,
  VALID_HOSPITAL_DEPARTMENT_KEYS,
  hospitalDepartmentLabel,
  isValidHospitalDepartmentKey,
  isFoundationHospitalDepartment,
  ensureFoundationHospitalDepartments,
  normalizeCustomHospitalDepartmentKeys,
  getHospitalRequiredDepartment,
  getHospitalCascadeRemovals,
  HOSPITAL_DEPARTMENT_REQUIRES,
  HOSPITAL_REMOVAL_CASCADE,
  resolveHospitalTemplateKeys,
  buildHospitalFrontOfficeRouting,
  hospitalFrontOfficeRoutingLabel,
  isValidHospitalFrontOfficeRouting,
};
