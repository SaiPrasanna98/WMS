import db from '../db';
import { createAuditLog, createInventoryTransaction } from './inventory';
import { calculateOrderPromise } from './promise';
import { applyPromiseDates } from './orderPipeline';
import { createQuoteInvoice, finalizeInvoiceOnDelivery } from './billing';
import { isDriverAvailable, refreshDriverStatus } from './dispatch';
import { notifyOrderDelivered } from './notifications';

export type OrderStatus =
  | 'NEW' | 'INVENTORY_CHECK' | 'CONFIRMED' | 'ALLOCATED' | 'PICKING' | 'PACKING'
  | 'READY_FOR_PICKUP' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

export function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const row = db.prepare(`
    SELECT MAX(CAST(SUBSTR(order_number, ? + 1) AS INTEGER)) as max_seq
    FROM orders
    WHERE order_number LIKE ?
  `).get(prefix.length, `${prefix}%`) as { max_seq: number | null };
  const next = (row.max_seq ?? 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

export function generatePackageBarcode(orderId: number): string {
  const count = db.prepare('SELECT COUNT(*) as c FROM packages WHERE order_id = ?').get(orderId) as { c: number };
  return `PKG-${orderId}-${String(count.c + 1).padStart(3, '0')}`;
}

export function getReservedQuantity(productId: number): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity_reserved), 0) as total
    FROM inventory_reservations
    WHERE product_id = ? AND status IN ('RESERVED', 'PICKED')
  `).get(productId) as { total: number };
  return row.total;
}

export function getAvailableQuantity(productId: number): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(pl.quantity), 0) as total
    FROM pallets pl
    JOIN lots l ON l.id = pl.lot_id
    WHERE pl.product_id = ? AND pl.status = 'ACTIVE' AND pl.quantity > 0
      AND l.qc_status = 'PASSED'
  `).get(productId) as { total: number };
  return row.total;
}

export function getAtpQuantity(productId: number): number {
  return Math.max(0, getAvailableQuantity(productId) - getReservedQuantity(productId));
}

function normalizePalletCode(code: string): string {
  return code.trim().toUpperCase();
}

export function getPalletAvailableQty(palletId: number): number {
  const pallet = db.prepare('SELECT quantity FROM pallets WHERE id = ?').get(palletId) as { quantity: number } | undefined;
  if (!pallet) return 0;
  const reserved = db.prepare(`
    SELECT COALESCE(SUM(quantity_reserved), 0) as total
    FROM inventory_reservations WHERE pallet_id = ? AND status IN ('RESERVED', 'PICKED')
  `).get(palletId) as { total: number };
  return Math.max(0, pallet.quantity - reserved.total);
}

export function logOrderAudit(
  userId: number,
  orderId: number,
  action: string,
  oldStatus?: string,
  newStatus?: string,
  extra?: Record<string, unknown>
): void {
  createAuditLog({
    userId,
    action: 'STATUS_CHANGE',
    entityType: 'order',
    entityId: orderId,
    oldValue: oldStatus ? { status: oldStatus, ...extra } : extra,
    newValue: { status: newStatus, event: action, ...extra },
  });
}

export function updateOrderStatus(orderId: number, status: OrderStatus): void {
  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, orderId);
}

export interface InventoryCheckLine {
  productId: number;
  sku: string;
  productName: string;
  quantityOrdered: number;
  available: number;
  reserved: number;
  atp: number;
  sufficient: boolean;
}

export function checkOrderInventory(orderId: number): { sufficient: boolean; lines: InventoryCheckLine[] } {
  const items = db.prepare(`
    SELECT oi.*, p.sku, p.name as product_name
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `).all(orderId) as Array<{
    product_id: number; quantity_ordered: number; sku: string; product_name: string;
  }>;

  const lines: InventoryCheckLine[] = items.map(item => {
    const available = getAvailableQuantity(item.product_id);
    const reserved = getReservedQuantity(item.product_id);
    const atp = Math.max(0, available - reserved);
    return {
      productId: item.product_id,
      sku: item.sku,
      productName: item.product_name,
      quantityOrdered: item.quantity_ordered,
      available,
      reserved,
      atp,
      sufficient: atp >= item.quantity_ordered,
    };
  });

  return { sufficient: lines.every(l => l.sufficient), lines };
}

