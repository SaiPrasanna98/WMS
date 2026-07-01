import db from '../db';

const ACTIVE_DELIVERY_STATUSES = ['ASSIGNED', 'ARRIVED_AT_WAREHOUSE', 'PICKED_UP', 'IN_TRANSIT'];

export function getDriverActiveDeliveryCount(driverId: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM deliveries
    WHERE driver_id = ? AND status IN (${ACTIVE_DELIVERY_STATUSES.map(() => '?').join(',')})
  `).get(driverId, ...ACTIVE_DELIVERY_STATUSES) as { c: number };
  return row.c;
}

export function isDriverAvailable(driverId: number): boolean {
  const driver = db.prepare(`
    SELECT status, max_active_deliveries, is_active FROM drivers WHERE id = ?
  `).get(driverId) as { status: string; max_active_deliveries: number; is_active: number } | undefined;
  if (!driver || !driver.is_active) return false;
  if (driver.status === 'OFF_DUTY') return false;
  return getDriverActiveDeliveryCount(driverId) < driver.max_active_deliveries;
}

export function refreshDriverStatus(driverId: number): void {
  const driver = db.prepare('SELECT status, is_active FROM drivers WHERE id = ?').get(driverId) as {
    status: string; is_active: number;
  } | undefined;
  if (!driver || !driver.is_active) return;
  if (driver.status === 'OFF_DUTY') return;

  const active = getDriverActiveDeliveryCount(driverId);
  const newStatus = active > 0 ? 'ON_ROUTE' : 'AVAILABLE';
  db.prepare('UPDATE drivers SET status = ? WHERE id = ?').run(newStatus, driverId);
}

export function listDriversWithAvailability() {
  const drivers = db.prepare(`
    SELECT d.*, u.full_name, u.email
    FROM drivers d
    JOIN users u ON u.id = d.user_id
    WHERE d.is_active = 1
    ORDER BY u.full_name
  `).all() as Array<Record<string, unknown>>;

  return drivers.map(d => {
    const activeDeliveries = getDriverActiveDeliveryCount(d.id as number);
    const max = d.max_active_deliveries as number;
    return {
      ...d,
      activeDeliveries,
      slotsRemaining: Math.max(0, max - activeDeliveries),
      isAvailable: d.status !== 'OFF_DUTY' && activeDeliveries < max,
    };
  });
}

export function getDispatchBoard() {
  const drivers = listDriversWithAvailability();
  const unassignedOrders = db.prepare(`
    SELECT o.id, o.order_number, o.priority, o.estimated_delivery_date, o.estimated_ship_date,
           c.name as customer_name, o.status
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'READY_FOR_PICKUP'
      AND NOT EXISTS (
        SELECT 1 FROM deliveries d WHERE d.order_id = o.id
          AND d.status NOT IN ('DELIVERY_FAILED')
      )
    ORDER BY CASE o.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, o.estimated_delivery_date
  `).all();

  const activeDeliveries = db.prepare(`
    SELECT d.id, d.status, d.priority, d.package_count, d.tracking_number, d.carrier_name,
           o.order_number, c.name as customer_name, u.full_name as driver_name, d.driver_id
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN drivers dr ON dr.id = d.driver_id
    LEFT JOIN users u ON u.id = dr.user_id
    WHERE d.status IN (${ACTIVE_DELIVERY_STATUSES.map(() => '?').join(',')})
    ORDER BY d.assigned_at DESC
  `).all(...ACTIVE_DELIVERY_STATUSES);

  return { drivers, unassignedOrders, activeDeliveries };
}
