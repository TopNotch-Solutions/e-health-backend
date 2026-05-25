const { success, error } = require('../utils/response');
const { getSupervisorMetrics: getNurseMetrics } = require('../services/nurseSupervisorMetricsService');
const { getSupervisorMetrics: getDoctorMetrics } = require('../services/doctorSupervisorMetricsService');
const { getSupervisorMetrics: getLaboratoryMetrics } = require('../services/laboratorySupervisorMetricsService');
const { getSupervisorMetrics: getRadiologistMetrics } = require('../services/radiologistSupervisorMetricsService');

async function loadMetrics(req, res, loader) {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);
    const metrics = await loader(facilityId);
    return success(res, metrics);
  } catch (err) {
    console.error('Clinical supervisor metrics error:', err);
    return error(res, 'Failed to fetch supervisor metrics', 500);
  }
}

exports.getNurseSupervisorMetrics = (req, res) => loadMetrics(req, res, getNurseMetrics);
exports.getDoctorSupervisorMetrics = (req, res) => loadMetrics(req, res, getDoctorMetrics);
exports.getLaboratorySupervisorMetrics = (req, res) => loadMetrics(req, res, getLaboratoryMetrics);
exports.getRadiologistSupervisorMetrics = (req, res) => loadMetrics(req, res, getRadiologistMetrics);
