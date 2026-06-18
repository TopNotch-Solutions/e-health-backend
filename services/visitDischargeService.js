const {
  Visit, Patient, Admission, Bed, Bill,
} = require('../models');
const billingChargeService = require('./billingChargeService');
const queueService = require('./queueService');
const notificationService = require('./notificationService');

/**
 * Finalize outpatient discharge: billing for private patients, admission cleanup, visit status.
 * Returns { status, routedToBilling, queueEntry?, bill?, total_amount? }
 */
async function finalizeOutpatientDischarge({
  visitId,
  dischargeNotes,
  userId,
  facilityId,
  transaction,
}) {
  const visit = await Visit.findByPk(visitId, {
    include: [
      { association: 'patient' },
      { association: 'admission', include: [{ model: Bed, as: 'bed' }] },
    ],
    transaction,
  });

  if (!visit) {
    const err = new Error('Visit not found');
    err.statusCode = 404;
    throw err;
  }

  const resolvedFacilityId = facilityId || visit.facility_id;

  if (visit.patient?.payment_type === 'private') {
    await billingChargeService.finalizeBillForDischarge(visitId, resolvedFacilityId, transaction);
    const bill = await Bill.findOne({ where: { visit_id: visitId }, transaction });
    const totalDue = bill ? billingChargeService.money(bill.total_amount) : 0;

    if (bill && bill.status !== 'paid' && bill.status !== 'waived' && totalDue > 0) {
      const queueEntry = await queueService.pushToQueue({
        visit_id: visitId,
        department: 'billing',
        priority: 'normal',
        pushed_by: userId,
        notes: 'Private patient — settlement required before discharge',
      }, transaction);

      await visit.update({ current_department: 'billing' }, { transaction });

      notificationService.emitBillingCharge({
        facility_id: resolvedFacilityId,
        visit_id: visitId,
        patient: visit.patient,
        queueEntry,
        bill_id: bill.id,
        total_amount: totalDue,
      });

      return {
        visit_id: visitId,
        status: 'in_progress',
        routedToBilling: true,
        queueEntry,
        bill,
        total_amount: totalDue,
      };
    }
  }

  if (visit.admission) {
    await visit.admission.update({
      discharged_at: new Date(),
      discharged_by: userId,
      discharge_notes: dischargeNotes || null,
      status: 'discharged',
    }, { transaction });

    if (visit.admission.bed) {
      await visit.admission.bed.update({ status: 'available' }, { transaction });
      notificationService.emitWardUpdate({
        type: 'discharge',
        bed_id: visit.admission.bed_id,
        ward_id: visit.admission.bed.ward_id,
      });
    }
  }

  await visit.update({
    status: 'discharged',
    completed_at: new Date(),
    current_department: null,
    current_queue_position: null,
  }, { transaction });

  return {
    visit_id: visitId,
    status: 'discharged',
    routedToBilling: false,
  };
}

module.exports = {
  finalizeOutpatientDischarge,
};
