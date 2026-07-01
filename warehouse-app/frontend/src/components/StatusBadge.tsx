import { formatStatus } from '../utils/labels';

interface StatusBadgeProps {
  status: string;
  type?: 'qc' | 'shipment' | 'production' | 'order' | 'delivery' | 'driver' | 'invoice' | 'default';
}

const QC_COLORS: Record<string, string> = {
  PENDING: 'badge-warning',
  PASSED: 'badge-success',
  FAILED: 'badge-danger',
  HOLD: 'badge-hold',
};

const SHIPMENT_COLORS: Record<string, string> = {
  DRAFT: 'badge-neutral',
  PICKING: 'badge-warning',
  PACKED: 'badge-info',
  SHIPPED: 'badge-success',
};

const PRODUCTION_COLORS: Record<string, string> = {
  CREATED: 'badge-neutral',
  MATERIAL_REQUESTED: 'badge-warning',
  IN_PROGRESS: 'badge-info',
  COMPLETED: 'badge-success',
  QC_PENDING: 'badge-hold',
};

const ORDER_COLORS: Record<string, string> = {
  NEW: 'badge-neutral',
  INVENTORY_CHECK: 'badge-warning',
  CONFIRMED: 'badge-info',
  ALLOCATED: 'badge-info',
  PICKING: 'badge-warning',
  PACKING: 'badge-warning',
  READY_FOR_PICKUP: 'badge-hold',
  AWAITING_DISPATCH: 'badge-warning',
  IN_TRANSIT: 'badge-info',
  DELIVERED: 'badge-success',
  CANCELLED: 'badge-danger',
};

const DELIVERY_COLORS: Record<string, string> = {
  ASSIGNED: 'badge-neutral',
  ARRIVED_AT_WAREHOUSE: 'badge-warning',
  PICKED_UP: 'badge-info',
  IN_TRANSIT: 'badge-info',
  DELIVERED: 'badge-success',
  DELIVERY_FAILED: 'badge-danger',
};

const DRIVER_COLORS: Record<string, string> = {
  AVAILABLE: 'badge-success',
  ON_ROUTE: 'badge-warning',
  OFF_DUTY: 'badge-neutral',
};

const INVOICE_COLORS: Record<string, string> = {
  QUOTE: 'badge-warning',
  SENT: 'badge-info',
  PAID: 'badge-success',
  VOID: 'badge-danger',
};

export function StatusBadge({ status, type = 'default' }: StatusBadgeProps) {
  let colorClass = 'badge-neutral';

  if (type === 'qc') colorClass = QC_COLORS[status] || 'badge-neutral';
  else if (type === 'shipment') colorClass = SHIPMENT_COLORS[status] || 'badge-neutral';
  else if (type === 'production') colorClass = PRODUCTION_COLORS[status] || 'badge-neutral';
  else if (type === 'order') colorClass = ORDER_COLORS[status] || 'badge-neutral';
  else if (type === 'delivery') colorClass = DELIVERY_COLORS[status] || 'badge-neutral';
  else if (type === 'driver') colorClass = DRIVER_COLORS[status] || 'badge-neutral';
  else if (type === 'invoice') colorClass = INVOICE_COLORS[status] || 'badge-neutral';

  return <span className={`badge ${colorClass}`}>{formatStatus(status)}</span>;
}
