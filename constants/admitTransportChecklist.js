/**
 * Default equipment / safety checklist options shown when admitting (doctor selects applicable items).
 */
const ADMIT_TRANSPORT_CHECKLIST_OPTIONS = [
  { id: 'id_band', label: 'Patient identification band verified' },
  { id: 'mobility_match', label: 'Mobility equipment matches order (wheelchair / stretcher / walking)' },
  { id: 'oxygen_secure', label: 'Portable oxygen secured (if in use)' },
  { id: 'iv_lines', label: 'IV lines and pumps secured for transport' },
  { id: 'isolation', label: 'Isolation / infection precautions communicated to porter' },
  { id: 'rails_bed', label: 'Bed / stretcher rails and brakes checked before move' },
  { id: 'belongings', label: 'Personal belongings accounted for' },
  { id: 'handover', label: 'Verbal handover given to receiving ward (if applicable)' },
];

module.exports = { ADMIT_TRANSPORT_CHECKLIST_OPTIONS };
