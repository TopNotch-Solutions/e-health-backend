const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/** bill_items.reference_id is CHAR(36) — UUIDs pass through; longer keys are hashed. */
function normalizeReferenceId(referenceId) {
  if (referenceId == null || referenceId === '') return null;
  const s = String(referenceId);
  if (s.length <= 36) return s;
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 36);
}
const {
  Bill,
  BillItem,
  Visit,
  Patient,
  Admission,
  SonarRequest,
  Facility,
  sequelize,
} = require('../models');
const { getFeeAmount, getSonarBillingIntervalMinutes, FEE_KEYS } = require('./billingFeeService');
const { isBillableHospitalDepartment, departmentVisitLabel, departmentVisitFeeKey } = require('../config/billingDepartmentFees');
const { findInventoryForMedication } = require('./pharmacyStockStatus');
const { isClinicFacility } = require('../config/clinicRoles');

function money(n) {
  return Math.round(parseFloat(n) * 100) / 100;
}

async function loadVisitWithPatient(visitId, transaction) {
  return Visit.findByPk(visitId, {
    include: [{ model: Patient, as: 'patient' }],
    transaction,
  });
}

function isPrivatePatient(patient) {
  return patient?.payment_type === 'private';
}

async function usesClinicFlatBilling(facilityId, transaction) {
  const facility = await Facility.findByPk(facilityId, { transaction });
  return isClinicFacility(facility);
}

async function hasCharge(billId, category, referenceId, transaction) {
  const where = { bill_id: billId, category };
  if (referenceId) where.reference_id = referenceId;
  const existing = await BillItem.findOne({ where, transaction });
  return Boolean(existing);
}

async function getOrCreateBill(visit, transaction) {
  let bill = await Bill.findOne({ where: { visit_id: visit.id }, transaction });
  if (bill) return bill;

  return Bill.create(
    {
      id: uuidv4(),
      visit_id: visit.id,
      patient_id: visit.patient_id,
      status: 'accumulating',
      total_amount: 0,
      paid_amount: 0,
      cash_paid: 0,
      eft_paid: 0,
    },
    { transaction }
  );
}

async function addCharge({
  visitId,
  facilityId,
  category,
  description,
  amount,
  referenceId,
  transaction,
}) {
  const visit = await loadVisitWithPatient(visitId, transaction);
  if (!visit || !isPrivatePatient(visit.patient)) return null;

  const chargeAmount = money(amount);
  if (chargeAmount <= 0) return null;

  const bill = await getOrCreateBill(visit, transaction);
  const refKey = normalizeReferenceId(referenceId);
  if (refKey && (await hasCharge(bill.id, category, refKey, transaction))) {
    return { bill, skipped: true };
  }

  const item = await BillItem.create(
    {
      id: uuidv4(),
      bill_id: bill.id,
      description,
      category,
      amount: chargeAmount,
      reference_id: refKey,
    },
    { transaction }
  );

  await bill.update(
    { total_amount: money(parseFloat(bill.total_amount) + chargeAmount) },
    { transaction }
  );

  return { bill, item };
}

async function chargeAdmissionFee(visitId, facilityId, transaction) {
  if (await usesClinicFlatBilling(facilityId, transaction)) {
    const amount = await getFeeAmount(facilityId, FEE_KEYS.CLINIC_VISIT, transaction);
    return addCharge({
      visitId,
      facilityId,
      category: 'clinic_visit',
      description: 'Clinic visit fee (all activities)',
      amount,
      referenceId: visitId,
      transaction,
    });
  }

  const amount = await getFeeAmount(facilityId, FEE_KEYS.ADMISSION, transaction);
  return addCharge({
    visitId,
    facilityId,
    category: 'nursing',
    description: 'Admission fee',
    amount,
    referenceId: visitId,
    transaction,
  });
}

async function chargeDepartmentVisit(visitId, department, facilityId, queueEntryId, transaction) {
  if (await usesClinicFlatBilling(facilityId, transaction)) return null;
  if (!isBillableHospitalDepartment(department)) return null;

  const feeKey = departmentVisitFeeKey(department);
  const amount = await getFeeAmount(facilityId, feeKey, transaction);
  if (amount <= 0) return null;

  return addCharge({
    visitId,
    facilityId,
    category: 'department_visit',
    description: `${departmentVisitLabel(department)} visit`,
    amount,
    referenceId: queueEntryId,
    transaction,
  });
}

