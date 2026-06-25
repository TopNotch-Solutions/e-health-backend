const { success, error } = require('../utils/response');
const { getSupervisorMetrics } = require('../services/frontOfficeSupervisorMetricsService');
const { getMyRegistrations } = require('../services/frontOfficeService');
const { getClinicRoutingOptionsForFacility } = require('../services/clinicRoutingService');

exports.getSupervisorMetrics = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);
    const metrics = await getSupervisorMetrics(facilityId);
    return success(res, metrics);
  } catch (err) {
    console.error('Front office supervisor metrics error:', err);
    return error(res, 'Failed to fetch supervisor metrics', 500);
  }
};

exports.getRoutingOptions = async (req, res) => {
  try {
    const facilityId = req.user?.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);
    const options = await getClinicRoutingOptionsForFacility(facilityId);
    return success(res, options);
  } catch (err) {
    console.error('Front office routing options error:', err);
    return error(res, 'Failed to load routing options', 500);
  }
};

exports.getMyRegistrations = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);
    const rows = await getMyRegistrations(req.user.id, facilityId);
    return success(res, { registrations: rows, count: rows.length });
  } catch (err) {
    console.error('Front office my registrations error:', err);
    return error(res, 'Failed to fetch today\'s registrations', 500);
  }
};
