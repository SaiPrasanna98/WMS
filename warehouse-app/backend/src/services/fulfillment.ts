import { queryAll, queryOne, queryRun, sqlNow, transaction } from '../db/query';
import { createAuditLog, createInventoryTransaction } from './inventory';
import { calculateOrderPromise } from './promise';
import { applyPromiseDates } from './orderPipeline';
import { createQuoteInvoice, finalizeInvoiceOnDelivery } from './billing';
import { isDriverAvailable, refreshDriverStatus } from './dispatch';
import { notifyOrderDelivered } from './notifications';

export type OrderStatus =
  | 'NEW' | 'INVENTORY_CHECK' | 'CONFIRMED' | 'ALLOCATED' | 'PICKING' | 'PACKING'
  | 'READY_FOR_PICKUP' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

export async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const row = await queryOne<{ max_seq: number | null }>(`
    SELECT MAX(CAST(SUBSTR(order_number, ? + 1) AS INTEGER)) as max_seq
    FROM orders
    WHERE order_number LIKE ?
  `, prefix.length, `${prefix}%`);
  const next = (row?.max_seq ?? 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

export async function generatePackageBarcode(orderId: number): Promise<string> {
  const count = await queryOne<{ c: number }>(
    'SELECT COUNT(*) as c FROM packages WHERE order_id = ?',
    orderId
  );
  return `PKG-${orderId}-${String((count?.c ?? 0) + 1).padStart(3, '0')}`;
}

export async function getReservedQuantity(productId: number): Promise<number> {
  const row = await queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(quantity_reserved), 0) as total
    FROM inventory_reservations
    WHERE product_id = ? AND status IN ('RESERVED', 'PICKED')
  `, productId);
  return row?.total ?? 0;
}

export async function getAvailableQuantity(productId: number): Promise<number> {
  const row = await queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(pl.quantity), 0) as total
    FROM pallets pl
    JOIN lots l ON l.id = pl.lot_id
    WHERE pl.product_id = ? AND pl.status = 'ACTIVE' AND pl.quantity > 0
      AND l.qc_status = 'PASSED'
  `, productId);
  return row?.total ?? 0;
}

export async function getAtpQuantity(productId: number): Promise<number> {
  return Math.max(0, (await getAvailableQuantity(productId)) - (await getReservedQuantity(productId)));
}

function normalizePalletCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function getPalletAvailableQty(palletId: number): Promise<number> {
  const pallet = await queryOne<{ quantity: number }>(
    'SELECT quantity FROM pallets WHERE id = ?',
    palletId
  );
  if (!pallet) return 0;
  const reserved = await queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(quantity_reserved), 0) as total
    FROM inventory_reservations WHERE pallet_id = ? AND status IN ('RESERVED', 'PICKED')
  `, palletId);
  return Math.max(0, pallet.quantity - (reserved?.total ?? 0));
}

export async function logOrderAudit(
  userId: number,
  orderId: number,
  action: string,
  oldStatus?: string,
  newStatus?: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    userId,
    action: 'STATUS_CHANGE',
    entityType: 'order',
    entityId: orderId,
    oldValue: oldStatus ? { status: oldStatus, ...extra } : extra,
    newValue: { status: newStatus, event: action, ...extra },
  });
}

export async function updateOrderStatus(orderId: number, status: OrderStatus): Promise<void> {
  await queryRun(`UPDATE orders SET status = ?, updated_at = ${sqlNow()} WHERE id = ?`, status, orderId);
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

export async function checkOrderInventory(orderId: number): Promise<{ sufficient: boolean; lines: InventoryCheckLine[] }> {
  const items = await queryAll<{
    product_id: number; quantity_ordered: number; sku: string; product_name: string;
  }>(`
    SELECT oi.*, p.sku, p.name as product_name
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `, orderId);

  const lines: InventoryCheckLine[] = await Promise.all(items.map(async item => {
    const available = await getAvailableQuantity(item.product_id);
    const reserved = await getReservedQuantity(item.product_id);
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
  }));

  return { sufficient: lines.every(l => l.sufficient), lines };
}

export async function reserveInventoryForOrder(orderId: number, userId: number): Promise<void> {
  const items = await queryAll<{
    id: number; product_id: number; quantity_ordered: number;
  }>('SELECT * FROM order_items WHERE order_id = ?', orderId);

  for (const item of items) {
    let remaining = item.quantity_ordered;
    const pallets = await queryAll<{ id: number; lot_id: number; quantity: number; location_id: number }>(`
      SELECT pl.id, pl.lot_id, pl.quantity, pl.location_id
      FROM pallets pl
      JOIN lots l ON l.id = pl.lot_id
      WHERE pl.product_id = ? AND pl.status = 'ACTIVE' AND pl.quantity > 0 AND l.qc_status = 'PASSED'
      ORDER BY pl.created_at ASC
    `, item.product_id);

    for (const pallet of pallets) {
      if (remaining <= 0) break;
      const avail = await getPalletAvailableQty(pallet.id);
      if (avail <= 0) continue;
      const toReserve = Math.min(remaining, avail);
      await queryRun(`
        INSERT INTO inventory_reservations
          (order_id, order_item_id, product_id, pallet_id, lot_id, quantity_reserved, status)
        VALUES (?, ?, ?, ?, ?, ?, 'RESERVED')
      `, orderId, item.id, item.product_id, pallet.id, pallet.lot_id, toReserve);
      remaining -= toReserve;
    }

    if (remaining > 0) {
      throw new Error(`Insufficient inventory to reserve for product ${item.product_id}`);
    }

    await queryRun(`
      UPDATE order_items SET quantity_reserved = quantity_ordered WHERE id = ?
    `, item.id);
  }

  await logOrderAudit(userId, orderId, 'INVENTORY_RESERVED', undefined, 'CONFIRMED');
}

export async function createPickList(orderId: number): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM pick_lists WHERE order_id = ? AND status != ?',
    orderId, 'CANCELLED'
  );
  if (existing) return existing.id;

  const result = await queryRun(`INSERT INTO pick_lists (order_id, status) VALUES (?, 'PENDING')`, orderId);
  const pickListId = Number(result.lastInsertRowid);

  const reservations = await queryAll<{
    order_item_id: number; pallet_id: number; lot_id: number; product_id: number;
    location_id: number; quantity_reserved: number;
  }>(`
    SELECT ir.*, pl.location_id
    FROM inventory_reservations ir
    JOIN pallets pl ON pl.id = ir.pallet_id
    WHERE ir.order_id = ? AND ir.status = 'RESERVED'
  `, orderId);

  for (const r of reservations) {
    await queryRun(`
      INSERT INTO pick_list_items
        (pick_list_id, order_item_id, pallet_id, lot_id, product_id, location_id, quantity_to_pick)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, pickListId, r.order_item_id, r.pallet_id, r.lot_id, r.product_id, r.location_id, r.quantity_reserved);
  }

  await queryRun(`
    INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date)
    SELECT id, 'PICK', 'PENDING', priority, date('now') FROM orders WHERE id = ?
  `, orderId);

  await queryRun(`
    INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date)
    SELECT id, 'PACK', 'PENDING', priority, date('now') FROM orders WHERE id = ?
  `, orderId);

  return pickListId;
}