export function reserveInventoryForOrder(orderId: number, userId: number): void {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId) as Array<{
    id: number; product_id: number; quantity_ordered: number;
  }>;

  const insertReservation = db.prepare(`
    INSERT INTO inventory_reservations
      (order_id, order_item_id, product_id, pallet_id, lot_id, quantity_reserved, status)
    VALUES (?, ?, ?, ?, ?, ?, 'RESERVED')
  `);

  for (const item of items) {
    let remaining = item.quantity_ordered;
    const pallets = db.prepare(`
      SELECT pl.id, pl.lot_id, pl.quantity, pl.location_id
      FROM pallets pl
      JOIN lots l ON l.id = pl.lot_id
      WHERE pl.product_id = ? AND pl.status = 'ACTIVE' AND pl.quantity > 0 AND l.qc_status = 'PASSED'
      ORDER BY pl.created_at ASC
    `).all(item.product_id) as Array<{ id: number; lot_id: number; quantity: number; location_id: number }>;

    for (const pallet of pallets) {
      if (remaining <= 0) break;
      const avail = getPalletAvailableQty(pallet.id);
      if (avail <= 0) continue;
      const toReserve = Math.min(remaining, avail);
      insertReservation.run(orderId, item.id, item.product_id, pallet.id, pallet.lot_id, toReserve);
      remaining -= toReserve;
    }

    if (remaining > 0) {
      throw new Error(`Insufficient inventory to reserve for product ${item.product_id}`);
    }

    db.prepare(`
      UPDATE order_items SET quantity_reserved = quantity_ordered WHERE id = ?
    `).run(item.id);
  }

  logOrderAudit(userId, orderId, 'INVENTORY_RESERVED', undefined, 'CONFIRMED');
}

export function createPickList(orderId: number): number {
  const existing = db.prepare('SELECT id FROM pick_lists WHERE order_id = ? AND status != ?').get(orderId, 'CANCELLED') as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db.prepare(`INSERT INTO pick_lists (order_id, status) VALUES (?, 'PENDING')`).run(orderId);
  const pickListId = Number(result.lastInsertRowid);

  const reservations = db.prepare(`
    SELECT ir.*, pl.location_id
    FROM inventory_reservations ir
    JOIN pallets pl ON pl.id = ir.pallet_id
    WHERE ir.order_id = ? AND ir.status = 'RESERVED'
  `).all(orderId) as Array<{
    order_item_id: number; pallet_id: number; lot_id: number; product_id: number;
    location_id: number; quantity_reserved: number;
  }>;

  const insertItem = db.prepare(`
    INSERT INTO pick_list_items
      (pick_list_id, order_item_id, pallet_id, lot_id, product_id, location_id, quantity_to_pick)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const r of reservations) {
    insertItem.run(pickListId, r.order_item_id, r.pallet_id, r.lot_id, r.product_id, r.location_id, r.quantity_reserved);
  }

  db.prepare(`
    INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date)
    SELECT id, 'PICK', 'PENDING', priority, date('now') FROM orders WHERE id = ?
  `).run(orderId);

  db.prepare(`
    INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date)
    SELECT id, 'PACK', 'PENDING', priority, date('now') FROM orders WHERE id = ?
  `).run(orderId);

  return pickListId;
}

export function confirmOrder(orderId: number, userId: number, managerOverride = false, overrideReason?: string): void {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as {
    id: number; status: string; priority: string;
  } | undefined;
  if (!order) throw new Error('Order not found');
  if (!['NEW', 'INVENTORY_CHECK'].includes(order.status)) {
    throw new Error('Order cannot be confirmed in current status');
  }

  const check = checkOrderInventory(orderId);
  if (!check.sufficient && !managerOverride) {
    throw new Error('Insufficient inventory. Manager override required.');
  }
  if (managerOverride && !overrideReason) {
    throw new Error('Override reason is required');
  }

  const orderItems = db.prepare('SELECT quantity_ordered FROM order_items WHERE order_id = ?').all(orderId) as Array<{
    quantity_ordered: number;
  }>;
  applyPromiseDates(orderId, order.priority);

  db.prepare(`
    UPDATE orders SET
      status = 'CONFIRMED',
      manager_override = ?,
      override_reason = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(managerOverride ? 1 : 0, overrideReason ?? null, orderId);

  const promise = calculateOrderPromise(
    order.priority,
    orderItems.reduce((s, i) => s + i.quantity_ordered, 0),
    orderItems.length
  );

  logOrderAudit(userId, orderId, 'ORDER_CONFIRMED', order.status, 'CONFIRMED', { managerOverride, promise });

  if (check.sufficient) {
    reserveInventoryForOrder(orderId, userId);
    updateOrderStatus(orderId, 'ALLOCATED');
    logOrderAudit(userId, orderId, 'ORDER_ALLOCATED', 'CONFIRMED', 'ALLOCATED');
    createPickList(orderId);
  } else if (managerOverride) {
    updateOrderStatus(orderId, 'CONFIRMED');
  } else {
    throw new Error('Insufficient inventory');
  }

  try {
    createQuoteInvoice(orderId, userId);
  } catch {
    // quote may already exist
  }
}

