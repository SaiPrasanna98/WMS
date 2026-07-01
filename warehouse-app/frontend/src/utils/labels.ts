export function formatProductType(type: string): string {
  const map: Record<string, string> = {
    RAW_MATERIAL: 'Raw material',
    FINISHED_GOOD: 'Finished good',
    PACKAGING: 'Packaging',
  };
  return map[type] || type.replace(/_/g, ' ').toLowerCase();
}

export function formatTransactionType(type: string): string {
  const map: Record<string, string> = {
    RECEIVE: 'Received',
    MOVE: 'Moved',
    PICK: 'Picked',
    CONSUME: 'Consumed',
    ADJUST: 'Adjusted',
    SHIP: 'Shipped',
    QC_HOLD: 'QC hold',
    QC_RELEASE: 'QC released',
  };
  return map[type] || type.replace(/_/g, ' ').toLowerCase();
}

export function formatStatus(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'Pending',
    PASSED: 'Passed',
    FAILED: 'Failed',
    HOLD: 'On hold',
    DRAFT: 'Draft',
    PICKING: 'Picking',
    PACKED: 'Packed',
    SHIPPED: 'Shipped',
    CREATED: 'Created',
    MATERIAL_REQUESTED: 'Materials requested',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    QC_PENDING: 'Awaiting QC',
    ACTIVE: 'Active',
    DEPLETED: 'Depleted',
    NEW: 'New',
    INVENTORY_CHECK: 'Inventory check',
    CONFIRMED: 'Confirmed',
    ALLOCATED: 'Allocated',
    PACKING: 'Packing',
    READY_FOR_PICKUP: 'Ready for pickup',
  AWAITING_DISPATCH: 'Awaiting dispatch',
    IN_TRANSIT: 'In transit',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    ASSIGNED: 'Assigned',
    ARRIVED_AT_WAREHOUSE: 'At warehouse',
    PICKED_UP: 'Picked up',
    DELIVERY_FAILED: 'Failed',
    PICK: 'Pick',
    PACK: 'Pack',
    RELEASE: 'Release',
    AVAILABLE: 'Available',
    ON_ROUTE: 'On route',
    OFF_DUTY: 'Off duty',
    QUOTE: 'Quote',
    SENT: 'Sent',
    PAID: 'Paid',
    VOID: 'Void',
  };
  return map[status] || status.replace(/_/g, ' ').toLowerCase();
}

export function formatDriverStatus(status: string): string {
  return formatStatus(status);
}

export function formatLocationType(type: string): string {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}
