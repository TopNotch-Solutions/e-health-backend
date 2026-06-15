const { success, created, error } = require('../utils/response');
const { writeAuditLog } = require('../services/auditLogService');
const {
  searchIcd10Codes,
  getIcd10ByCode,
  listIcd10ForAdmin,
  createIcd10Code,
  setIcd10Active,
  importIcd10FromBuffer,
} = require('../services/icd10Service');

exports.search = async (req, res) => {
  try {
    const q = req.query.q || req.query.query || '';
    const limit = req.query.limit;
    const rows = await searchIcd10Codes(q, { limit });
    return success(res, rows);
  } catch (err) {
    console.error('ICD-10 search error:', err);
    return error(res, 'Failed to search ICD-10 codes', 500);
  }
};

exports.getByCode = async (req, res) => {
  try {
    const row = await getIcd10ByCode(req.params.code);
    if (!row) return error(res, 'ICD-10 code not found', 404);
    return success(res, row);
  } catch (err) {
    console.error('ICD-10 lookup error:', err);
    return error(res, 'Failed to load ICD-10 code', 500);
  }
};

exports.listForAdmin = async (req, res) => {
  try {
    const data = await listIcd10ForAdmin({
      search: req.query.q || req.query.search || '',
      status: req.query.status || '',
      page: req.query.page,
      limit: req.query.limit,
    });
    return success(res, data);
  } catch (err) {
    console.error('ICD-10 admin list error:', err);
    return error(res, 'Failed to load ICD-10 catalog', 500);
  }
};

exports.create = async (req, res) => {
  try {
    const row = await createIcd10Code({
      code: req.body.code || req.body.icd10_code,
      description: req.body.description,
    });
    await writeAuditLog(req, {
      action: 'create',
      resource: 'icd10',
      resourceId: row.id,
      details: {
        icd10_code: row.code,
        description: row.description,
      },
    });
    return created(res, row, 'ICD-10 code created');
  } catch (err) {
    console.error('ICD-10 create error:', err);
    return error(res, err.message || 'Failed to create ICD-10 code', err.status || 500);
  }
};

exports.updateStatus = async (req, res) => {
  try {
    if (typeof req.body.is_active !== 'boolean') {
      return error(res, 'is_active (boolean) is required', 400);
    }
    const row = await setIcd10Active(req.params.id, req.body.is_active);
    await writeAuditLog(req, {
      action: req.body.is_active ? 'activate' : 'inactivate',
      resource: 'icd10',
      resourceId: row.id,
      details: {
        icd10_code: row.code,
        description: row.description,
        is_active: row.is_active,
      },
    });
    return success(res, row, req.body.is_active ? 'ICD-10 code activated' : 'ICD-10 code inactivated');
  } catch (err) {
    console.error('ICD-10 status error:', err);
    return error(res, err.message || 'Failed to update ICD-10 code', err.status || 500);
  }
};

exports.importXlsx = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return error(res, 'Upload an .xlsx file with columns ICD10_Code and description.', 400);
    }
    const name = String(req.file.originalname || '').toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      return error(res, 'Only Excel files (.xlsx, .xls) are supported.', 400);
    }
    const result = await importIcd10FromBuffer(req.file.buffer);
    await writeAuditLog(req, {
      action: 'import',
      resource: 'icd10',
      details: {
        file_name: req.file.originalname,
        created: result.created,
        updated: result.updated,
        row_errors: result.errors?.length || 0,
      },
    });
    return success(res, result, 'ICD-10 import completed');
  } catch (err) {
    console.error('ICD-10 import error:', err);
    return error(res, err.message || 'Failed to import ICD-10 codes', err.status || 500);
  }
};
