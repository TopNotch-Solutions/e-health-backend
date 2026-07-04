'use strict';

/** Hospital queue departments that can carry a per-visit charge (NAD). */
const HOSPITAL_DEPARTMENT_VISIT_FEES = [
  { slug: 'nurse', label: 'Nurse' },
  { slug: 'doctor', label: 'Doctor' },
  { slug: 'pharmacy', label: 'Pharmacy' },
  { slug: 'lab', label: 'Laboratory' },
  { slug: 'sonar', label: 'Radiology (ultrasound)' },
  { slug: 'hospital_emergency_unit', label: 'Emergency unit' },
  { slug: 'adult_outpatient', label: 'Adult outpatient' },
  { slug: 'pediatric_outpatient', label: 'Pediatric outpatient' },
  { slug: 'ent_outpatient', label: 'ENT outpatient' },
  { slug: 'orthopedic_outpatient', label: 'Orthopedic outpatient' },
  { slug: 'physiotherapy_rehabilitation', label: 'Physiotherapy & rehabilitation' },
  { slug: 'big_room_specialist', label: 'Big room specialist' },
  { slug: 'urology_outpatient', label: 'Urology outpatient' },
  { slug: 'mental_health_outpatient', label: 'Mental health outpatient' },
];

const DEPARTMENT_VISIT_PREFIX = 'dept_visit:';

function departmentVisitFeeKey(slug) {
  return `${DEPARTMENT_VISIT_PREFIX}${slug}`;
}

function parseDepartmentVisitFeeKey(feeKey) {
  if (!feeKey?.startsWith(DEPARTMENT_VISIT_PREFIX)) return null;
  return feeKey.slice(DEPARTMENT_VISIT_PREFIX.length);
}

function departmentVisitLabel(slug) {
  return HOSPITAL_DEPARTMENT_VISIT_FEES.find((row) => row.slug === slug)?.label || slug;
}

function isBillableHospitalDepartment(department) {
  return HOSPITAL_DEPARTMENT_VISIT_FEES.some((row) => row.slug === department);
}

module.exports = {
  HOSPITAL_DEPARTMENT_VISIT_FEES,
  DEPARTMENT_VISIT_PREFIX,
  departmentVisitFeeKey,
  parseDepartmentVisitFeeKey,
  departmentVisitLabel,
  isBillableHospitalDepartment,
};
