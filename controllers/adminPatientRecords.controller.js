'use strict';

const { Op } = require('sequelize');
const { Patient } = require('../models');
const { success, error } = require('../utils/response');
const {
  findByNationalId,
} = require('../services/patientDuplicateService');
const {
  getAdminMedicalHistory,
  attachQueueStaffToHistory,
  buildMedicalHistoryXlsx,
} = require('../services/patientMedicalExportService');
const { buildMedicalCardDocument } = require('../services/patientMedicalCardService');

function isProfileComplete(patient) {
  return Boolean(
    patient?.first_name &&
      patient?.last_name &&
      patient?.sex &&
      patient?.date_of_birth &&
      patient?.id_number &&
      patient?.phone &&
      patient.category !== 'unknown'
  );
}

function normalizeScope(scope) {
  const value = (scope || 'all').trim().toLowerCase();
  if (['all', 'maternity', 'clinic'].includes(value)) return value;
  return 'all';
}

/** System admin: search patients across all facilities. */
exports.searchPatients = async (req, res) => {
  try {
    const idNumber = (req.query.id_number || '').trim();
    const dateOfBirth = (req.query.date_of_birth || '').trim();
    const name = (req.query.name || '').trim();

    if (!idNumber && !(dateOfBirth && name)) {
      return error(res, 'Provide either id_number, or both date_of_birth and name', 400);
    }

    let rows;

    if (idNumber) {
      const normalized = idNumber.replace(/\D/g, '');
      if (normalized.length === 11) {
        const match = await findByNationalId(normalized);
        rows = match ? [await Patient.findByPk(match.id)] : [];
      } else {
        rows = await Patient.findAll({
          where: { id_number: { [Op.like]: `%${idNumber}%` } },
          limit: 50,
          order: [['last_name', 'ASC'], ['first_name', 'ASC']],
        });
      }
    } else {
      const parts = name.split(/\s+/).filter(Boolean);
      const conditions = [{ date_of_birth: dateOfBirth }];

      if (parts.length >= 2) {
        conditions.push(
          { first_name: { [Op.like]: `%${parts[0]}%` } },
          { last_name: { [Op.like]: `%${parts.slice(1).join(' ')}%` } }
        );
      } else {
        conditions.push({
          [Op.or]: [
            { first_name: { [Op.like]: `%${name}%` } },
            { last_name: { [Op.like]: `%${name}%` } },
          ],
        });
      }

      rows = await Patient.findAll({
        where: { [Op.and]: conditions },
        limit: 50,
        order: [['last_name', 'ASC'], ['first_name', 'ASC']],
      });
    }

    const patients = rows.filter(Boolean).map((p) => {
      const json = p.toJSON();
      return {
        ...json,
        profile_complete: isProfileComplete(p),
      };
    });

    return success(res, { patients, count: patients.length });
  } catch (err) {
    console.error('Admin patient search error:', err);
    return error(res, 'Failed to search patients', 500);
  }
};

/** System admin: patient medical history across all facilities. */
exports.getMedicalHistory = async (req, res) => {
  try {
    const scope = normalizeScope(req.query.scope);
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) return error(res, 'Patient not found', 404);

    const history = await getAdminMedicalHistory(patient.id, null, scope);
    const withStaff = await attachQueueStaffToHistory(patient.id, null, history);
    const sanitizedHistory = {
      ...withStaff,
      visits: (withStaff.visits || []).map((visit) => ({
        ...visit,
        stops: (visit.stops || []).map(({ _queueEntry, ...stop }) => stop),
      })),
    };

    return success(res, {
      patient: {
        id: patient.id,
        patient_number: patient.patient_number,
        first_name: patient.first_name,
        last_name: patient.last_name,
        sex: patient.sex,
        date_of_birth: patient.date_of_birth,
        id_number: patient.id_number,
        phone: patient.phone,
      },
      history: sanitizedHistory,
      meta: {
        scope,
        all_facilities: true,
      },
    });
  } catch (err) {
    if (err.status) return error(res, err.message, err.status);
    console.error('Admin medical history error:', err);
    return error(res, 'Failed to load medical history', 500);
  }
};

/** System admin: download medical card as XLSX (all facilities). */
exports.exportMedicalHistory = async (req, res) => {
  try {
    const scope = normalizeScope(req.query.scope);
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) return error(res, 'Patient not found', 404);

    const buffer = await buildMedicalHistoryXlsx(patient.id, null, scope);
    const safeNumber = (patient.patient_number || patient.id).replace(/[^\w-]+/g, '_');
    const filename = `medical-card-${safeNumber}-${scope}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    if (err.status) return error(res, err.message, err.status);
    console.error('Admin medical export error:', err);
    return error(res, 'Failed to export medical card', 500);
  }
};

/** System admin: printable medical card document (all facilities). */
exports.getMedicalCard = async (req, res) => {
  try {
    const visitId = (req.query.visit_id || '').trim() || null;
    const card = await buildMedicalCardDocument(req.params.id, {
      facilityId: null,
      visitId,
      allFacilities: true,
    });
    return success(res, card);
  } catch (err) {
    if (err.status) return error(res, err.message, err.status);
    console.error('Admin medical card error:', err);
    return error(res, 'Failed to build medical card', 500);
  }
};
