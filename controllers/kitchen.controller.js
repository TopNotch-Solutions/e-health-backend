const { v4: uuidv4 } = require('uuid');
const { MealPlan, DietPrescription, Admission, Visit, Patient, Bed, Ward, KitchenInventory, sequelize } = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');

// Get today's meal plans for all admitted patients
exports.getMealPlans = async (req, res) => {
  try {
    const { date } = req.query;
    const mealDate = date || new Date().toISOString().slice(0, 10);

    const plans = await MealPlan.findAll({
      where: { meal_date: mealDate },
      include: [{
        association: 'dietPrescription',
        where: { status: 'active' },
        include: [{
          model: Admission, as: 'admission',
          where: { status: 'admitted' },
          include: [
            { model: Bed, as: 'bed', include: [{ model: Ward, as: 'ward', where: { facility_id: req.user.facility_id } }] },
            { association: 'visit', include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }] },
          ],
        }],
      }],
      order: [['meal_type', 'ASC']],
    });

    // Group by meal type
    const grouped = {
      breakfast: plans.filter(p => p.meal_type === 'breakfast'),
      lunch: plans.filter(p => p.meal_type === 'lunch'),
      dinner: plans.filter(p => p.meal_type === 'dinner'),
      snack: plans.filter(p => p.meal_type === 'snack'),
    };

    return success(res, { date: mealDate, plans: grouped, total: plans.length });
  } catch (err) {
    console.error('Get meal plans error:', err);
    return error(res, 'Failed to fetch meal plans', 500);
  }
};

// Mark meal as prepared
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

// Mark meal as dispensed (served to patient)
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

// Get meal plan summary/stats for kitchen dashboard
exports.getDashboard = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const plans = await MealPlan.findAll({
      where: { meal_date: today },
      include: [{
        association: 'dietPrescription',
        where: { status: 'active' },
      }],
    });

    const stats = {
      date: today,
      total_meals: plans.length,
      prepared: plans.filter(p => p.prepared).length,
      dispensed: plans.filter(p => p.dispensed).length,
      pending: plans.filter(p => !p.prepared).length,
      by_type: {
        breakfast: { total: plans.filter(p => p.meal_type === 'breakfast').length, prepared: plans.filter(p => p.meal_type === 'breakfast' && p.prepared).length },
        lunch: { total: plans.filter(p => p.meal_type === 'lunch').length, prepared: plans.filter(p => p.meal_type === 'lunch' && p.prepared).length },
        dinner: { total: plans.filter(p => p.meal_type === 'dinner').length, prepared: plans.filter(p => p.meal_type === 'dinner' && p.prepared).length },
      },
    };

    return success(res, stats);
  } catch (err) {
    return error(res, 'Failed to fetch dashboard', 500);
  }
};

// Generate meal plans for a new day (e.g., called by cron or manually)
exports.generateDailyPlans = async (req, res) => {
  try {
    const { date } = req.body;
    const targetDate = date || new Date(Date.now() + 86400000).toISOString().slice(0, 10); // tomorrow

    // Get all active diet prescriptions
    const activeDiets = await DietPrescription.findAll({
      where: {
        status: 'active',
        start_date: { [Op.lte]: targetDate },
        [Op.or]: [
          { end_date: null },
          { end_date: { [Op.gte]: targetDate } },
        ],
      },
    });

    const meals = ['breakfast', 'lunch', 'dinner'];
    let createdCount = 0;

    for (const diet of activeDiets) {
      for (const mealType of meals) {
        // Check if already exists
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
