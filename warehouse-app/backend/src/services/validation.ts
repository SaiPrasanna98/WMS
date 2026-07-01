export function assertPositiveQuantity(quantity: unknown, fieldName = 'quantity'): number {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return qty;
}

export function assertValidTransition(
  current: string,
  next: string,
  transitions: Record<string, string[]>
): void {
  const allowed = transitions[current] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid status transition from ${current} to ${next}`);
  }
}

export const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PICKING'],
  PICKING: ['PACKED'],
  PACKED: ['SHIPPED'],
};

export const PRODUCTION_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['MATERIAL_REQUESTED'],
  MATERIAL_REQUESTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED', 'QC_PENDING'],
  COMPLETED: ['QC_PENDING'],
};
