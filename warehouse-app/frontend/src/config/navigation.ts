export interface NavItem {
  path: string;
  label: string;
  permission: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { path: '/dashboard', label: 'Dashboard', permission: 'dashboard.read' },
      { path: '/inventory', label: 'Inventory', permission: 'inventory.read' },
    ],
  },
  {
    title: 'Fulfillment',
    items: [
      { path: '/customers', label: 'Customers', permission: 'customers.read' },
      { path: '/orders', label: 'Orders', permission: 'orders.read' },
      { path: '/fulfillment', label: 'Warehouse tasks', permission: 'fulfillment.read' },
      { path: '/dispatch', label: 'Dispatch', permission: 'drivers.read' },
      { path: '/drivers', label: 'Drivers', permission: 'drivers.read' },
      { path: '/deliveries', label: 'Deliveries', permission: 'deliveries.read' },
      { path: '/invoices', label: 'Invoices', permission: 'invoices.read' },
      { path: '/notifications', label: 'Notifications', permission: 'notifications.read' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { path: '/receiving', label: 'Receiving', permission: 'receiving.read' },
      { path: '/purchase-orders', label: 'Purchase orders', permission: 'purchase_orders.read' },
      { path: '/pallets', label: 'Pallets', permission: 'pallets.read' },
      { path: '/locations', label: 'Locations', permission: 'locations.read' },
      { path: '/production-orders', label: 'Production', permission: 'production.read' },
      { path: '/qc', label: 'Quality', permission: 'qc.read' },
      { path: '/shipping', label: 'Shipping', permission: 'shipping.read' },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { path: '/products', label: 'Products', permission: 'products.read' },
      { path: '/lots', label: 'Lots', permission: 'lots.read' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { path: '/inventory-transactions', label: 'Movement history', permission: 'inventory.read' },
      { path: '/audit-logs', label: 'Audit trail', permission: 'audit.read' },
      { path: '/users', label: 'Users & roles', permission: 'users.read' },
    ],
  },
];

/** Flat list for default-route resolution */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);
