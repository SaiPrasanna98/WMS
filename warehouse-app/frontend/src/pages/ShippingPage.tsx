import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { Product, Lot, Pallet } from '../types';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';

interface Shipment {
  id: number;
  shipment_number: string;
  customer_name: string;
  status: string;
  item_count: number;
  ship_date?: string;
  tracking_number?: string;
  created_by_name: string;
}

export function ShippingPage() {
  const { hasPermission, isViewer } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    customerName: '',
    notes: '',
    lotId: '',
    palletId: '',
    productId: '',
    quantity: '',
  });

  const loadShipments = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/shipments?${params}`)
      .then(res => setShipments(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  const loadCreateData = () => {
    Promise.all([
      api.get('/products?type=FINISHED_GOOD'),
      api.get('/lots?qcStatus=PASSED'),
      api.get('/pallets?status=ACTIVE'),
    ]).then(([prodRes, lotRes, palletRes]) => {
      setProducts(prodRes.data);
      setLots(lotRes.data);
      setPallets(palletRes.data);
    }).catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }));
  };

  useEffect(() => { loadShipments(); }, [search, statusFilter]);

  const updateStatus = async (id: number, status: string) => {
    let trackingNumber: string | undefined;
    if (status === 'SHIPPED') {
      const input = window.prompt('Enter tracking number (optional):');
      if (input === null) return;
      trackingNumber = input || undefined;
    }
    try {
      await api.patch(`/shipments/${id}/status`, { status, trackingNumber });
      setAlert({ type: 'success', message: `Shipment status updated to ${status}` });
      loadShipments();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/shipments', {
        customerName: form.customerName,
        notes: form.notes || undefined,
        items: [{
          productId: Number(form.productId),
          lotId: Number(form.lotId),
          palletId: Number(form.palletId),
          quantity: Number(form.quantity),
        }],
      });
      setAlert({ type: 'success', message: 'Shipment created successfully' });
      setCreateOpen(false);
      setForm({ customerName: '', notes: '', lotId: '', palletId: '', productId: '', quantity: '' });
      loadShipments();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const eligibleLots = lots.filter(l => !form.productId || l.product_id === Number(form.productId));
  const eligiblePallets = pallets.filter(p =>
    (!form.lotId || p.lot_id === Number(form.lotId)) &&
    (!form.productId || p.product_id === Number(form.productId)) &&
    p.qc_status === 'PASSED'
  );

  const statusFlow: Record<string, string[]> = {
    DRAFT: ['PICKING'],
    PICKING: ['PACKED'],
    PACKED: ['SHIPPED'],
  };

  return (
    <div>
      <PageHeader title="Shipping"
        action={hasPermission('shipping.write') && !isViewer && (
          <button className="btn btn-primary" onClick={() => { setCreateOpen(true); loadCreateData(); }}>Create Shipment</button>
        )}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search shipments..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PICKING">Picking</option>
          <option value="PACKED">Packed</option>
          <option value="SHIPPED">Shipped</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        data={shipments as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'shipment_number', label: 'Shipment #' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} type="shipment" /> },
          { key: 'item_count', label: 'Items' },
          { key: 'tracking_number', label: 'Tracking', render: (v) => (v ? String(v) : '-') },
          { key: 'ship_date', label: 'Ship Date', render: (v) => v ? new Date(String(v)).toLocaleDateString() : '-' },
          { key: 'created_by_name', label: 'Created By' },
          ...(hasPermission('shipping.write') && !isViewer ? [{
            key: 'actions' as const,
            label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => {
              const next = statusFlow[String(row.status)] || [];
              return (
                <div className="action-buttons">
                  {next.map(s => (
                    <button key={s} className="btn btn-sm btn-outline" onClick={() => updateStatus(row.id as number, s)}>
                      → {s}
                    </button>
                  ))}
                </div>
              );
            },
          }] : []),
        ]}
      />

      <Modal open={createOpen} title="Create Shipment" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="form">
          <div className="form-group">
            <label>Customer Name</label>
            <input value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Finished Good</label>
            <select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value, lotId: '', palletId: '' })} required>
              <option value="">Select product...</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>QC-Passed Lot</label>
            <select value={form.lotId} onChange={e => setForm({ ...form, lotId: e.target.value, palletId: '' })} required>
              <option value="">Select lot...</option>
              {eligibleLots.map(l => (
                <option key={l.id} value={l.id}>{l.lot_number} (qty: {l.quantity})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Pallet</label>
            <select value={form.palletId} onChange={e => setForm({ ...form, palletId: e.target.value })} required>
              <option value="">Select pallet...</option>
              {eligiblePallets.map(p => (
                <option key={p.id} value={p.id}>{p.pallet_id} (qty: {p.quantity})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Quantity</label>
            <input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating...' : 'Create Shipment'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
