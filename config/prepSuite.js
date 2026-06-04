/**
 * Clinic PrEP Suite — prevention queue and injectable PrEP administration.
 */

const PREP_DEPARTMENT = 'prep';

const DEFAULT_INJECTION = {
  medication: 'Cabotegravir 600 mg IM (long-acting PrEP)',
  injection_site: 'gluteal',
};

function emptySessionData() {
  return {
    injection: null,
    counseling_notes: null,
  };
}

module.exports = {
  PREP_DEPARTMENT,
  DEFAULT_INJECTION,
  emptySessionData,
};