async function chargeConsultationFee(visitId, consultationId, facilityId, transaction) {
  if (await usesClinicFlatBilling(facilityId, transaction)) return null;

  const amount = await getFeeAmount(facilityId, FEE_KEYS.DOCTOR_CONSULTATION, transaction);
  return addCharge({
    visitId,
    facilityId,
    category: 'consultation',
    description: 'Doctor consultation fee',
    amount,
    referenceId: consultationId,
    transaction,
  });
}

/** Bill a single line when the pharmacist hands medication to the patient. */
async function chargeDispensedItem(visitId, prescriptionItem, facilityId, transaction) {
  if (await usesClinicFlatBilling(facilityId, transaction)) return null;

  const row = prescriptionItem.toJSON ? prescriptionItem.toJSON() : prescriptionItem;
  const medName = row.medication_name;
  const inv = await findInventoryForMedication(medName, facilityId, transaction);
  const unitPrice = inv ? parseFloat(inv.unit_price) || 0 : 0;
  const qty = parseInt(row.quantity, 10) || 1;
  const lineTotal = money(unitPrice * qty);

  if (lineTotal <= 0) {
    return { skipped: true, reason: 'no_unit_price', medication_name: medName };
  }

  return addCharge({
    visitId,
    facilityId,
    category: 'medication',
    description: `${medName} × ${qty}`,
    amount: lineTotal,
    referenceId: row.id,
    transaction,
  });
}

/** @deprecated Prefer chargeDispensedItem when pharmacist dispenses. */
async function chargePrescriptionItems(visitId, prescriptionId, items, facilityId, transaction) {
  const results = [];
  for (const item of items) {
    const r = await chargeDispensedItem(visitId, item, facilityId, transaction);
    if (r && !r.skipped) results.push(r);
  }
  return results;
}

async function chargeSonarFee(visitId, sonarRequestId, facilityId, transaction) {
  if (await usesClinicFlatBilling(facilityId, transaction)) return null;

  const request = await SonarRequest.findByPk(sonarRequestId, { transaction });
  if (!request) return null;

  const intervalMinutes = await getSonarBillingIntervalMinutes(facilityId, transaction);

  let minutes = intervalMinutes;
  if (request.started_at && request.completed_at) {
    minutes = Math.max(
      intervalMinutes,
      Math.ceil((new Date(request.completed_at) - new Date(request.started_at)) / 60000)
    );
  }
  const blocks = Math.ceil(minutes / intervalMinutes);
  const rate = await getFeeAmount(facilityId, FEE_KEYS.SONAR_30MIN, transaction);
  const amount = money(blocks * rate);

  return addCharge({
    visitId,
    facilityId,
    category: 'sonar',
    description: `Ultrasound (${blocks} × ${intervalMinutes} min) — ${request.scan_type}`,
    amount,
    referenceId: sonarRequestId,
    transaction,
  });
}

function wardDaysBetween(admission) {
  const start = admission.admitted_at || new Date();
  const end = admission.discharged_at || new Date();
  const ms = Math.max(0, new Date(end) - new Date(start));
  const days = Math.ceil(ms / 86400000);
  return Math.max(1, days);
}

async function chargeWardStay(visitId, admission, facilityId, transaction) {
  if (await usesClinicFlatBilling(facilityId, transaction)) return null;
  if (!admission) return null;
  const days = wardDaysBetween(admission);
  const daily = await getFeeAmount(facilityId, FEE_KEYS.WARD_DAILY, transaction);
  const amount = money(days * daily);

  return addCharge({
    visitId,
    facilityId,
    category: 'ward',
    description: `Ward stay (${days} day${days === 1 ? '' : 's'})`,
    amount,
    referenceId: admission.id,
    transaction,
  });
}

async function finalizeBillForDischarge(visitId, facilityId, transaction) {
  const visit = await loadVisitWithPatient(visitId, transaction);
  if (!visit || !isPrivatePatient(visit.patient)) return null;

  const admission = await Admission.findOne({
    where: { visit_id: visitId },
    transaction,
  });
  if (admission) {
    await chargeWardStay(visitId, admission, facilityId, transaction);
  }

  const bill = await Bill.findOne({ where: { visit_id: visitId }, transaction });
  if (!bill) {
    return null;
  }

  await bill.update({ status: 'pending_payment' }, { transaction });
  return bill;
}

module.exports = {
  money,
  isPrivatePatient,
  addCharge,
  chargeAdmissionFee,
  chargeDepartmentVisit,
  chargeConsultationFee,
  chargeDispensedItem,
  chargePrescriptionItems,
  chargeSonarFee,
  chargeWardStay,
  finalizeBillForDischarge,
  getOrCreateBill,
};