export async function confirmOrder(orderId: number, userId: number, managerOverride = false, overrideReason?: string): Promise<void> {
  const order = await queryOne<{ id: number; status: string; priority: string }>(
    'SELECT * FROM orders WHERE id = ?',
    orderId
  );
  if (!order) throw new Error('Order not found');
  if (!['NEW', 'INVENTORY_CHECK'].includes(order.status)) {
    throw new Error('Order cannot be confirmed in current status');
  }

  const check = await checkOrderInventory(orderId);
  if (!check.sufficient && !managerOverride) {
    throw new Error('Insufficient inventory. Manager override required.');
  }
  if (managerOverride && !overrideReason) {
    throw new Error('Override reason is required');
  }

  const orderItems = await queryAll<{ quantity_ordered: number }>(
    'SELECT quantity_ordered FROM order_items WHERE order_id = ?',
    orderId
  );
  await applyPromiseDates(orderId, order.priority);

  await queryRun(`
    UPDATE orders SET
      status = 'CONFIRMED',
      manager_override = ?,
      override_reason = ?,
      updated_at = ${sqlNow()}
    WHERE id = ?
  `, managerOverride ? 1 : 0, overrideReason ?? null, orderId);

  const promise = calculateOrderPromise(
    order.priority,
    orderItems.reduce((s, i) => s + i.quantity_ordered, 0),
    orderItems.length
  );

  await logOrderAudit(userId, orderId, 'ORDER_CONFIRMED', order.status, 'CONFIRMED', { managerOverride, promise });

  if (check.sufficient) {
    await reserveInventoryForOrder(orderId, userId);
    await updateOrderStatus(orderId, 'ALLOCATED');
    await logOrderAudit(userId, orderId, 'ORDER_ALLOCATED', 'CONFIRMED', 'ALLOCATED');
    await createPickList(orderId);
  } else if (managerOverride) {
    await updateOrderStatus(orderId, 'CONFIRMED');
  } else {
    throw new Error('Insufficient inventory');
  }

  try {
    await createQuoteInvoice(orderId, userId);
  } catch {
    // quote may already exist
  }
}

