'use strict';

const { Op } = require('sequelize');
const XLSX = require('xlsx');
const {
  ClinicHospitalTransfer,
  Patient,
} = require('../models');
const { departmentLabel } = require('../config/hospitalOutpatientConfig');
const {
  serializeTransfer,
  TRANSFER_USER_INCLUDES,
} = require('./clinicHospitalTransferService');

const TRANSFER_LIST_INCLUDES = [
  {
    association: 'visit',
    attributes: ['id', 'visit_number', 'patient_id'],
    include: [{
      model: Patient,
      as: 'patient',
      attributes: ['id', 'first_name', 'last_name', 'patient_number'],
    }],
  },
  { association: 'clinicFacility', attributes: ['id', 'name', 'type'] },
  { association: 'hospitalFacility', attributes: ['id', 'name', 'type'] },
  ...TRANSFER_USER_INCLUDES,
];

function patientDisplayName(patient) {
  if (!patient) return '—';
  return [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim() || '—';
}

function formatIso(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString();
  } catch {
    return String(iso);
  }
}

function buildTransferWhere(filters = {}) {
  const where = {};
  if (filters.status) where.transfer_status = filters.status;
  if (filters.clinic_facility_id) where.clinic_facility_id = filters.clinic_facility_id;
  if (filters.hospital_facility_id) where.hospital_facility_id = filters.hospital_facility_id;
  if (filters.from || filters.to) {
    where.created_at = {};
    if (filters.from) where.created_at[Op.gte] = new Date(filters.from);
    if (filters.to) {
      const end = new Date(filters.to);
      end.setHours(23, 59, 59, 999);
      where.created_at[Op.lte] = end;
    }
  }
  return where;
}

async function listTransfersForAdmin(filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;
  const where = buildTransferWhere(filters);

  const { rows, count } = await ClinicHospitalTransfer.findAndCountAll({
    where,
    include: TRANSFER_LIST_INCLUDES,
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return {
    rows: rows.map((row) => serializeTransfer(row, { includeTimeline: true })),
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.ceil(count / limit) || 1,
    },
  };
}

async function fetchTransfersForExport(filters = {}) {
  return ClinicHospitalTransfer.findAll({
    where: buildTransferWhere(filters),
    include: TRANSFER_LIST_INCLUDES,
    order: [['created_at', 'DESC']],
    limit: 5000,
  });
}

async function buildTransferTimelinesXlsx(filters = {}) {
  const transfers = await fetchTransfersForExport(filters);

  const summaryRows = transfers.map((transfer) => {
    const plain = serializeTransfer(transfer, { includeTimeline: true });
    const patient = plain.visit?.patient;
    return {
      'Transfer ID': plain.id,
      'Patient name': patientDisplayName(patient),
      'Patient number': patient?.patient_number || '',
      'Clinic visit': plain.visit?.visit_number || '',
      'Referring clinic': plain.clinicFacility?.name || '',
      'State hospital': plain.hospitalFacility?.name || '',
      'Destination department': departmentLabel(plain.destination_department),
      Status: plain.transfer_status,
      'Source role': plain.source_role || '',
      'Transfer reason': plain.transfer_reason || '',
      'Created at': formatIso(plain.created_at),
      'Last updated': formatIso(plain.updated_at),
    };
  });

  const timelineRows = [];
  for (const transfer of transfers) {
    const plain = serializeTransfer(transfer, { includeTimeline: true });
    const patient = plain.visit?.patient;
    for (const step of plain.timeline || []) {
      timelineRows.push({
        'Transfer ID': plain.id,
        'Patient number': patient?.patient_number || '',
        Step: step.key,
        'Step label': step.label,
        Completed: step.completed ? 'Yes' : 'No',
        Timestamp: step.at ? formatIso(step.at) : '',
        Actor: step.actor || '',
      });
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{
      'Transfer ID': '',
      Note: 'No transfers match the selected filters',
    }]),
    'Transfers'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(timelineRows.length ? timelineRows : [{
      'Transfer ID': '',
      Note: 'No timeline steps',
    }]),
    'Timeline'
  );

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  listTransfersForAdmin,
  buildTransferTimelinesXlsx,
};
