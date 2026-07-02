import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';
import { formatStatus } from '../utils/labels';

interface FulfillmentDashboard {
  metrics: Record<string, number>;
  tasks: Array<Record<string, unknown>>;
}

interface OrderQueue {
  awaitingStock: Array<Record<string, unknown>>;
  inFulfillment: Array<Record<string, unknown>>;
}

interface PickListDetail {
  id: number;
  order_id: number;
  order_number: string;
  items: Array<Record<string, unknown>>;
}

export function FulfillmentPage() {
  const { hasPermission, isViewer } = useAuth();
  const [data, setData] = useState<FulfillmentDashboard | null>(null);
  const [queue, setQueue] = useState<OrderQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pickModal, setPickModal] = useState<{ open: boolean; pickList: PickListDetail | null }>({ open: false, pickList: null });
  const [packModal, setPackModal] = useState<{ open: boolean; orderId: number | null }>({ open: false, orderId: null });
  const [scanCode, setScanCode] = useState('');
  const [pickedQty, setPickedQty] = useState('');
  const [activePickItem, setActivePickItem] = useState<number | null>(null);
  const [expectedPallet, setExpectedPallet] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canPick = hasPermission('fulfillment.pick') && !isViewer;
  const canPack = hasPermission('fulfillment.pack') && !isViewer;
  const canAllocate = hasPermission('orders.confirm') && !isViewer;

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/fulfillment/dashboard'),
      api.get('/fulfillment/order-queue'),
    ])
      .then(([dashRes, queueRes]) => {
        setData(dashRes.data);
        setQueue(queueRes.data);
      })
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openPickList = async (orderId: number) => {
    try {
      const lists = await api.get(`/pick-lists?orderId=${orderId}`);
      if (!lists.data.length) {
        setAlert({ type: 'error', message: 'No pick list available. Allocate stock before picking.' });
        return;
      }
      const detail = await api.get(`/pick-lists/${lists.data[0].id}`);
      setPickModal({ open: true, pickList: detail.data });
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const startPicking = async (orderId: number) => {
    try {
      await api.post(`/orders/${orderId}/start-picking`);
      setAlert({ type: 'success', message: 'Picking started' });
      await openPickList(orderId);
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const tryAllocate = async (orderId: number) => {
    setSubmitting(true);
    try {
      await api.post(`/fulfillment/orders/${orderId}/try-allocate`);
      setAlert({ type: 'success', message: 'Stock allocated — you can pick now' });
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePickItem) return;
    setSubmitting(true);
    try {
      await api.post(`/fulfillment/pick/${activePickItem}`, {
        pickedQty: Number(pickedQty),
        scannedPalletCode: scanCode,
      });
      setAlert({ type: 'success', message: 'Pick confirmed' });
      setScanCode('');
      setPickedQty('');
      setActivePickItem(null);
      if (pickModal.pickList?.order_id) {
        await openPickList(pickModal.pickList.order_id);
      }
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packModal.orderId) return;
    setSubmitting(true);
    try {
      const order = await api.get(`/orders/${packModal.orderId}`);
      const items = (order.data.items as Array<Record<string, unknown>>).map(i => ({
        orderItemId: i.id,
        quantity: Number(i.quantity_ordered) - Number(i.quantity_packed || 0),
      })).filter(i => i.quantity > 0);

      const res = await api.post('/packages', { orderId: packModal.orderId, items });
      setAlert({ type: 'success', message: `Package created: ${res.data.barcode}` });
      setPackModal({ open: false, orderId: null });
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="table-loading">Loading warehouse tasks...</div>;

  const metrics = data?.metrics ?? {};
  const tasks = data?.tasks ?? [];

  return (
    <div>
      <PageHeader
        title="Warehouse tasks"
        subtitle="Pick, pack, and release orders"
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      {!canPick && !canPack && (
        <Alert type="error" message="Your account does not have permission to pick or pack orders. Contact your administrator." />
      )}

      <div className="inline-stats" style={{ marginBottom: 24 }}>
        {[
          { label: 'Being picked', value: metrics.ordersBeingPicked },
          { label: 'Being packed', value: metrics.ordersBeingPacked },
          { label: 'Ready for pickup', value: metrics.readyForPickup },
          { label: 'Awaiting stock', value: queue?.awaitingStock?.length ?? 0 },
        ].map(card => (
          <div key={card.label} className="inline-stat">
            <span className="inline-stat-value">{card.value ?? 0}</span>
            <span className="inline-stat-label">{card.label}</span>
          </div>
        ))}
      </div>

      {(queue?.awaitingStock?.length ?? 0) > 0 && (
        <>
          <h3 className="section-title">Awaiting inventory</h3>
          <p className="page-subtitle" style={{ marginBottom: 12 }}>
            These orders were confirmed (often with manager override) but stock was not reserved. Receive inventory, then click Allocate stock.
          </p>
          <DataTable
            data={queue!.awaitingStock}
            emptyMessage="None"
            columns={[
              { key: 'order_number', label: 'Order' },
              { key: 'customer_name', label: 'Customer' },
              { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} type="order" /> },
              { key: 'override_reason', label: 'Note', render: (v) => v ? String(v) : '—' },
              {
                key: 'actions', label: 'Actions',
                render: (_: unknown, row: Record<string, unknown>) => canAllocate ? (
                  <button className="btn btn-sm btn-primary" disabled={submitting} onClick={() => tryAllocate(Number(row.id))}>
                    Allocate stock
                  </button>
                ) : '—',
              },
            ]}
          />
        </>
      )}

      <h3 className="section-title">Orders in progress</h3>
      <DataTable
        data={queue?.inFulfillment ?? []}
        emptyMessage="No orders in pick/pack yet — confirm an order with available stock, or allocate above."
        columns={[
          { key: 'order_number', label: 'Order' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} type="order" /> },
          { key: 'priority', label: 'Priority' },
          { key: 'package_count', label: 'Packages' },
          {
            key: 'actions', label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => (
              <div className="action-buttons">
                {['ALLOCATED', 'PICKING'].includes(String(row.status)) && canPick && (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => startPicking(Number(row.id))}>Start pick</button>
                    <button className="btn btn-sm btn-outline" onClick={() => openPickList(Number(row.id))}>Open pick list</button>
                  </>
                )}
                {['PICKING', 'PACKING', 'ALLOCATED'].includes(String(row.status)) && canPack && (
                  <button className="btn btn-sm btn-outline" onClick={() => setPackModal({ open: true, orderId: Number(row.id) })}>Pack</button>
                )}
                {String(row.status) === 'READY_FOR_PICKUP' && (
                  <Link to="/dispatch" className="btn btn-sm btn-outline">Dispatch →</Link>
                )}
              </div>
            ),
          },
        ]}
      />

      <h3 className="section-title" style={{ marginTop: 24 }}>Task queue</h3>
      <DataTable
        data={tasks}
        emptyMessage="No open tasks — orders appear here after stock is allocated."
        columns={[
          { key: 'order_number', label: 'Order' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'task_type', label: 'Task', render: (v) => formatStatus(String(v)) },
          { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} type="default" /> },
          { key: 'priority', label: 'Priority' },
          {
            key: 'actions', label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => (
              <div className="action-buttons">
                {row.task_type === 'PICK' && canPick && (
                  <button className="btn btn-sm btn-primary" onClick={() => startPicking(Number(row.order_id))}>Pick</button>
                )}
                {row.task_type === 'PACK' && canPack && (
                  <button className="btn btn-sm btn-outline" onClick={() => setPackModal({ open: true, orderId: Number(row.order_id) })}>Pack</button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal open={pickModal.open} title={`Pick list — ${pickModal.pickList?.order_number ?? ''}`} onClose={() => setPickModal({ open: false, pickList: null })}>
        {pickModal.pickList && (
          <>
            <DataTable
              data={pickModal.pickList.items as Record<string, unknown>[]}
              columns={[
                { key: 'product_name', label: 'Product' },
                { key: 'pallet_code', label: 'Pallet' },
                { key: 'lot_number', label: 'Lot' },
                { key: 'location_code', label: 'Location' },
                { key: 'quantity_to_pick', label: 'Qty' },
                { key: 'status', label: 'Status', render: (v) => formatStatus(String(v)) },
                {
                  key: 'pick', label: '', render: (_: unknown, row: Record<string, unknown>) =>
                    row.status === 'PENDING' && canPick ? (
                      <button className="btn btn-sm btn-outline" onClick={() => {
                        setActivePickItem(Number(row.id));
                        setExpectedPallet(String(row.pallet_code ?? ''));
                        setPickedQty(String(row.quantity_to_pick));
                        setScanCode('');
                      }}>Scan</button>
                    ) : 'Done',
                },
              ]}
            />
            {activePickItem && (
              <form onSubmit={confirmPick} style={{ marginTop: 16 }}>
                {expectedPallet && (
                  <p className="page-subtitle" style={{ marginBottom: 12 }}>
                    Enter this pallet ID exactly: <strong>{expectedPallet}</strong>
                    {' '}(include leading zeros — e.g. PLT-0006, not PLT-006)
                  </p>
                )}
                <div className="form-group">
                  <label>Scan pallet barcode</label>
                  <input
                    value={scanCode}
                    onChange={e => setScanCode(e.target.value)}
                    placeholder={expectedPallet || 'PLT-0006'}
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Picked quantity</label>
                  <input type="number" value={pickedQty} onChange={e => setPickedQty(e.target.value)} required />
                </div>
                <button type="submit" className="btn btn-primary" disabled={submitting}>Confirm pick</button>
              </form>
            )}
          </>
        )}
      </Modal>

      <Modal open={packModal.open} title="Pack order" onClose={() => setPackModal({ open: false, orderId: null })}>
        <p className="page-subtitle">Creates a package barcode when all items are picked.</p>
        <form onSubmit={handlePack}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Packing...' : 'Create package'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
