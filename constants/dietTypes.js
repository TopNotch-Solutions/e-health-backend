/** Common inpatient diet orders — doctors select one when admitting or prescribing. */
const DIET_TYPES = [
  { value: 'regular', label: 'Regular / house diet' },
  { value: 'soft', label: 'Soft diet' },
  { value: 'liquid', label: 'Clear liquids' },
  { value: 'full_liquid', label: 'Full liquids' },
  { value: 'diabetic', label: 'Diabetic / controlled carbohydrate' },
  { value: 'low_sodium', label: 'Low sodium' },
  { value: 'renal', label: 'Renal diet' },
  { value: 'high_protein', label: 'High protein' },
  { value: 'npo', label: 'NPO (nothing by mouth)' },
  { value: 'enteral', label: 'Enteral / tube feeding' },
  { value: 'halal', label: 'Halal' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'other', label: 'Other (see notes)' },
];

module.exports = { DIET_TYPES };