export function completePickItem(
  pickListItemId: number,
  pickedQty: number,
  scannedPalletCode: string,
  userId: number
): void {
  const row = db.prepare(`
    SELECT pli.*, pl.pallet_id as pallet_code, pk.order_id
    FROM pick_list_items pli
    JOIN pick_lists pk ON pk.id = pli.pick_list_id
    JOIN pallets pl ON pl.id = pli.pallet_id
    WHERE pli.id = ?
  `).get(pickListItemId) as {
    id: number; pick_list_id: number; pallet_id: number; order_item_id: number;
    product_id: number; lot_id: number; quantity_to_pick: number; quantity_picked: number;
    status: string; pallet_code: string; order_id: number;
  } | undefined;

  if (!row) throw new Error('Pick list item not found');
  if (row.status === 'PICKED') {
    throw new Error('This pick line is already completed');
  }
  const scanned = normalizePalletCode(scannedPalletCode);
  const expected = normalizePalletCode(row.pallet_code);
  if (scanned !== expected) {
    throw new Error(`Pallet scan mismatch. Expected ${row.pallet_code} (enter exactly, including leading zeros)`);
  }
  if (pickedQty <= 0 || pickedQty > row.quantity_to_pick) {
    throw new Error('Invalid picked quantity');
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE pick_list_items SET quantity_picked = ?, status = 'PICKED' WHERE id = ?
    `).run(pickedQty, pickListItemId);

    db.prepare(`
      UPDATE inventory_reservations SET status = 'PICKED', updated_at = datetime('now')
      WHERE order_item_id = ? AND pallet_id = ? AND status = 'RESERVED'
    `).run(row.order_item_id, row.pallet_id);

    db.prepare(`
      UPDATE order_items SET quantity_picked = quantity_picked + ? WHERE id = ?
    `).run(pickedQty, row.order_item_id);

    const pallet = db.prepare('SELECT quantity, location_id FROM pallets WHERE id = ?').get(row.pallet_id) as {
      quantity: number; location_id: number | null;
    };
    if (!pallet || pallet.quantity < pickedQty) {
      throw new Error('Insufficient quantity on pallet');
    }
    const newPalletQty = pallet.quantity - pickedQty;
    db.prepare(`
      UPDATE pallets SET quantity = ?, status = CASE WHEN ? = 0 THEN 'DEPLETED' ELSE status END, updated_at = datetime('now')
      WHERE id = ?
    `).run(newPalletQty, newPalletQty, row.pallet_id);

    db.prepare(`
      UPDATE lots SET quantity = CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END, updated_at = datetime('now')
      WHERE id = ?
    `).run(pickedQty, pickedQty, row.lot_id);

    createInventoryTransaction({
      transactionType: 'PICK',
      productId: row.product_id,
      lotId: row.lot_id,
      palletId: row.pallet_id,
      fromLocationId: pallet.location_id ?? undefined,
      quantity: pickedQty,
      performedBy: userId,
      referenceType: 'order',
      referenceId: row.order_id,
      notes: `Order pick for ORD item ${row.order_item_id}`,
    });

    const pending = db.prepare(`
      SELECT COUNT(*) as c FROM pick_list_items WHERE pick_list_id = ? AND status = 'PENDING'
    `).get(row.pick_list_id) as { c: number };

    if (pending.c === 0) {
      db.prepare(`UPDATE pick_lists SET status = 'COMPLETED', updated_at = datetime('now') WHERE id = ?`).run(row.pick_list_id);
      db.prepare(`
        UPDATE fulfillment_tasks SET status = 'COMPLETED', updated_at = datetime('now')
        WHERE order_id = ? AND task_type = 'PICK'
      `).run(row.order_id);
      updateOrderStatus(row.order_id, 'PACKING');
      logOrderAudit(userId, row.order_id, 'PICK_COMPLETED', 'PICKING', 'PACKING');
    }
  })();
}

export function createPackage(orderId: number, userId: number, items: Array<{ orderItemId: number; quantity: number }>): { id: number; barcode: string } {
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as { status: string } | undefined;
  if (!order || !['PACKING', 'PICKING', 'ALLOCATED'].includes(order.status)) {
    throw new Error('Order is not ready for packing');
  }

  const barcode = generatePackageBarcode(orderId);
  const result = db.prepare(`
    INSERT INTO packages (order_id, package_barcode, status, packed_by, packed_at)
    VALUES (?, ?, 'PACKED', ?, datetime('now'))
  `).run(orderId, barcode, userId);
  const packageId = Number(result.lastInsertRowid);

  const insertItem = db.prepare(`
    INSERT INTO package_items (package_id, order_item_id, product_id, quantity)
    VALUES (?, ?, (SELECT product_id FROM order_items WHERE id = ?), ?)
  `);

  for (const item of items) {
    insertItem.run(packageId, item.orderItemId, item.orderItemId, item.quantity);
    db.prepare(`UPDATE order_items SET quantity_packed = quantity_packed + ? WHERE id = ?`).run(item.quantity, item.orderItemId);
  }

  updateOrderStatus(orderId, 'PACKING');
  logOrderAudit(userId, orderId, 'PACKED', order.status, 'PACKING', { packageId, barcode });

  const orderItems = db.prepare('SELECT quantity_ordered, quantity_packed FROM order_items WHERE order_id = ?').all(orderId) as Array<{
    quantity_ordered: number; quantity_packed: number;
  }>;
  const fullyPacked = orderItems.every(i => i.quantity_packed >= i.quantity_ordered);

  if (fullyPacked) {
    db.prepare(`
      UPDATE fulfillment_tasks SET status = 'COMPLETED', updated_at = datetime('now')
      WHERE order_id = ? AND task_type = 'PACK'
    `).run(orderId);
    updateOrderStatus(orderId, 'READY_FOR_PICKUP');
    logOrderAudit(userId, orderId, 'READY_FOR_PICKUP', 'PACKING', 'READY_FOR_PICKUP');

    db.prepare(`
      INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date)
      SELECT id, 'RELEASE', 'PENDING', priority, date('now') FROM orders WHERE id = ?
    `).run(orderId);
  }

  return { id: packageId, barcode };
}

export function assignDriverToOrder(
  orderId: number,
  driverId: number,
  userId: number,
  options?: { carrierName?: string; trackingNumber?: string; deliveryMethod?: 'INTERNAL_DRIVER' | 'CARRIER' }
): number {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as {
    id: number; status: string; delivery_address_id: number; priority: string;
  } | undefined;
  if (!order) throw new Error('Order not found');
  if (order.status !== 'READY_FOR_PICKUP') {
    throw new Error('Order must be ready for pickup before driver assignment');
  }

  const deliveryMethod = options?.deliveryMethod ?? 'INTERNAL_DRIVER';
  if (deliveryMethod === 'INTERNAL_DRIVER' && !isDriverAvailable(driverId)) {
    throw new Error('Driver is not available (off duty or at capacity)');
  }

  const existingDelivery = db.prepare(`
    SELECT id FROM deliveries WHERE order_id = ? AND status NOT IN ('DELIVERY_FAILED')
  `).get(orderId);
  if (existingDelivery) throw new Error('Order already has an active delivery assignment');

  const packageCount = db.prepare(`
    SELECT COUNT(*) as c FROM packages WHERE order_id = ? AND status = 'PACKED'
  `).get(orderId) as { c: number };

  const result = db.prepare(`
    INSERT INTO deliveries (
      order_id, driver_id, status, delivery_address_id, priority, package_count,
      assigned_at, carrier_name, tracking_number, delivery_method
    )
    VALUES (?, ?, 'ASSIGNED', ?, ?, ?, datetime('now'), ?, ?, ?)
  `).run(
    orderId, driverId, order.delivery_address_id, order.priority, packageCount.c,
    options?.carrierName ?? null, options?.trackingNumber ?? null, deliveryMethod
  );

  const deliveryId = Number(result.lastInsertRowid);

  db.prepare(`
    INSERT INTO driver_assignments (driver_id, delivery_id, order_id, status)
    VALUES (?, ?, ?, 'ASSIGNED')
  `).run(driverId, deliveryId, orderId);

  refreshDriverStatus(driverId);
  logOrderAudit(userId, orderId, 'ASSIGNED_TO_DRIVER', order.status, order.status, { driverId, deliveryId });
  return deliveryId;
}

export function driverPickup(
  deliveryId: number,
  actorUserId: number,
  packageBarcodes: string[],
  releasedByUserId: number
): void {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId) as {
    id: number; order_id: number; status: string; driver_id: number;
  } | undefined;
  if (!delivery) throw new Error('Delivery not found');
  if (!['ASSIGNED', 'ARRIVED_AT_WAREHOUSE'].includes(delivery.status)) {
    throw new Error('Delivery not ready for pickup');
  }

  const assignedDriver = db.prepare('SELECT id FROM drivers WHERE id = ? AND is_active = 1').get(delivery.driver_id) as
    { id: number } | undefined;
  if (!assignedDriver) throw new Error('No driver assigned to this delivery');

  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(delivery.order_id) as { status: string };
  if (order.status !== 'READY_FOR_PICKUP') {
    throw new Error('Order packing must be completed before driver pickup');
  }

  const packages = db.prepare(`SELECT * FROM packages WHERE order_id = ? AND status = 'PACKED'`).all(delivery.order_id) as Array<{
    id: number; package_barcode: string;
  }>;
  if (!packages.length) {
    throw new Error('No packed packages found for this order');
  }

  const barcodesToScan = packageBarcodes.length
    ? packageBarcodes
    : packages.map(p => p.package_barcode);

  for (const pkg of packages) {
    if (!barcodesToScan.includes(pkg.package_barcode)) {
      throw new Error(`Missing package scan: ${pkg.package_barcode}`);
    }
    db.prepare(`UPDATE packages SET status = 'RELEASED', released_at = datetime('now') WHERE id = ?`).run(pkg.id);
  }

  db.prepare(`
    UPDATE deliveries SET status = 'PICKED_UP', picked_up_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).run(deliveryId);

  db.prepare(`UPDATE driver_assignments SET status = 'PICKED_UP' WHERE delivery_id = ?`).run(deliveryId);

  db.prepare(`
    UPDATE fulfillment_tasks SET status = 'COMPLETED', updated_at = datetime('now')
    WHERE order_id = ? AND task_type = 'RELEASE'
  `).run(delivery.order_id);

  updateOrderStatus(delivery.order_id, 'IN_TRANSIT');
  logOrderAudit(releasedByUserId, delivery.order_id, 'PICKED_UP_BY_DRIVER', 'READY_FOR_PICKUP', 'IN_TRANSIT', {
    driverId: assignedDriver.id, packageBarcodes: barcodesToScan, releasedBy: releasedByUserId, actorUserId,
  });

  refreshDriverStatus(delivery.driver_id);
}

