const { v4: uuidv4 } = require('uuid');
const {
  DietPrescription,
  MealPlan,
  Admission,
  Bed,
  Ward,
  Visit,
  Patient,
} = require('../models');
const notificationService = require('./notificationService');

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const KITCHEN_ADMISSION_STATUSES = ['pending_arrival', 'admitted'];

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function loadAdmissionWithLocation(admissionId, transaction) {
  return Admission.findByPk(admissionId, {
    include: [
      {
        model: Bed,
        as: 'bed',
        include: [{ model: Ward, as: 'ward' }],
      },
      {
        association: 'visit',
        include: [{ model: Patient, as: 'patient' }],
      },
    ],
    transaction,
  });
}

function buildKitchenOrderPayload(admission, dietPrescription, mealPlans) {
  const bed = admission?.bed;
  const ward = bed?.ward;
  const patient = admission?.visit?.patient;
  const patientName = patient
    ? [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim()
    : 'Patient';

  return {
    admission_id: admission.id,
    visit_id: admission.visit_id,
    admission_status: admission.status,
    ward: ward
      ? {
          id: ward.id,
          name: ward.name,
          ward_number: ward.ward_number,
        }
      : null,
    room_number: bed?.room_number || null,
    bed_number: bed?.bed_number || null,
    location_label: [
      ward?.name,
      bed?.room_number ? `Room ${bed.room_number}` : null,
      bed?.bed_number ? `Bed ${bed.bed_number}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    patient: {
      id: patient?.id,
      name: patientName,
      patient_number: patient?.patient_number,
    },
    diet: {
      id: dietPrescription.id,
      diet_type: dietPrescription.diet_type,
      description: dietPrescription.description,
      restrictions: dietPrescription.restrictions,
      special_instructions: dietPrescription.special_instructions,
      start_date: dietPrescription.start_date,
      end_date: dietPrescription.end_date,
      status: dietPrescription.status,
    },
    meal_plans: (mealPlans || []).map((mp) => ({
      id: mp.id,
      meal_type: mp.meal_type,
      meal_date: mp.meal_date,
      prepared: mp.prepared,
      dispensed: mp.dispensed,
    })),
  };
}

/**
 * Create diet prescription + today's meal plans and notify kitchen.
 */
async function prescribeForAdmission({
  admissionId,
  prescribedBy,
  diet_type,
  description,
  restrictions,
  special_instructions,
  start_date,
  end_date,
  transaction,
}) {
  if (!admissionId || !diet_type) {
    throw new Error('admission_id and diet_type are required');
  }

  const admission = await loadAdmissionWithLocation(admissionId, transaction);
  if (!admission) throw new Error('Admission not found');

  const mealDate = start_date || todayDateString();

  const dietPrescription = await DietPrescription.create(
    {
      id: uuidv4(),
      admission_id: admissionId,
      prescribed_by: prescribedBy,
      diet_type,
      description: description || null,
      restrictions: restrictions || null,
      special_instructions: special_instructions || null,
      start_date: mealDate,
      end_date: end_date || null,
      status: 'active',
    },
    { transaction }
  );

  const mealPlans = [];
  for (const meal of MEAL_TYPES) {
    const mp = await MealPlan.create(
      {
        id: uuidv4(),
        diet_prescription_id: dietPrescription.id,
        meal_type: meal,
        meal_date: mealDate,
      },
      { transaction }
    );
    mealPlans.push(mp);
  }

  const kitchenOrder = buildKitchenOrderPayload(admission, dietPrescription, mealPlans);

  return { dietPrescription, mealPlans, kitchenOrder };
}

function emitKitchenOrder(kitchenOrder) {
  notificationService.emitKitchenOrder(kitchenOrder);
}

function formatMealPlanRow(plan) {
  const dp = plan.dietPrescription;
  const admission = dp?.admission;
  const bed = admission?.bed;
  const ward = bed?.ward;
  const patient = admission?.visit?.patient;
  const patientName = patient
    ? [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim()
    : 'Patient';

  return {
    id: plan.id,
    meal_type: plan.meal_type,
    meal_date: plan.meal_date,
    prepared: Boolean(plan.prepared),
    dispensed: Boolean(plan.dispensed),
    prepared_by: plan.prepared_by,
    dispensed_at: plan.dispensed_at,
    patient_name: patientName,
    patient_number: patient?.patient_number,
    ward_name: ward?.name || '—',
    ward_number: ward?.ward_number,
    room_number: bed?.room_number || null,
    bed_number: bed?.bed_number || '—',
    location_label: [
      ward?.name,
      bed?.room_number ? `Room ${bed.room_number}` : null,
      bed?.bed_number ? `Bed ${bed.bed_number}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    admission_status: admission?.status,
    diet_type: dp?.diet_type,
    diet_description: dp?.description,
    diet_restrictions: dp?.restrictions,
    diet_special_instructions: dp?.special_instructions,
  };
}

module.exports = {
  MEAL_TYPES,
  KITCHEN_ADMISSION_STATUSES,
  todayDateString,
  loadAdmissionWithLocation,
  buildKitchenOrderPayload,
  prescribeForAdmission,
  emitKitchenOrder,
  formatMealPlanRow,
};
