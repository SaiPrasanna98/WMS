import { queryAll, queryOne, queryRun } from '../db/query';

const ACTIVE_DELIVERY_STATUSES = ['ASSIGNED', 'ARRIVED_AT_WAREHOUSE', 'PICKED_UP', 'IN_TRANSIT'];

export async function getDriverActiveDeliveryCount(driverId: number): Promise<number> {
  const row = await queryOne<{ c: number }>(`
    SELECT COUNT(*) as c FROM deliveries
    WHERE driver_id = ? AND status IN (${ACTIVE_DELIVERY_STATUSES.map(() => '?').join(',')})
  `, driverId, ...ACTIVE_DELIVERY_STATUSES);
  return row?.c ?? 0;
}

export async function isDriverAvailable(driverId: number): Promise<boolean> {
  const driver = await queryOne<{ status: string; max_active_deliveries: number; is_active: number }>(`
    SELECT status, max_active_deliveries, is_active FROM drivers WHERE id = ?
  `, driverId);
  if (!driver || !driver.is_active) return false;
  if (driver.status === 'OFF_DUTY') return false;
  return (await getDriverActiveDeliveryCount(driverId)) < driver.max_active_deliveries;
}

export async function refreshDriverStatus(driverId: number): Promise<void> {
  const driver = await queryOne<{ status: string; is_active: number }>(
    'SELECT status, is_active FROM drivers WHERE id = ?',
    driverId
  );
  if (!driver || !driver.is_active) return;
  if (driver.status === 'OFF_DUTY') return;

  const active = await getDriverActiveDeliveryCount(driverId);
  const newStatus = active > 0 ? 'ON_ROUTE' : 'AVAILABLE';
  await queryRun('UPDATE drivers SET status = ? WHERE id = ?', newStatus, driverId);
}

export async function listDriversWithAvailability() {
  const drivers = await queryAll<Record<string, unknown>>(`
    SELECT d.*, u.full_name, u.email
    FROM drivers d
    JOIN users u ON u.id = d.user_id
    WHERE d.is_active = 1
    ORDER BY u.full_name
  `);

  return Promise.all(drivers.map(async d => {
    const activeDeliveries = await getDriverActiveDeliveryCount(d.id as number);
    const max = d.max_active_deliveries as number;
    return {
      ...d,
      activeDeliveries,
      slotsRemaining: Math.max(0, max - activeDeliveries),
      isAvailable: d.status !== 'OFF_DUTY' && activeDeliveries < max,
    };
  }));
}

export async function getDispatchBoard() {
  const drivers = await listDriversWithAvailability();
  const unassignedOrders = await queryAll(`
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
  `);

  const activeDeliveries = await queryAll(`
    SELECT d.id, d.status, d.priority, d.package_count, d.tracking_number, d.carrier_name,
           o.order_number, c.name as customer_name, u.full_name as driver_name, d.driver_id
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN drivers dr ON dr.id = d.driver_id
    LEFT JOIN users u ON u.id = dr.user_id
    WHERE d.status IN (${ACTIVE_DELIVERY_STATUSES.map(() => '?').join(',')})
    ORDER BY d.assigned_at DESC
  `, ...ACTIVE_DELIVERY_STATUSES);

  return { drivers, unassignedOrders, activeDeliveries };
}
