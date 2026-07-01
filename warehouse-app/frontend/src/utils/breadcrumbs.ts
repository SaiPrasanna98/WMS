import { NAV_GROUPS } from '../config/navigation';

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

const EXTRA_ROUTES: Record<string, { group: string; label: string }> = {
  '/settings': { group: 'Account', label: 'Settings' },
  '/orders': { group: 'Fulfillment', label: 'Orders' },
  '/customers': { group: 'Fulfillment', label: 'Customers' },
  '/fulfillment': { group: 'Fulfillment', label: 'Warehouse tasks' },
  '/dispatch': { group: 'Fulfillment', label: 'Dispatch' },
  '/drivers': { group: 'Fulfillment', label: 'Drivers' },
  '/deliveries': { group: 'Fulfillment', label: 'Deliveries' },
  '/invoices': { group: 'Fulfillment', label: 'Invoices' },
  '/notifications': { group: 'Fulfillment', label: 'Notifications' },
  '/purchase-orders': { group: 'Operations', label: 'Purchase orders' },
};

export function getBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const path = pathname.replace(/\/$/, '') || '/dashboard';

  for (const group of NAV_GROUPS) {
    const item = group.items.find(i => i.path === path);
    if (item) {
      return [
        { label: group.title, path: group.items[0]?.path },
        { label: item.label },
      ];
    }
  }

  const extra = EXTRA_ROUTES[path];
  if (extra) {
    return [
      { label: extra.group, path: '/settings' },
      { label: extra.label },
    ];
  }

  const segment = path.split('/').filter(Boolean).pop() ?? 'Home';
  const label = segment.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return [{ label }];
}
