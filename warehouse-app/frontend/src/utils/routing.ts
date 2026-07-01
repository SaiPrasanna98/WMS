import { NAV_ITEMS } from '../config/navigation';

export function getDefaultRoute(permissions: string[]): string {
  if (permissions.includes('deliveries.proof') && !permissions.includes('orders.read')) {
    return '/deliveries';
  }
  if (permissions.includes('fulfillment.pick') && !permissions.includes('orders.read')) {
    return '/fulfillment';
  }
  const item = NAV_ITEMS.find(i => permissions.includes(i.permission));
  return item?.path ?? '/dashboard';
}
