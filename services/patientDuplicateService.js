'use strict';

const { Op } = require('sequelize');
const { Patient } = require('../models');

const NATIONAL_ID_LENGTH = 11;

function digitsOnly(value) {
  if (value == null || value === '') return null;
  const d = String(value).replace(/\D/g, '');
  return d || null;
}

function normalizeNationalId(value) {
  return digitsOnly(value);
}

function normalizePhone(value) {
  let d = digitsOnly(value);
  if (!d) return null;
  if (d.startsWith('264') && d.length > 9) d = d.slice(3);
  if (d.startsWith('0') && d.length > 9) d = d.slice(1);
  return d;
}

function formatPatientLabel(patient) {
  const num = patient.patient_number ? ` (${patient.patient_number})` : '';
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim();
  return name ? `${name}${num}` : patient.patient_number || 'existing record';
}

async function findByNationalId(idNumber, excludePatientId, transaction) {
  const normalized = normalizeNationalId(idNumber);
  if (!normalized) return null;

  const where = {
    id_number: { [Op.ne]: null },
    ...(excludePatientId ? { id: { [Op.ne]: excludePatientId } } : {}),
  };

  const rows = await Patient.findAll({
    where,
    attributes: ['id', 'patient_number', 'first_name', 'last_name', 'id_number'],
    transaction,
  });

  return rows.find((row) => normalizeNationalId(row.id_number) === normalized) || null;
}

async function findByPhone(phone, excludePatientId, transaction) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const where = {
    phone: { [Op.ne]: null },
    ...(excludePatientId ? { id: { [Op.ne]: excludePatientId } } : {}),
  };

  const rows = await Patient.findAll({
    where,
    attributes: ['id', 'patient_number', 'first_name', 'last_name', 'phone'],
    transaction,
  });

  return rows.find((row) => normalizePhone(row.phone) === normalized) || null;
}

/**
 * Reject registration/update when national ID or phone already belongs to another patient.
 */
async function assertUniquePatientIdentifiers(
  { id_number, phone, excludePatientId, checkPhone = true },
  transaction
) {
  const idMatch = await findByNationalId(id_number, excludePatientId, transaction);
  if (idMatch) {
    const err = new Error(
      `A patient with this national ID is already registered — ${formatPatientLabel(idMatch)}.`
    );
    err.statusCode = 409;
    throw err;
  }

  if (!checkPhone) return;

  const phoneMatch = await findByPhone(phone, excludePatientId, transaction);
  if (phoneMatch) {
    const err = new Error(
      `A patient with this phone number is already registered — ${formatPatientLabel(phoneMatch)}.`
    );
    err.statusCode = 409;
    throw err;
  }
}

function validateNationalIdForRegistration(idNumber, { required = true } = {}) {
  const normalized = normalizeNationalId(idNumber);
  if (!normalized) {
    if (!required) return null;
    const err = new Error('National ID is required to register a new patient.');
    err.statusCode = 400;
    throw err;
  }
  if (normalized.length !== NATIONAL_ID_LENGTH) {
    const err = new Error(`National ID must be exactly ${NATIONAL_ID_LENGTH} digits.`);
    err.statusCode = 400;
    throw err;
  }
  return normalized;
}

function validatePhoneForRegistration(phone, { required = true, label = 'Primary phone number' } = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    if (!required) return null;
    const err = new Error(`${label} is required to register a new patient.`);
    err.statusCode = 400;
    throw err;
  }
  if (normalized.length < 7) {
    const err = new Error(`Enter a valid ${label.toLowerCase()}.`);
    err.statusCode = 400;
    throw err;
  }
  return normalized;
}

module.exports = {
  NATIONAL_ID_LENGTH,
  normalizeNationalId,
  normalizePhone,
  findByNationalId,
  findByPhone,
  assertUniquePatientIdentifiers,
  validateNationalIdForRegistration,
  validatePhoneForRegistration,
};
