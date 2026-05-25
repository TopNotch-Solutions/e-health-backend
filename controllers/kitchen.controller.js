const { v4: uuidv4 } = require('uuid');
const {
  MealPlan,
  DietPrescription,
  Admission,
  Patient,
  Bed,
  Ward,
  sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, error } = require('../utils/response');
const {
  KITCHEN_ADMISSION_STATUSES,
  formatMealPlanRow,
  todayDateString,
} = require('../services/dietPrescriptionService');

async function fetchMealPlansForFacility(facilityId, mealDate) {
  const plans = await MealPlan.findAll({
    where: { meal_date: mealDate },
    include: [
      {
        association: 'dietPrescription',
        where: { status: 'active' },
        required: true,
        include: [
          {
            model: Admission,
            as: 'admission',
            where: { status: { [Op.in]: KITCHEN_ADMISSION_STATUSES } },
            required: true,
            include: [
              {
                model: Bed,
                as: 'bed',
                required: true,
                include: [
                  {
                    model: Ward,
                    as: 'ward',
                    required: true,
                    where: { facility_id: facilityId },
                  },
                ],
              },
              {
                association: 'visit',
                required: true,
                include: [
                  {
                    model: Patient,
                    as: 'patient',
                    attributes: ['id', 'first_name', 'last_name', 'patient_number'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    order: [
      ['meal_type', 'ASC'],
      [{ model: DietPrescription, as: 'dietPrescription' }, { model: Admission, as: 'admission' }, { model: Bed, as: 'bed' }, { model: Ward, as: 'ward' }, 'name', 'ASC'],
      [{ model: DietPrescription, as: 'dietPrescription' }, { model: Admission, as: 'admission' }, { model: Bed, as: 'bed' }, 'room_number', 'ASC'],
    ],
  });

  return plans;
}

function groupPlans(plans) {
  const rows = plans.map(formatMealPlanRow);
  return {
    breakfast: rows.filter((p) => p.meal_type === 'breakfast'),
    lunch: rows.filter((p) => p.meal_type === 'lunch'),
    dinner: rows.filter((p) => p.meal_type === 'dinner'),
    snack: rows.filter((p) => p.meal_type === 'snack'),
    all: rows,
  };
}

exports.getMealPlans = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);

    const mealDate = req.query.date || todayDateString();
    const plans = await fetchMealPlansForFacility(facilityId, mealDate);
    const grouped = groupPlans(plans);

    return success(res, {
      date: mealDate,
      plans: grouped,
      orders: grouped.all,
      total: grouped.all.length,
    });
  } catch (err) {
    console.error('Get meal plans error:', err);
    return error(res, 'Failed to fetch meal plans', 500);
  }
};

exports.markPrepared = async (req, res) => {
  try {
    const plan = await MealPlan.findByPk(req.params.id);
    if (!plan) return error(res, 'Meal plan not found', 404);

    await plan.update({ prepared: true, prepared_by: req.user.id });
    return success(res, plan, 'Meal marked as prepared');
  } catch (err) {
    return error(res, 'Failed to update meal plan', 500);
  }
};

exports.markDispensed = async (req, res) => {
  try {
    const plan = await MealPlan.findByPk(req.params.id);
    if (!plan) return error(res, 'Meal plan not found', 404);
    if (!plan.prepared) return error(res, 'Meal must be prepared before dispensing', 400);

    await plan.update({ dispensed: true, dispensed_at: new Date() });
    return success(res, plan, 'Meal dispensed to patient');
  } catch (err) {
    return error(res, 'Failed to update meal plan', 500);
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);

    const today = todayDateString();
    const plans = await fetchMealPlansForFacility(facilityId, today);
    const rows = plans.map(formatMealPlanRow);

    const stats = {
      date: today,
      total_meals: rows.length,
      prepared: rows.filter((p) => p.prepared).length,
      dispensed: rows.filter((p) => p.dispensed).length,
      pending: rows.filter((p) => !p.prepared).length,
      unique_patients: new Set(rows.map((p) => `${p.patient_number}-${p.ward_name}-${p.bed_number}`)).size,
      by_type: {
        breakfast: {
          total: rows.filter((p) => p.meal_type === 'breakfast').length,
          prepared: rows.filter((p) => p.meal_type === 'breakfast' && p.prepared).length,
        },
        lunch: {
          total: rows.filter((p) => p.meal_type === 'lunch').length,
          prepared: rows.filter((p) => p.meal_type === 'lunch' && p.prepared).length,
        },
        dinner: {
          total: rows.filter((p) => p.meal_type === 'dinner').length,
          prepared: rows.filter((p) => p.meal_type === 'dinner' && p.prepared).length,
        },
      },
    };

    return success(res, stats);
  } catch (err) {
    console.error('Kitchen dashboard error:', err);
    return error(res, 'Failed to fetch dashboard', 500);
  }
};

exports.generateDailyPlans = async (req, res) => {
  try {
    const { date } = req.body;
    const targetDate = date || new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const activeDiets = await DietPrescription.findAll({
      where: {
        status: 'active',
        start_date: { [Op.lte]: targetDate },
        [Op.or]: [{ end_date: null }, { end_date: { [Op.gte]: targetDate } }],
      },
    });

    const meals = ['breakfast', 'lunch', 'dinner'];
    let createdCount = 0;

    for (const diet of activeDiets) {
      for (const mealType of meals) {
        const existing = await MealPlan.findOne({
          where: { diet_prescription_id: diet.id, meal_type: mealType, meal_date: targetDate },
        });
        if (!existing) {
          await MealPlan.create({
            id: uuidv4(),
            diet_prescription_id: diet.id,
            meal_type: mealType,
            meal_date: targetDate,
          });
          createdCount++;
        }
      }
    }

    return success(res, { date: targetDate, plans_created: createdCount }, 'Daily meal plans generated');
  } catch (err) {
    console.error('Generate plans error:', err);
    return error(res, 'Failed to generate meal plans', 500);
  }
};
