import { queryAll, queryOne, queryRun, sqlNow } from '../db/query';
import {
  checkOrderInventory,
  confirmOrder,
  createPickList,
  logOrderAudit,
  reserveInventoryForOrder,
  updateOrderStatus,
} from './fulfillment';
import { createQuoteInvoice } from './billing';
import { calculateOrderPromise } from './promise';
import { notifyOrderCreated } from './notifications';

export interface PipelineStep {
  id: string;
  label: string;
  status: 'done' | 'active' | 'pending' | 'blocked' | 'skipped';
  detail?: string;
}

export interface OrderPipeline {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  steps: PipelineStep[];
  inventory: { sufficient: boolean; lines: Awaited<ReturnType<typeof checkOrderInventory>>['lines'] };
  promise: {
    estimatedPickDate?: string;
    estimatedPackDate?: string;
    estimatedShipDate?: string;
    estimatedDeliveryDate?: string;
    promiseNotes?: string;
  };
  invoice: { id?: number; invoiceNumber?: string; status?: string; totalAmount?: number } | null;
  delivery: { id?: number; status?: string; driverName?: string; trackingNumber?: string } | null;
  nextAction: string;
  blockers: string[];
}

async function getQueueDelayDays(): Promise<number> {
  const openPicks = await queryOne<{ c: number }>(`
    SELECT COUNT(*) as c FROM fulfillment_tasks WHERE task_type = 'PICK' AND status IN ('PENDING', 'IN_PROGRESS')
  `);
  const openPacks = await queryOne<{ c: number }>(`
    SELECT COUNT(*) as c FROM fulfillment_tasks WHERE task_type = 'PACK' AND status IN ('PENDING', 'IN_PROGRESS')
  `);
  const busyDrivers = await queryOne<{ c: number }>(`
    SELECT COUNT(DISTINCT driver_id) as c FROM deliveries
    WHERE status IN ('ASSIGNED', 'ARRIVED_AT_WAREHOUSE', 'PICKED_UP', 'IN_TRANSIT')
  `);
  const totalDrivers = await queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM drivers WHERE is_active = 1`
  );

  let delay = Math.floor((openPicks?.c ?? 0) / 3) + Math.floor((openPacks?.c ?? 0) / 3);
  if ((totalDrivers?.c ?? 0) > 0 && (busyDrivers?.c ?? 0) >= (totalDrivers?.c ?? 0)) delay += 1;
  return delay;
}

export async function applyPromiseDates(orderId: number, priority: string): Promise<void> {
  const items = await queryAll<{ quantity_ordered: number }>(
    'SELECT quantity_ordered FROM order_items WHERE order_id = ?',
    orderId
  );
  const totalUnits = items.reduce((s, i) => s + i.quantity_ordered, 0);
  const queueDelay = await getQueueDelayDays();
  const promise = calculateOrderPromise(priority, totalUnits, items.length, queueDelay);

  await queryRun(`
    UPDATE orders SET
      estimated_pick_date = ?,
      estimated_pack_date = ?,
      estimated_ship_date = ?,
      estimated_delivery_date = ?,
      estimated_transit_days = ?,
      promise_notes = ?,
      updated_at = ${sqlNow()}
    WHERE id = ?
  `,
    promise.estimatedPickDate, promise.estimatedPackDate,
    promise.estimatedShipDate, promise.estimatedDeliveryDate,
    promise.estimatedTransitDays, promise.promiseNotes,
    orderId
  );
}

/** Runs when a new order is created — connects invoice, promise dates, and auto-confirm if stock is available. */
export async function onOrderCreated(orderId: number, userId: number): Promise<OrderPipeline> {
  const order = await queryOne<{ order_number: string; priority: string; status: string }>(
    'SELECT order_number, priority, status FROM orders WHERE id = ?',
    orderId
  );
  if (!order) throw new Error('Order not found');

  await applyPromiseDates(orderId, order.priority);
  await createQuoteInvoice(orderId, userId);

  const check = await checkOrderInventory(orderId);

  if (check.sufficient) {
    try {
      await confirmOrder(orderId, userId, false);
      await logOrderAudit(userId, orderId, 'AUTO_CONFIRMED', 'INVENTORY_CHECK', 'ALLOCATED', { reason: 'Stock available at order creation' });
    } catch {
      // confirm may fail if race condition — stay in inventory check
    }
  }

  const full = await queryOne<{ customer_id: number; order_number: string; estimated_delivery_date?: string }>(`
    SELECT o.customer_id, o.order_number, o.estimated_delivery_date FROM orders o WHERE o.id = ?
  `, orderId);
  const invoice = await queryOne<{ invoice_number: string }>(
    'SELECT invoice_number FROM invoices WHERE order_id = ?',
    orderId
  );
  if (full) {
    try {
      await notifyOrderCreated(
        full.customer_id,
        orderId,
        full.order_number,
        full.estimated_delivery_date,
        invoice?.invoice_number,
      );
    } catch {
      // notification failure must not block order creation
    }
  }

  return getOrderPipeline(orderId);
}

export async function getOrderPipeline(orderId: number): Promise<OrderPipeline> {
  const order = await queryOne<Record<string, unknown>>(`
    SELECT o.*, c.name as customer_name
    FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?
  `, orderId);

  if (!order) throw new Error('Order not found');

  const status = String(order.status);
  const check = await checkOrderInventory(orderId);

  const invoice = await queryOne<{ id: number; invoice_number: string; status: string; total_amount: number }>(`
    SELECT id, invoice_number, status, total_amount FROM invoices WHERE order_id = ?
  `, orderId);

  const delivery = await queryOne<Record<string, unknown>>(`
    SELECT d.id, d.status, d.tracking_number, d.carrier_name, u.full_name as driver_name
    FROM deliveries d
    LEFT JOIN drivers dr ON dr.id = d.driver_id
    LEFT JOIN users u ON u.id = dr.user_id
    WHERE d.order_id = ? AND d.status NOT IN ('DELIVERY_FAILED')
    ORDER BY d.id DESC LIMIT 1
  `, orderId);

  const hasReservation = await queryOne<{ c: number }>(`
    SELECT COUNT(*) as c FROM inventory_reservations WHERE order_id = ? AND status != 'RELEASED'
  `, orderId);

  const hasPickList = await queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM pick_lists WHERE order_id = ?`,
    orderId
  );
  const hasPackages = await queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM packages WHERE order_id = ?`,
    orderId
  );

  const blockers: string[] = [];
  if (!check.sufficient && !(hasReservation?.c ?? 0)) {
    blockers.push('Insufficient stock — receive inventory or use manager override on confirm');
  }
  if (Number(order.manager_override) === 1 && status === 'CONFIRMED' && !(hasReservation?.c ?? 0)) {
    blockers.push('Order confirmed without stock — click Allocate stock on Warehouse tasks');
  }

  const steps: PipelineStep[] = [
    {
      id: 'order',
      label: 'Order placed',
      status: 'done',
      detail: `Customer: ${order.customer_name}`,
    },
    {
      id: 'invoice',
      label: 'Invoice / quote',
      status: invoice ? 'done' : status === 'CANCELLED' ? 'skipped' : 'pending',
      detail: invoice ? `${invoice.invoice_number} — $${invoice.total_amount.toFixed(2)} (${invoice.status})` : undefined,
    },
    {
      id: 'inventory',
      label: 'Inventory reserved',
      status: (hasReservation?.c ?? 0) > 0 ? 'done'
        : check.sufficient && ['INVENTORY_CHECK', 'NEW'].includes(status) ? 'active'
          : status === 'CANCELLED' ? 'skipped'
            : check.sufficient ? 'pending' : 'blocked',
      detail: check.sufficient
        ? `ATP OK — ${check.lines.map(l => `${l.productName}: ${l.atp} available`).join(', ')}`
        : check.lines.map(l => `${l.productName}: need ${l.quantityOrdered}, ATP ${l.atp}`).join('; '),
    },
    {
      id: 'pick',
      label: 'Pick items',
      status: ['PICKING', 'PACKING', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED'].includes(status) ? 'done'
        : (hasPickList?.c ?? 0) > 0 ? 'active' : ['ALLOCATED'].includes(status) ? 'active' : 'pending',
    },
    {
      id: 'pack',
      label: 'Pack & label',
      status: ['READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED'].includes(status) ? 'done'
        : (hasPackages?.c ?? 0) > 0 ? 'active' : status === 'PACKING' ? 'active' : 'pending',
    },
    {
      id: 'dispatch',
      label: 'Dispatch / driver',
      status: delivery ? 'done' : status === 'READY_FOR_PICKUP' ? 'active' : 'pending',
      detail: delivery ? String(delivery.driver_name ?? delivery.carrier_name ?? 'Assigned') : undefined,
    },
    {
      id: 'deliver',
      label: 'Delivered',
      status: status === 'DELIVERED' ? 'done' : status === 'IN_TRANSIT' ? 'active' : 'pending',
      detail: delivery?.tracking_number ? `Tracking: ${delivery.carrier_name} ${delivery.tracking_number}` : undefined,
    },
  ];

  let nextAction = 'Waiting';
  if (status === 'CANCELLED') nextAction = 'Order cancelled';
  else if (['NEW', 'INVENTORY_CHECK'].includes(status) && check.sufficient) nextAction = 'Confirm order (or was auto-confirmed if stock available)';
  else if (status === 'CONFIRMED' && !(hasReservation?.c ?? 0)) nextAction = 'Allocate stock on Warehouse tasks';
  else if (status === 'ALLOCATED') nextAction = 'Start picking on Warehouse tasks';
  else if (status === 'PICKING') nextAction = 'Complete pick on Warehouse tasks';
  else if (status === 'PACKING') nextAction = 'Pack order on Warehouse tasks';
  else if (status === 'READY_FOR_PICKUP' && !delivery) nextAction = 'Assign driver on Dispatch';
  else if (status === 'READY_FOR_PICKUP' || status === 'IN_TRANSIT') nextAction = 'Complete delivery on Deliveries';
  else if (status === 'DELIVERED') nextAction = 'Complete — invoice sent';

  return {
    orderId,
    orderNumber: String(order.order_number),
    orderStatus: status,
    steps,
    inventory: check,
    promise: {
      estimatedPickDate: order.estimated_pick_date as string | undefined,
      estimatedPackDate: order.estimated_pack_date as string | undefined,
      estimatedShipDate: order.estimated_ship_date as string | undefined,
      estimatedDeliveryDate: order.estimated_delivery_date as string | undefined,
      promiseNotes: order.promise_notes as string | undefined,
    },
    invoice: invoice ?? null,
    delivery: delivery ? {
      id: delivery.id as number,
      status: delivery.status as string,
      driverName: delivery.driver_name as string | undefined,
      trackingNumber: delivery.tracking_number as string | undefined,
    } : null,
    nextAction,
    blockers,
  };
}

/** Re-run allocation for confirmed orders when stock arrives. */
export async function tryAllocateOrder(orderId: number, userId: number): Promise<void> {
  const order = await queryOne<{ status: string }>(
    'SELECT status FROM orders WHERE id = ?',
    orderId
  );
  if (!order || order.status !== 'CONFIRMED') {
    throw new Error('Only confirmed orders waiting on stock can be allocated');
  }
  const check = await checkOrderInventory(orderId);
  if (!check.sufficient) throw new Error('Still insufficient inventory');

  await reserveInventoryForOrder(orderId, userId);
  await updateOrderStatus(orderId, 'ALLOCATED');
  await createPickList(orderId);
  await logOrderAudit(userId, orderId, 'ORDER_ALLOCATED', 'CONFIRMED', 'ALLOCATED');
}
