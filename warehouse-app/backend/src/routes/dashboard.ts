import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { getProductInventory } from '../services/inventory';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('dashboard.read'), (_req: Request, res: Response) => {
  const totalInventory = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) as total FROM pallets WHERE status = 'ACTIVE'
  `).get() as { total: number };

  const palletsInWarehouse = db.prepare(`
    SELECT COUNT(*) as count FROM pallets WHERE status = 'ACTIVE' AND location_id IS NOT NULL
  `).get() as { count: number };

  const qcHoldItems = db.prepare(`
    SELECT COUNT(*) as count FROM lots WHERE qc_status = 'HOLD'
  `).get() as { count: number };

  const openProductionOrders = db.prepare(`
    SELECT COUNT(*) as count FROM production_orders
    WHERE status NOT IN ('COMPLETED', 'QC_PENDING')
  `).get() as { count: number };

  const pendingShipments = db.prepare(`
    SELECT COUNT(*) as count FROM shipments WHERE status != 'SHIPPED'
  `).get() as { count: number };

  const lowStockItems = db.prepare(`
    SELECT p.id, p.sku, p.name, p.reorder_level, p.unit_of_measure
    FROM products p WHERE p.is_active = 1 AND p.product_type IN ('RAW_MATERIAL', 'FINISHED_GOOD')
  `).all().filter(p => {
    const inv = getProductInventory((p as { id: number }).id);
    return inv <= (p as { reorder_level: number }).reorder_level;
  });

  const recentTransactions = db.prepare(`
    SELECT it.transaction_type, it.quantity, it.created_at, p.sku, u.full_name
    FROM inventory_transactions it
    JOIN products p ON p.id = it.product_id
    JOIN users u ON u.id = it.performed_by
    ORDER BY it.created_at DESC LIMIT 10
  `).all();

  const qcSummary = db.prepare(`
    SELECT qc_status, COUNT(*) as count FROM lots GROUP BY qc_status
  `).all();

  const shipmentSummary = db.prepare(`
    SELECT status, COUNT(*) as count FROM shipments GROUP BY status
  `).all();

  const fulfillmentMetrics = {
    ordersReceivedToday: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')`).get() as { c: number }).c,
    ordersAwaitingInventory: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status IN ('NEW', 'INVENTORY_CHECK')`).get() as { c: number }).c,
    ordersBeingPicked: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'PICKING'`).get() as { c: number }).c,
    ordersBeingPacked: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'PACKING'`).get() as { c: number }).c,
    readyForPickup: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'READY_FOR_PICKUP'`).get() as { c: number }).c,
    inTransit: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'IN_TRANSIT'`).get() as { c: number }).c,
    deliveredToday: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'DELIVERED' AND date(updated_at) = date('now')`).get() as { c: number }).c,
    delayedOrders: (db.prepare(`
      SELECT COUNT(*) as c FROM orders
      WHERE status NOT IN ('DELIVERED', 'CANCELLED') AND estimated_delivery_date < date('now')
    `).get() as { c: number }).c,
  };

  res.json({
    cards: {
      totalInventory: totalInventory.total,
      palletsInWarehouse: palletsInWarehouse.count,
      qcHoldItems: qcHoldItems.count,
      openProductionOrders: openProductionOrders.count,
      pendingShipments: pendingShipments.count,
      lowStockCount: lowStockItems.length,
      ...fulfillmentMetrics,
    },
    lowStockItems,
    recentTransactions,
    qcSummary,
    shipmentSummary,
    fulfillmentMetrics,
  });
});

export default router;
