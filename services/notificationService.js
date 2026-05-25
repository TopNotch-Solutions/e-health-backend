const { getIO } = require('../socket');

/**
 * Emit a queue update to a specific department room.
 */
function emitQueueUpdate(department, event, data) {
  const io = getIO();
  io.to(`room:${department}`).emit(event, data);
}

/**
 * Notify a specific user via their personal room.
 */
function notifyUser(userId, event, data) {
  const io = getIO();
  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Emit stock alert to doctors and pharmacy.
 */
function emitStockAlert(data) {
  const io = getIO();
  io.to('room:doctor').emit('notification:stock_alert', data);
  io.to('room:pharmacist').emit('notification:stock_alert', data);
  io.to('room:pharmacy_supervisor').emit('notification:stock_alert', data);
}

/**
 * Notify pharmacy supervisor of inventory changes (receive, low stock).
 */
function emitPharmacyInventoryUpdate(data) {
  const io = getIO();
  io.to('room:pharmacy_supervisor').emit('pharmacy:inventory_update', data);
}

/**
 * Notify front office supervisor of a new registration or check-in.
 */
function emitFrontOfficeRegistration(data) {
  const io = getIO();
  io.to('room:front_office_supervisor').emit('front_office:registration', data);
}

function emitNurseActivity(data) {
  const io = getIO();
  io.to('room:nurse_supervisor').emit('nurse:activity', data);
}

function emitDoctorActivity(data) {
  const io = getIO();
  io.to('room:doctor_supervisor').emit('doctor:activity', data);
}

function emitLaboratoryActivity(data) {
  const io = getIO();
  io.to('room:laboratory_supervisor').emit('laboratory:activity', data);
}

function emitRadiologistSupervisorActivity(data) {
  const io = getIO();
  io.to('room:radiologist_supervisor').emit('radiologist:activity', data);
}

/**
 * Emit lab/sonar result ready notification to requesting doctor.
 */
function emitResultReady(doctorId, type, data) {
  const io = getIO();
  const event = type === 'lab' ? 'notification:lab_result_ready' : 'notification:sonar_result_ready';
  io.to(`user:${doctorId}`).emit(event, data);
  io.to('room:doctor').emit(event, data);
}

/**
 * Emit dashboard stats to admin room.
 */
function emitDashboardStats(stats) {
  const io = getIO();
  io.to('room:admin_dashboard').emit('dashboard:live_stats', stats);
}

/**
 * Emit transport request to porter room.
 */
function emitTransportRequest(data) {
  const io = getIO();
  io.to('room:porter').emit('transport:new_request', data);
}

/**
 * Emit ward/bed status update.
 */
function emitWardUpdate(data) {
  const io = getIO();
  io.to('room:ward_supervisor').emit('ward:bed_status', data);
  io.to('room:ward_staff').emit('ward:bed_status', data);
}

/**
 * Notify ward staff of a new pending arrival (doctor admit).
 */
function emitWardStaffAdmission(data) {
  const io = getIO();
  io.to('room:ward_staff').emit('ward:new_admission', data);
  emitWardStaffQueueRefresh({ reason: 'new_admission' });
}

function emitWardStaffQueueRefresh(data = {}) {
  const io = getIO();
  io.to('room:ward_staff').emit('ward:admission_refresh', data);
}

/**
 * Emit kitchen order.
 */
function emitKitchenOrder(data) {
  const io = getIO();
  io.to('room:kitchen_staff').emit('kitchen:new_order', data);
  io.to('room:kitchen_manager').emit('kitchen:new_order', data);
}

/**
 * Emit billing charge event.
 */
function emitBillingCharge(data) {
  const io = getIO();
  io.to('room:billing_clerk').emit('billing:new_charge', data);
}

module.exports = {
  emitQueueUpdate,
  notifyUser,
  emitStockAlert,
  emitResultReady,
  emitDashboardStats,
  emitTransportRequest,
  emitWardUpdate,
  emitWardStaffAdmission,
  emitWardStaffQueueRefresh,
  emitKitchenOrder,
  emitBillingCharge,
  emitPharmacyInventoryUpdate,
  emitFrontOfficeRegistration,
  emitNurseActivity,
  emitDoctorActivity,
  emitLaboratoryActivity,
  emitRadiologistSupervisorActivity,
};
