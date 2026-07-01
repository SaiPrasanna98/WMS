export interface OrderPromiseDates {
  estimatedPickDate: string;
  estimatedPackDate: string;
  estimatedShipDate: string;
  estimatedDeliveryDate: string;
  estimatedTransitDays: number;
  pickHours: number;
  packHours: number;
  promiseNotes: string;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function calculateOrderPromise(
  priority: string,
  totalUnits: number,
  lineCount: number,
  queueDelayDays = 0
): OrderPromiseDates {
  const pickHours = Math.max(2, Math.ceil(totalUnits / 50) + lineCount);
  const packHours = Math.max(1, Math.ceil(totalUnits / 80) + Math.ceil(lineCount / 2));

  const pickDays = (priority === 'URGENT' ? 0 : priority === 'HIGH' ? 0 : 1) + queueDelayDays;
  const packDays = (priority === 'URGENT' ? 0 : priority === 'HIGH' ? 1 : 1);
  const transitDays = priority === 'URGENT' ? 1 : priority === 'HIGH' ? 2 : priority === 'NORMAL' ? 3 : 4;

  const today = new Date();
  const pickDate = addDays(today, pickDays);
  const packDate = addDays(pickDate, packDays);
  const shipDate = addDays(packDate, 0);
  const deliveryDate = addDays(shipDate, transitDays);

  const queueNote = queueDelayDays > 0 ? ` · Queue +${queueDelayDays}d` : '';
  const promiseNotes = [
    `Pick ~${pickHours}h`,
    `Pack ~${packHours}h`,
    `Transit ${transitDays} day(s)`,
    priority === 'URGENT' ? 'Rush SLA' : 'Standard SLA',
  ].join(' · ') + queueNote;

  return {
    estimatedPickDate: fmt(pickDate),
    estimatedPackDate: fmt(packDate),
    estimatedShipDate: fmt(shipDate),
    estimatedDeliveryDate: fmt(deliveryDate),
    estimatedTransitDays: transitDays,
    pickHours,
    packHours,
    promiseNotes,
  };
}
