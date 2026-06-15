const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const XLSX = require('xlsx');
const { Icd10Code } = require('../models');
const { ICD10_CODES } = require('../constants/icd10Seed');

function formatRow(row) {
  const plain = row?.toJSON ? row.toJSON() : row;
  if (!plain) return null;
  return {
    code: plain.icd10_code,
    description: plain.description,
  };
}

function formatAdminRow(row) {
  const plain = row?.toJSON ? row.toJSON() : row;
  if (!plain) return null;
  return {
    id: plain.id,
    code: plain.icd10_code,
    description: plain.description,
    is_active: plain.is_active,
    created_at: plain.created_at,
    updated_at: plain.updated_at,
  };
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

function isValidIcd10Code(code) {
  return /^[A-Z]\d{2}(?:\.\d+)?[A-Z0-9]*$/i.test(code);
}

function searchStaticCatalog(query, limit) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ICD10_CODES.filter(
    (row) =>
      row.code.toLowerCase().includes(q) || row.description.toLowerCase().includes(q)
  )
    .slice(0, limit)
    .map((row) => ({ code: row.code, description: row.description }));
}

async function searchIcd10Codes(query, { limit = 25 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const capped = Math.min(Math.max(Number(limit) || 25, 1), 50);

  try {
    const rows = await Icd10Code.findAll({
      where: {
        is_active: true,
        [Op.or]: [
          { icd10_code: { [Op.like]: `%${q}%` } },
          { description: { [Op.like]: `%${q}%` } },
        ],
      },
      order: [['icd10_code', 'ASC']],
      limit: capped,
    });
    if (rows.length) return rows.map(formatRow);
  } catch (err) {
    console.warn('icd10Service: DB lookup failed, using static seed.', err.message);
  }

  return searchStaticCatalog(q, capped);
}

async function getIcd10ByCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;

  try {
    const row = await Icd10Code.findOne({
      where: { icd10_code: normalized, is_active: true },
    });
    if (row) return formatRow(row);
  } catch (err) {
    console.warn('icd10Service: DB getByCode failed, using static seed.', err.message);
  }

  const fromSeed = ICD10_CODES.find((row) => row.code.toUpperCase() === normalized);
  return fromSeed ? { code: fromSeed.code, description: fromSeed.description } : null;
}

async function listIcd10ForAdmin({ search = '', status = '', page = 1, limit = 50 } = {}) {
  const where = {};
  const q = String(search || '').trim();
  if (q) {
    where[Op.or] = [
      { icd10_code: { [Op.like]: `%${q}%` } },
      { description: { [Op.like]: `%${q}%` } },
    ];
  }
  if (status === 'active') where.is_active = true;
  if (status === 'inactive') where.is_active = false;

  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * capped;

  const { rows, count } = await Icd10Code.findAndCountAll({
    where,
    order: [['icd10_code', 'ASC']],
    limit: capped,
    offset,
  });

  const countWhere = {};
  if (q) {
    countWhere[Op.or] = [
      { icd10_code: { [Op.like]: `%${q}%` } },
      { description: { [Op.like]: `%${q}%` } },
    ];
  }

  const [totalActive, totalInactive] = await Promise.all([
    Icd10Code.count({ where: { ...countWhere, is_active: true } }),
    Icd10Code.count({ where: { ...countWhere, is_active: false } }),
  ]);

  return {
    rows: rows.map(formatAdminRow),
    total: count,
    total_active: totalActive,
    total_inactive: totalInactive,
    page: Math.max(Number(page) || 1, 1),
    limit: capped,
  };
}

async function createIcd10Code({ code, description }) {
  const icd10_code = normalizeCode(code);
  const desc = String(description || '').trim();
  if (!icd10_code) {
    const err = new Error('ICD-10 code is required.');
    err.status = 400;
    throw err;
  }
  if (!isValidIcd10Code(icd10_code)) {
    const err = new Error('Invalid ICD-10 code format.');
    err.status = 400;
    throw err;
  }
  if (!desc) {
    const err = new Error('Description is required.');
    err.status = 400;
    throw err;
  }

  const existing = await Icd10Code.findOne({ where: { icd10_code } });
  if (existing) {
    const err = new Error(`ICD-10 code ${icd10_code} already exists.`);
    err.status = 409;
    throw err;
  }

  const row = await Icd10Code.create({
    id: uuidv4(),
    icd10_code,
    description: desc,
    is_active: true,
  });
  return formatAdminRow(row);
}

async function setIcd10Active(id, is_active) {
  const row = await Icd10Code.findByPk(id);
  if (!row) {
    const err = new Error('ICD-10 code not found.');
    err.status = 404;
    throw err;
  }
  row.is_active = Boolean(is_active);
  await row.save();
  return formatAdminRow(row);
}

function pickColumn(row, keys) {
  const entries = Object.entries(row || {});
  for (const key of keys) {
    const found = entries.find(([k]) => k.trim().toLowerCase() === key.toLowerCase());
    if (found && String(found[1]).trim()) return String(found[1]).trim();
  }
  return '';
}

function parseImportRows(sheetRows) {
  const parsed = [];
  const errors = [];

  sheetRows.forEach((row, idx) => {
    const code = pickColumn(row, ['icd10_code', 'icd10 code', 'icd10', 'code', 'icd-10']);
    const description = pickColumn(row, ['description', 'desc', 'name', 'diagnosis']);
    if (!code && !description) return;
    if (!code || !description) {
      errors.push(`Row ${idx + 2}: missing code or description.`);
      return;
    }
    const normalized = normalizeCode(code);
    if (!isValidIcd10Code(normalized)) {
      errors.push(`Row ${idx + 2}: invalid code "${code}".`);
      return;
    }
    parsed.push({ code: normalized, description });
  });

  return { parsed, errors };
}

async function importIcd10FromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    const err = new Error('The spreadsheet has no worksheets.');
    err.status = 400;
    throw err;
  }

  const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  const { parsed, errors: parseErrors } = parseImportRows(sheetRows);
  if (!parsed.length) {
    const err = new Error(
      parseErrors[0] || 'No valid ICD-10 rows found. Use columns ICD10_Code and description.'
    );
    err.status = 400;
    throw err;
  }

  let created = 0;
  let updated = 0;
  const importErrors = [...parseErrors];

  for (const item of parsed) {
    try {
      const existing = await Icd10Code.findOne({ where: { icd10_code: item.code } });
      if (existing) {
        existing.description = item.description;
        existing.is_active = true;
        await existing.save();
        updated += 1;
      } else {
        await Icd10Code.create({
          id: uuidv4(),
          icd10_code: item.code,
          description: item.description,
          is_active: true,
        });
        created += 1;
      }
    } catch (err) {
      importErrors.push(`${item.code}: ${err.message}`);
    }
  }

  return { created, updated, skipped: parseErrors.length, errors: importErrors };
}

module.exports = {
  searchIcd10Codes,
  getIcd10ByCode,
  listIcd10ForAdmin,
  createIcd10Code,
  setIcd10Active,
  importIcd10FromBuffer,
};