export async function completePickItem(
  pickListItemId: number,
  pickedQty: number,
  scannedPalletCode: string,
  userId: number
): Promise<void> {
  const row = await queryOne<{
    id: number; pick_list_id: number; pallet_id: number; order_item_id: number;
    product_id: number; lot_id: number; quantity_to_pick: number; quantity_picked: number;
    status: string; pallet_code: string; order_id: number;
  }>(`
    SELECT pli.*, pl.pallet_id as pallet_code, pk.order_id
    FROM pick_list_items pli
    JOIN pick_lists pk ON pk.id = pli.pick_list_id
    JOIN pallets pl ON pl.id = pli.pallet_id
    WHERE pli.id = ?
  `, pickListItemId);

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

  await transaction(async () => {
    await queryRun(`
      UPDATE pick_list_items SET quantity_picked = ?, status = 'PICKED' WHERE id = ?
    `, pickedQty, pickListItemId);

    await queryRun(`
      UPDATE inventory_reservations SET status = 'PICKED', updated_at = ${sqlNow()}
      WHERE order_item_id = ? AND pallet_id = ? AND status = 'RESERVED'
    `, row.order_item_id, row.pallet_id);

    await queryRun(`
      UPDATE order_items SET quantity_picked = quantity_picked + ? WHERE id = ?
    `, pickedQty, row.order_item_id);

    const pallet = await queryOne<{ quantity: number; location_id: number | null }>(
      'SELECT quantity, location_id FROM pallets WHERE id = ?',
      row.pallet_id
    );
    if (!pallet || pallet.quantity < pickedQty) {
      throw new Error('Insufficient quantity on pallet');
    }
    const newPalletQty = pallet.quantity - pickedQty;
    await queryRun(`
      UPDATE pallets SET quantity = ?, status = CASE WHEN ? = 0 THEN 'DEPLETED' ELSE status END, updated_at = ${sqlNow()}
      WHERE id = ?
    `, newPalletQty, newPalletQty, row.pallet_id);

    await queryRun(`
      UPDATE lots SET quantity = CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END, updated_at = ${sqlNow()}
      WHERE id = ?
    `, pickedQty, pickedQty, row.lot_id);

    await createInventoryTransaction({
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

    const pending = await queryOne<{ c: number }>(`
      SELECT COUNT(*) as c FROM pick_list_items WHERE pick_list_id = ? AND status = 'PENDING'
    `, row.pick_list_id);

    if ((pending?.c ?? 0) === 0) {
      await queryRun(`UPDATE pick_lists SET status = 'COMPLETED', updated_at = ${sqlNow()} WHERE id = ?`, row.pick_list_id);
      await queryRun(`
        UPDATE fulfillment_tasks SET status = 'COMPLETED', updated_at = ${sqlNow()}
        WHERE order_id = ? AND task_type = 'PICK'
      `, row.order_id);
      await updateOrderStatus(row.order_id, 'PACKING');
      await logOrderAudit(userId, row.order_id, 'PICK_COMPLETED', 'PICKING', 'PACKING');
    }
  });
}

export async function createPackage(
  orderId: number,
  userId: number,
  items: Array<{ orderItemId: number; quantity: number }>
): Promise<{ id: number; barcode: string }> {
  const order = await queryOne<{ status: string }>(
    'SELECT status FROM orders WHERE id = ?',
    orderId
  );
  if (!order || !['PACKING', 'PICKING', 'ALLOCATED'].includes(order.status)) {
    throw new Error('Order is not ready for packing');
  }

  const barcode = await generatePackageBarcode(orderId);
  const result = await queryRun(`
    INSERT INTO packages (order_id, package_barcode, status, packed_by, packed_at)
    VALUES (?, ?, 'PACKED', ?, ${sqlNow()})
  `, orderId, barcode, userId);
  const packageId = Number(result.lastInsertRowid);

  for (const item of items) {
    await queryRun(`
      INSERT INTO package_items (package_id, order_item_id, product_id, quantity)
      VALUES (?, ?, (SELECT product_id FROM order_items WHERE id = ?), ?)
    `, packageId, item.orderItemId, item.orderItemId, item.quantity);
    await queryRun(`UPDATE order_items SET quantity_packed = quantity_packed + ? WHERE id = ?`, item.quantity, item.orderItemId);
  }

  await updateOrderStatus(orderId, 'PACKING');
  await logOrderAudit(userId, orderId, 'PACKED', order.status, 'PACKING', { packageId, barcode });

  const orderItems = await queryAll<{ quantity_ordered: number; quantity_packed: number }>(
    'SELECT quantity_ordered, quantity_packed FROM order_items WHERE order_id = ?',
    orderId
  );
  const fullyPacked = orderItems.every(i => i.quantity_packed >= i.quantity_ordered);

  if (fullyPacked) {
    await queryRun(`
      UPDATE fulfillment_tasks SET status = 'COMPLETED', updated_at = ${sqlNow()}
      WHERE order_id = ? AND task_type = 'PACK'
    `, orderId);
    await updateOrderStatus(orderId, 'READY_FOR_PICKUP');
    await logOrderAudit(userId, orderId, 'READY_FOR_PICKUP', 'PACKING', 'READY_FOR_PICKUP');

    await queryRun(`
      INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date)
      SELECT id, 'RELEASE', 'PENDING', priority, date('now') FROM orders WHERE id = ?
    `, orderId);
  }

  return { id: packageId, barcode };
}

export async function assignDriverToOrder(
  orderId: number,
  driverId: number,
  userId: number,
  options?: { carrierName?: string; trackingNumber?: string; deliveryMethod?: 'INTERNAL_DRIVER' | 'CARRIER' }
): Promise<number> {
  const order = await queryOne<{
    id: number; status: string; delivery_address_id: number; priority: string;
  }>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'READY_FOR_PICKUP') {
    throw new Error('Order must be ready for pickup before driver assignment');
  }

  const deliveryMethod = options?.deliveryMethod ?? 'INTERNAL_DRIVER';
  if (deliveryMethod === 'INTERNAL_DRIVER' && !(await isDriverAvailable(driverId))) {
    throw new Error('Driver is not available (off duty or at capacity)');
  }

  const existingDelivery = await queryOne(
    `SELECT id FROM deliveries WHERE order_id = ? AND status NOT IN ('DELIVERY_FAILED')`,
    orderId
  );
  if (existingDelivery) throw new Error('Order already has an active delivery assignment');

  const packageCount = await queryOne<{ c: number }>(`
    SELECT COUNT(*) as c FROM packages WHERE order_id = ? AND status = 'PACKED'
  `, orderId);

  const result = await queryRun(`
    INSERT INTO deliveries (
      order_id, driver_id, status, delivery_address_id, priority, package_count,
      assigned_at, carrier_name, tracking_number, delivery_method
    )
    VALUES (?, ?, 'ASSIGNED', ?, ?, ?, ${sqlNow()}, ?, ?, ?)
  `,
    orderId, driverId, order.delivery_address_id, order.priority, packageCount?.c ?? 0,
    options?.carrierName ?? null, options?.trackingNumber ?? null, deliveryMethod
  );

  const deliveryId = Number(result.lastInsertRowid);

  await queryRun(`
    INSERT INTO driver_assignments (driver_id, delivery_id, order_id, status)
    VALUES (?, ?, ?, 'ASSIGNED')
  `, driverId, deliveryId, orderId);

  await refreshDriverStatus(driverId);
  await logOrderAudit(userId, orderId, 'ASSIGNED_TO_DRIVER', order.status, order.status, { driverId, deliveryId });
  return deliveryId;
}

export async function driverPickup(
  deliveryId: number,
  actorUserId: number,
  packageBarcodes: string[],
  releasedByUserId: number
): Promise<void> {
  const delivery = await queryOne<{
    id: number; order_id: number; status: string; driver_id: number;
  }>('SELECT * FROM deliveries WHERE id = ?', deliveryId);
  if (!delivery) throw new Error('Delivery not found');
  if (!['ASSIGNED', 'ARRIVED_AT_WAREHOUSE'].includes(delivery.status)) {
    throw new Error('Delivery not ready for pickup');
  }

  const assignedDriver = await queryOne<{ id: number }>(
    'SELECT id FROM drivers WHERE id = ? AND is_active = 1',
    delivery.driver_id
  );
  if (!assignedDriver) throw new Error('No driver assigned to this delivery');

  const order = await queryOne<{ status: string }>(
    'SELECT status FROM orders WHERE id = ?',
    delivery.order_id
  );
  if (!order || order.status !== 'READY_FOR_PICKUP') {
    throw new Error('Order packing must be completed before driver pickup');
  }

  const packages = await queryAll<{ id: number; package_barcode: string }>(
    `SELECT * FROM packages WHERE order_id = ? AND status = 'PACKED'`,
    delivery.order_id
  );
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
    await queryRun(`UPDATE packages SET status = 'RELEASED', released_at = ${sqlNow()} WHERE id = ?`, pkg.id);
  }

  await queryRun(`
    UPDATE deliveries SET status = 'PICKED_UP', picked_up_at = ${sqlNow()}, updated_at = ${sqlNow()} WHERE id = ?
  `, deliveryId);

  await queryRun(`UPDATE driver_assignments SET status = 'PICKED_UP' WHERE delivery_id = ?`, deliveryId);

  await queryRun(`
    UPDATE fulfillment_tasks SET status = 'COMPLETED', updated_at = ${sqlNow()}
    WHERE order_id = ? AND task_type = 'RELEASE'
  `, delivery.order_id);

  await updateOrderStatus(delivery.order_id, 'IN_TRANSIT');
  await logOrderAudit(releasedByUserId, delivery.order_id, 'PICKED_UP_BY_DRIVER', 'READY_FOR_PICKUP', 'IN_TRANSIT', {
    driverId: assignedDriver.id, packageBarcodes: barcodesToScan, releasedBy: releasedByUserId, actorUserId,
  });

  await refreshDriverStatus(delivery.driver_id);
}