export function completeDelivery(
  deliveryId: number,
  performedByUserId: number,
  proof: { recipientName: string; signatureData?: string; photoData?: string; notes?: string }
): void {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId) as {
    id: number; order_id: number; status: string; driver_id: number;
  } | undefined;
  if (!delivery) throw new Error('Delivery not found');
  if (!['PICKED_UP', 'IN_TRANSIT'].includes(delivery.status)) {
    throw new Error('Delivery must be in transit to complete');
  }
  if (!proof.recipientName?.trim()) {
    throw new Error('Recipient name is required for proof of delivery');
  }

  db.prepare(`
    INSERT INTO delivery_proofs (delivery_id, recipient_name, signature_data, photo_data, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(deliveryId, proof.recipientName, proof.signatureData ?? null, proof.photoData ?? null, proof.notes ?? null);

  db.prepare(`
    UPDATE deliveries SET status = 'DELIVERED', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).run(deliveryId);

  db.prepare(`UPDATE driver_assignments SET status = 'DELIVERED' WHERE delivery_id = ?`).run(deliveryId);
  db.prepare(`UPDATE packages SET status = 'DELIVERED' WHERE order_id = ?`).run(delivery.order_id);

  const reservations = db.prepare(`
    SELECT ir.* FROM inventory_reservations ir
    WHERE ir.order_id = ? AND ir.status IN ('PICKED', 'PACKED', 'RESERVED')
  `).all(delivery.order_id) as Array<{ pallet_id: number; product_id: number; lot_id: number; quantity_reserved: number }>;

  for (const r of reservations) {
    db.prepare(`UPDATE inventory_reservations SET status = 'RELEASED' WHERE pallet_id = ? AND order_id = ?`)
      .run(r.pallet_id, delivery.order_id);

    createInventoryTransaction({
      transactionType: 'SHIP',
      productId: r.product_id,
      lotId: r.lot_id,
      palletId: r.pallet_id,
      quantity: r.quantity_reserved,
      performedBy: performedByUserId,
      referenceType: 'order',
      referenceId: delivery.order_id,
      notes: 'Order delivery completed',
    });
  }

  updateOrderStatus(delivery.order_id, 'DELIVERED');
  logOrderAudit(performedByUserId, delivery.order_id, 'DELIVERED', 'IN_TRANSIT', 'DELIVERED', { deliveryId });
  finalizeInvoiceOnDelivery(delivery.order_id, performedByUserId);

  const orderRow = db.prepare('SELECT customer_id, order_number FROM orders WHERE id = ?').get(delivery.order_id) as
    { customer_id: number; order_number: string };
  const invoice = db.prepare('SELECT invoice_number FROM invoices WHERE order_id = ?').get(delivery.order_id) as
    { invoice_number: string } | undefined;
  try {
    notifyOrderDelivered(orderRow.customer_id, delivery.order_id, orderRow.order_number, invoice?.invoice_number);
  } catch {
    // non-blocking
  }

  const deliveryRow = db.prepare('SELECT driver_id FROM deliveries WHERE id = ?').get(deliveryId) as { driver_id: number };
  if (deliveryRow?.driver_id) refreshDriverStatus(deliveryRow.driver_id);
}

export function failDelivery(deliveryId: number, performedByUserId: number, notes: string): void {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId) as {
    id: number; order_id: number; driver_id: number;
  } | undefined;
  if (!delivery) throw new Error('Delivery not found');

  db.prepare(`
    UPDATE deliveries SET status = 'DELIVERY_FAILED', delivery_notes = ?, updated_at = datetime('now') WHERE id = ?
  `).run(notes, deliveryId);

  db.prepare(`UPDATE driver_assignments SET status = 'DELIVERY_FAILED' WHERE delivery_id = ?`).run(deliveryId);
  logOrderAudit(performedByUserId, delivery.order_id, 'DELIVERY_FAILED', 'IN_TRANSIT', 'IN_TRANSIT', { notes });
  if (delivery.driver_id) refreshDriverStatus(delivery.driver_id);
}
