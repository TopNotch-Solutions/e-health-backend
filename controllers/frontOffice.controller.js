const { success, error } = require('../utils/response');
const { getSupervisorMetrics } = require('../services/frontOfficeSupervisorMetricsService');

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
