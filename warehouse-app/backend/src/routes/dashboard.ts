import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { getProductInventory } from '../services/inventory';
import { queryOne, queryAll } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('dashboard.read'), async (_req: Request, res: Response) => {
  const totalInventory = await queryOne(`
    SELECT COALESCE(SUM(quantity), 0) as total FROM pallets WHERE status = 'ACTIVE'
  `) as { total: number };

  const palletsInWarehouse = await queryOne(`
    SELECT COUNT(*) as count FROM pallets WHERE status = 'ACTIVE' AND location_id IS NOT NULL
  `) as { count: number };

  const qcHoldItems = await queryOne(`
    SELECT COUNT(*) as count FROM lots WHERE qc_status = 'HOLD'
  `) as { count: number };

  const openProductionOrders = await queryOne(`
    SELECT COUNT(*) as count FROM production_orders
    WHERE status NOT IN ('COMPLETED', 'QC_PENDING')
  `) as { count: number };

  const pendingShipments = await queryOne(`
    SELECT COUNT(*) as count FROM shipments WHERE status != 'SHIPPED'
  `) as { count: number };

  const products = await queryAll(`
    SELECT p.id, p.sku, p.name, p.reorder_level, p.unit_of_measure
    FROM products p WHERE p.is_active = 1 AND p.product_type IN ('RAW_MATERIAL', 'FINISHED_GOOD')
  `) as { id: number; sku: string; name: string; reorder_level: number; unit_of_measure: string }[];

  const lowStockItems = [];
  for (const p of products) {
    const inv = await getProductInventory(p.id);
    if (inv <= p.reorder_level) lowStockItems.push(p);
  }

  const recentTransactions = await queryAll(`
    SELECT it.transaction_type, it.quantity, it.created_at, p.sku, u.full_name
    FROM inventory_transactions it
    JOIN products p ON p.id = it.product_id
    JOIN users u ON u.id = it.performed_by
    ORDER BY it.created_at DESC LIMIT 10
  `);

  const qcSummary = await queryAll(`
    SELECT qc_status, COUNT(*) as count FROM lots GROUP BY qc_status
  `);

  const shipmentSummary = await queryAll(`
    SELECT status, COUNT(*) as count FROM shipments GROUP BY status
  `);

  const fulfillmentMetrics = {
    ordersReceivedToday: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')`) as { c: number }).c,
    ordersAwaitingInventory: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status IN ('NEW', 'INVENTORY_CHECK')`) as { c: number }).c,
    ordersBeingPicked: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'PICKING'`) as { c: number }).c,
    ordersBeingPacked: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'PACKING'`) as { c: number }).c,
    readyForPickup: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'READY_FOR_PICKUP'`) as { c: number }).c,
    inTransit: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'IN_TRANSIT'`) as { c: number }).c,
    deliveredToday: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'DELIVERED' AND date(updated_at) = date('now')`) as { c: number }).c,
    delayedOrders: (await queryOne(`
      SELECT COUNT(*) as c FROM orders
      WHERE status NOT IN ('DELIVERED', 'CANCELLED') AND estimated_delivery_date < date('now')
    `) as { c: number }).c,
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