export async function completeDelivery(
  deliveryId: number,
  performedByUserId: number,
  proof: { recipientName: string; signatureData?: string; photoData?: string; notes?: string }
): Promise<void> {
  const delivery = await queryOne<{
    id: number; order_id: number; status: string; driver_id: number;
  }>('SELECT * FROM deliveries WHERE id = ?', deliveryId);
  if (!delivery) throw new Error('Delivery not found');
  if (!['PICKED_UP', 'IN_TRANSIT'].includes(delivery.status)) {
    throw new Error('Delivery must be in transit to complete');
  }
  if (!proof.recipientName?.trim()) {
    throw new Error('Recipient name is required for proof of delivery');
  }

  await queryRun(`
    INSERT INTO delivery_proofs (delivery_id, recipient_name, signature_data, photo_data, notes)
    VALUES (?, ?, ?, ?, ?)
  `, deliveryId, proof.recipientName, proof.signatureData ?? null, proof.photoData ?? null, proof.notes ?? null);

  await queryRun(`
    UPDATE deliveries SET status = 'DELIVERED', delivered_at = ${sqlNow()}, updated_at = ${sqlNow()} WHERE id = ?
  `, deliveryId);

  await queryRun(`UPDATE driver_assignments SET status = 'DELIVERED' WHERE delivery_id = ?`, deliveryId);
  await queryRun(`UPDATE packages SET status = 'DELIVERED' WHERE order_id = ?`, delivery.order_id);

  const reservations = await queryAll<{
    pallet_id: number; product_id: number; lot_id: number; quantity_reserved: number;
  }>(`
    SELECT ir.* FROM inventory_reservations ir
    WHERE ir.order_id = ? AND ir.status IN ('PICKED', 'PACKED', 'RESERVED')
  `, delivery.order_id);

  for (const r of reservations) {
    await queryRun(`UPDATE inventory_reservations SET status = 'RELEASED' WHERE pallet_id = ? AND order_id = ?`
      , r.pallet_id, delivery.order_id);

    await createInventoryTransaction({
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

  await updateOrderStatus(delivery.order_id, 'DELIVERED');
  await logOrderAudit(performedByUserId, delivery.order_id, 'DELIVERED', 'IN_TRANSIT', 'DELIVERED', { deliveryId });
  await finalizeInvoiceOnDelivery(delivery.order_id, performedByUserId);

  const orderRow = await queryOne<{ customer_id: number; order_number: string }>(
    'SELECT customer_id, order_number FROM orders WHERE id = ?',
    delivery.order_id
  );
  const invoice = await queryOne<{ invoice_number: string }>(
    'SELECT invoice_number FROM invoices WHERE order_id = ?',
    delivery.order_id
  );
  if (orderRow) {
    try {
      await notifyOrderDelivered(orderRow.customer_id, delivery.order_id, orderRow.order_number, invoice?.invoice_number);
    } catch {
      // non-blocking
    }
  }

  const deliveryRow = await queryOne<{ driver_id: number }>(
    'SELECT driver_id FROM deliveries WHERE id = ?',
    deliveryId
  );
  if (deliveryRow?.driver_id) await refreshDriverStatus(deliveryRow.driver_id);
}

export async function failDelivery(deliveryId: number, performedByUserId: number, notes: string): Promise<void> {
  const delivery = await queryOne<{
    id: number; order_id: number; driver_id: number;
  }>('SELECT * FROM deliveries WHERE id = ?', deliveryId);
  if (!delivery) throw new Error('Delivery not found');

  await queryRun(`
    UPDATE deliveries SET status = 'DELIVERY_FAILED', delivery_notes = ?, updated_at = ${sqlNow()} WHERE id = ?
  `, notes, deliveryId);

  await queryRun(`UPDATE driver_assignments SET status = 'DELIVERY_FAILED' WHERE delivery_id = ?`, deliveryId);
  await logOrderAudit(performedByUserId, delivery.order_id, 'DELIVERY_FAILED', 'IN_TRANSIT', 'IN_TRANSIT', { notes });
  if (delivery.driver_id) await refreshDriverStatus(delivery.driver_id);
}
