const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { MedicationCatalog, PharmacyInventory } = require('../models');
const { MEDICATIONS, resolveUnitPrice } = require('../constants/medicationCatalogSeed');

function formatCatalogRow(row, inStock = false) {
  const name = row.medication_name || row.name;
  const generic = row.generic_name || row.generic || name;
  return {
    id: row.id || null,
    name,
    medication_name: name,
    generic,
    generic_name: generic,
    category: row.category || 'Other',
    unit_price: parseFloat(row.unit_price) || 0,
    in_facility_stock: inStock,
  };
}

function staticCatalogId(medicationName) {
  return `static:${encodeURIComponent(medicationName)}`;
}

function loadStaticCatalogEntries() {
  const byName = new Map();

  for (const m of MEDICATIONS) {
    byName.set(m.name.toLowerCase(), {
      id: staticCatalogId(m.name),
      medication_name: m.name,
      generic_name: m.generic,
      category: m.category || 'Other',
      unit_price: resolveUnitPrice(m),
    });
  }

  try {
    const filePath = path.join(__dirname, '..', 'data', 'medication-catalog.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const row of raw) {
      const key = (row.name || '').toLowerCase();
      if (!key || byName.has(key)) continue;
      const seed = MEDICATIONS.find((m) => m.name.toLowerCase() === key);
      byName.set(key, {
        id: staticCatalogId(row.name),
        medication_name: row.name,
        generic_name: row.generic || row.name,
        category: row.category || 'Other',
        unit_price: seed ? resolveUnitPrice(seed) : resolveUnitPrice({ category: row.category }),
      });
    }
  } catch (err) {
    console.warn('medicationCatalogService: could not read medication-catalog.json', err.message);
  }

  return [...byName.values()].sort((a, b) => a.medication_name.localeCompare(b.medication_name));
}

async function getFacilityInStockNames(facilityId) {
  if (!facilityId) {
    return { names: new Set(), rows: [] };
  }
  const inventory = await PharmacyInventory.findAll({
    where: { facility_id: facilityId },
    attributes: ['medication_name', 'generic_name', 'category', 'unit_price'],
  });
  return {
    names: new Set(
      inventory.map((i) => (i.medication_name || '').toLowerCase()).filter(Boolean)
    ),
    rows: inventory,
  };
}

function mergeInventoryOnlyEntries(catalogByName, inventoryRows, inStockNames) {
  for (const row of inventoryRows) {
    const key = (row.medication_name || '').toLowerCase();
    if (!key || catalogByName.has(key)) continue;
    catalogByName.set(
      key,
      formatCatalogRow(
        {
          id: staticCatalogId(row.medication_name),
          medication_name: row.medication_name,
          generic_name: row.generic_name || row.medication_name,
          category: row.category || 'Other',
          unit_price: parseFloat(row.unit_price) || 0,
        },
        true
      )
    );
  }
  return catalogByName;
}

async function fetchDbCatalogRows() {
  try {
    return await MedicationCatalog.findAll({
      where: { is_active: true },
      order: [['medication_name', 'ASC']],
    });
  } catch (err) {
    console.warn('medicationCatalogService: DB catalog unavailable, using static list.', err.message);
    return [];
  }
}

async function listActiveCatalog({ facilityId, availableOnly = false, includeInventoryOnly = false } = {}) {
  let catalogRows = await fetchDbCatalogRows();
  if (catalogRows.length === 0) {
    catalogRows = loadStaticCatalogEntries();
  }

  const { names: inStockNames, rows: inventoryRows } = await getFacilityInStockNames(facilityId);

  const byName = new Map();
  for (const row of catalogRows) {
    const plain = row.toJSON ? row.toJSON() : row;
    const key = (plain.medication_name || '').toLowerCase();
    if (!key) continue;
    const inStock = inStockNames.has(key);
    byName.set(key, formatCatalogRow(plain, inStock));
  }

  if (includeInventoryOnly) {
    mergeInventoryOnlyEntries(byName, inventoryRows, inStockNames);
  }

  let result = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (availableOnly) {
    result = result.filter((r) => !r.in_facility_stock);
  }

  return result;
}

/** Full list for prescribing (master catalog + facility-only inventory items). */
async function listCatalogForPrescribing(facilityId) {
  return listActiveCatalog({ facilityId, availableOnly: false, includeInventoryOnly: true });
}

async function getCatalogEntryById(catalogId) {
  if (!catalogId) return null;

  if (String(catalogId).startsWith('static:')) {
    const name = decodeURIComponent(String(catalogId).slice(7));
    return findCatalogByName(name);
  }

  const row = await MedicationCatalog.findOne({
    where: { id: catalogId, is_active: true },
  });
  if (row) return row;

  const staticRows = loadStaticCatalogEntries();
  return staticRows.find((r) => r.id === catalogId) || null;
}

async function findCatalogByName(medicationName) {
  if (!medicationName) return null;
  const trimmed = medicationName.trim();

  const row = await MedicationCatalog.findOne({
    where: { medication_name: trimmed, is_active: true },
  });
  if (row) return row;

  const staticRows = loadStaticCatalogEntries();
  return staticRows.find((r) => r.medication_name === trimmed) || null;
}

module.exports = {
  formatCatalogRow,
  listActiveCatalog,
  listCatalogForPrescribing,
  getCatalogEntryById,
  findCatalogByName,
  loadStaticCatalogEntries,
};
