import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase } from './db';
import { seedDatabase } from './db/seed';
import { getDbDriver, pingDb } from './db/query';

import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import rolesRoutes from './routes/roles';
import productsRoutes from './routes/products';
import lotsRoutes from './routes/lots';
import palletsRoutes from './routes/pallets';
import locationsRoutes from './routes/locations';
import receivingRoutes from './routes/receiving';
import productionOrdersRoutes from './routes/productionOrders';
import qcRoutes from './routes/qc';
import shipmentsRoutes from './routes/shipments';
import inventoryRoutes from './routes/inventory';
import inventoryTransactionsRoutes from './routes/inventoryTransactions';
import auditLogsRoutes from './routes/auditLogs';
import dashboardRoutes from './routes/dashboard';
import customersRoutes from './routes/customers';
import ordersRoutes from './routes/orders';
import orderItemsRoutes from './routes/orderItems';
import fulfillmentRoutes from './routes/fulfillment';
import pickListsRoutes from './routes/pickLists';
import packagesRoutes from './routes/packages';
import driversRoutes from './routes/drivers';
import deliveriesRoutes from './routes/deliveries';
import dispatchRoutes from './routes/dispatch';
import invoicesRoutes from './routes/invoices';
import organizationRoutes from './routes/organization';
import invitationsRoutes from './routes/invitations';
import purchaseOrdersRoutes from './routes/purchaseOrders';
import notificationsRoutes from './routes/notifications';
import proofOfDeliveryRoutes from './routes/proofOfDelivery';

dotenv.config();

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  const dbOk = await pingDb();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    database: getDbDriver(),
    dbConnected: dbOk,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/invitations', invitationsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/lots', lotsRoutes);
app.use('/api/pallets', palletsRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/receiving', receivingRoutes);
app.use('/api/production-orders', productionOrdersRoutes);
app.use('/api/qc', qcRoutes);
app.use('/api/shipments', shipmentsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/inventory-transactions', inventoryTransactionsRoutes);
app.use('/api/audit-logs', auditLogsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/order-items', orderItemsRoutes);
app.use('/api/fulfillment', fulfillmentRoutes);
app.use('/api/pick-lists', pickListsRoutes);
app.use('/api/packages', packagesRoutes);
app.use('/api/drivers', driversRoutes);
app.use('/api/deliveries', deliveriesRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/proof-of-delivery', proofOfDeliveryRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start(): Promise<void> {
  await initializeDatabase();
  await seedDatabase();
  app.listen(PORT, () => {
    console.log(`Warehouse API running on http://localhost:${PORT} (${getDbDriver()})`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
