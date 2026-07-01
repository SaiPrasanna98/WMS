export interface User {
  id: number;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

export interface LoginResponse {
  token: string;
  user: User;
}

export type QcStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'HOLD';
export type ShipmentStatus = 'DRAFT' | 'PICKING' | 'PACKED' | 'SHIPPED';
export type ProductionOrderStatus = 'CREATED' | 'MATERIAL_REQUESTED' | 'IN_PROGRESS' | 'COMPLETED' | 'QC_PENDING';

export interface Product {
  id: number;
  sku: string;
  name: string;
  description?: string;
  product_type: string;
  unit_of_measure: string;
  reorder_level: number;
  currentInventory?: number;
  is_active: number;
}

export interface Lot {
  id: number;
  lot_number: string;
  product_id: number;
  quantity: number;
  qc_status: QcStatus;
  sku?: string;
  product_name?: string;
  product_type?: string;
  received_date?: string;
  expiry_date?: string;
  notes?: string;
}

export interface Pallet {
  id: number;
  pallet_id: string;
  lot_id: number;
  product_id: number;
  quantity: number;
  location_id?: number;
  status: string;
  sku?: string;
  product_name?: string;
  lot_number?: string;
  qc_status?: string;
  location_code?: string;
  zone?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
}

export interface WarehouseLocation {
  id: number;
  code: string;
  zone: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  location_type: string;
  palletCount?: number;
}

export interface DashboardData {
  cards: {
    totalInventory: number;
    palletsInWarehouse: number;
    qcHoldItems: number;
    openProductionOrders: number;
    pendingShipments: number;
    lowStockCount: number;
    ordersReceivedToday?: number;
    ordersAwaitingInventory?: number;
    ordersBeingPicked?: number;
    ordersBeingPacked?: number;
    readyForPickup?: number;
    inTransit?: number;
    deliveredToday?: number;
    delayedOrders?: number;
  };
  lowStockItems: Product[];
  recentTransactions: Array<{
    transaction_type: string;
    quantity: number;
    created_at: string;
    sku: string;
    full_name: string;
  }>;
  qcSummary: Array<{ qc_status: string; count: number }>;
  shipmentSummary: Array<{ status: string; count: number }>;
  fulfillmentMetrics?: {
    ordersReceivedToday: number;
    ordersAwaitingInventory: number;
    ordersBeingPicked: number;
    ordersBeingPacked: number;
    readyForPickup: number;
    inTransit: number;
    deliveredToday: number;
    delayedOrders: number;
  };
}
