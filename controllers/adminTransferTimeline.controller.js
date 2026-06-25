'use strict';

const { paginated, error } = require('../utils/response');
const {
  listTransfersForAdmin,
  buildTransferTimelinesXlsx,
} = require('../services/adminTransferTimelineService');

function parseFilters(query) {
  return {
    page: query.page,
    limit: query.limit,
    status: query.status || undefined,
    clinic_facility_id: query.clinic_facility_id || undefined,
    hospital_facility_id: query.hospital_facility_id || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
  };
}

exports.listTransfers = async (req, res) => {
  try {
    const result = await listTransfersForAdmin(parseFilters(req.query));
    return paginated(
      res,
      result.rows,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit
    );
  } catch (err) {
    console.error('Admin list transfer timelines error:', err);
    return error(res, 'Failed to load transfer timelines', 500);
  }
};

exports.exportTransfers = async (req, res) => {
  try {
    const buffer = await buildTransferTimelinesXlsx(parseFilters(req.query));
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `clinic-hospital-transfer-timelines-${stamp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    console.error('Admin export transfer timelines error:', err);
    return error(res, 'Failed to export transfer timelines', 500);
  }
};
