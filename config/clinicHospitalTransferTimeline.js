'use strict';

const TIMELINE_STEPS = [
  {
    key: 'planned',
    label: 'Sent to Booking Room',
    atField: 'planned_at',
    byAssoc: 'plannedBy',
    fallbackAtField: 'created_at',
  },
  {
    key: 'initiated',
    label: 'Transport initiated by Booking Room',
    atField: 'initiated_at',
    byAssoc: 'initiatedBy',
  },
  {
    key: 'external_pickup',
    label: 'External porter picked up patient',
    atField: 'external_picked_up_at',
    byAssoc: 'externalPickedUpBy',
  },
  {
    key: 'departed_clinic',
    label: 'Departed clinic (Booking Room confirmed)',
    atField: 'departure_confirmed_at',
    byAssoc: 'departureConfirmedBy',
  },
  {
    key: 'arrived_hospital',
    label: 'Arrived at state hospital',
    atField: 'arrived_hospital_at',
    byAssoc: null,
  },
  {
    key: 'internal_pickup',
    label: 'Internal porter picked up patient',
    atField: 'internal_picked_up_at',
    byAssoc: 'internalPickedUpBy',
  },
  {
    key: 'delivered',
    label: 'Delivered to destination department',
    atField: 'delivered_to_department_at',
    byAssoc: null,
  },
  {
    key: 'received',
    label: 'Received by department nurse',
    atField: 'received_at',
    byAssoc: 'receivedBy',
  },
];

function formatActor(user) {
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || null;
}

function buildTransferTimeline(transfer) {
  if (!transfer) return [];

  const plain = transfer.toJSON ? transfer.toJSON() : transfer;

  return TIMELINE_STEPS.map((step) => {
    const at = plain[step.atField]
      || (step.fallbackAtField ? plain[step.fallbackAtField] : null);
    const actor = step.byAssoc ? formatActor(plain[step.byAssoc]) : null;

    return {
      key: step.key,
      label: step.label,
      at: at || null,
      completed: Boolean(at),
      actor,
    };
  });
}

module.exports = {
  TIMELINE_STEPS,
  buildTransferTimeline,
};
