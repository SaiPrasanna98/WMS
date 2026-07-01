import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { ProductsPage } from './pages/ProductsPage';
import { LotsPage } from './pages/LotsPage';
import { PalletsPage } from './pages/PalletsPage';
import { LocationsPage } from './pages/LocationsPage';
import { ReceivingPage } from './pages/ReceivingPage';
import { ProductionOrdersPage } from './pages/ProductionOrdersPage';
import { QCPage } from './pages/QCPage';
import { ShippingPage } from './pages/ShippingPage';
import { InventoryPage } from './pages/InventoryPage';
import { InventoryTransactionsPage } from './pages/InventoryTransactionsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { OrdersPage } from './pages/OrdersPage';
import { FulfillmentPage } from './pages/FulfillmentPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { CustomersPage } from './pages/CustomersPage';
import { DriversPage } from './pages/DriversPage';
import { DispatchPage } from './pages/DispatchPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { InvoicesPage } from './pages/InvoicesPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { NotificationsPage } from './pages/NotificationsPage';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/accept-invite" element={user ? <Navigate to="/dashboard" replace /> : <AcceptInvitePage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<ProtectedRoute permission="dashboard.read"><DashboardPage /></ProtectedRoute>} />
        <Route path="inventory" element={<ProtectedRoute permission="inventory.read"><InventoryPage /></ProtectedRoute>} />
        <Route path="users" element={<ProtectedRoute permission="users.read"><UsersPage /></ProtectedRoute>} />
        <Route path="products" element={<ProtectedRoute permission="products.read"><ProductsPage /></ProtectedRoute>} />
        <Route path="lots" element={<ProtectedRoute permission="lots.read"><LotsPage /></ProtectedRoute>} />
        <Route path="pallets" element={<ProtectedRoute permission="pallets.read"><PalletsPage /></ProtectedRoute>} />
        <Route path="locations" element={<ProtectedRoute permission="locations.read"><LocationsPage /></ProtectedRoute>} />
        <Route path="receiving" element={<ProtectedRoute permission="receiving.read"><ReceivingPage /></ProtectedRoute>} />
        <Route path="production-orders" element={<ProtectedRoute permission="production.read"><ProductionOrdersPage /></ProtectedRoute>} />
        <Route path="qc" element={<ProtectedRoute permission="qc.read"><QCPage /></ProtectedRoute>} />
        <Route path="shipping" element={<ProtectedRoute permission="shipping.read"><ShippingPage /></ProtectedRoute>} />
        <Route path="inventory-transactions" element={<ProtectedRoute permission="inventory.read"><InventoryTransactionsPage /></ProtectedRoute>} />
        <Route path="audit-logs" element={<ProtectedRoute permission="audit.read"><AuditLogsPage /></ProtectedRoute>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="orders" element={<ProtectedRoute permission="orders.read"><OrdersPage /></ProtectedRoute>} />
        <Route path="customers" element={<ProtectedRoute permission="customers.read"><CustomersPage /></ProtectedRoute>} />
        <Route path="fulfillment" element={<ProtectedRoute permission="fulfillment.read"><FulfillmentPage /></ProtectedRoute>} />
        <Route path="dispatch" element={<ProtectedRoute permission="drivers.read"><DispatchPage /></ProtectedRoute>} />
        <Route path="drivers" element={<ProtectedRoute permission="drivers.read"><DriversPage /></ProtectedRoute>} />
        <Route path="deliveries" element={<ProtectedRoute permission="deliveries.read"><DeliveriesPage /></ProtectedRoute>} />
        <Route path="invoices" element={<ProtectedRoute permission="invoices.read"><InvoicesPage /></ProtectedRoute>} />
        <Route path="purchase-orders" element={<ProtectedRoute permission="purchase_orders.read"><PurchaseOrdersPage /></ProtectedRoute>} />
        <Route path="notifications" element={<ProtectedRoute permission="notifications.read"><NotificationsPage /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
