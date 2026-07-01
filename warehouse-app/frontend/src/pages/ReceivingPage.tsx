import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { Product, WarehouseLocation } from '../types';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, Alert, Modal } from '../components/UI';
import { formatProductType } from '../utils/labels';

interface PurchaseOrder { id: number; po_number: string; supplier_name: string }
interface PoLine { id: number; product_id: number; sku: string; product_name: string; quantity_remaining: number }

export function ReceivingPage() {
  const { hasPermission, isViewer } = useAuth();
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    purchaseOrderId: '', purchaseOrderLineId: '', productId: '', quantity: '', locationId: '', lotNumber: '', palletCode: '', notes: '',
  });

  const loadData = () => {
    setLoading(true);
    Promise.all([
      api.get('/receiving'),
      api.get('/products'),
      api.get('/locations'),
      api.get('/receiving/purchase-orders'),
    ]).then(([recRes, prodRes, locRes, poRes]) => {
      setRecords(recRes.data);
      setProducts(prodRes.data.filter((p: Product) => p.is_active !== 0));
      setLocations(locRes.data);
      setPurchaseOrders(poRes.data);
    }).catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const loadPoLines = async (poId: string) => {
    if (!poId) {
      setPoLines([]);
      return;
    }
    const res = await api.get(`/receiving/purchase-orders/${poId}/lines`);
    setPoLines(res.data);
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post('/receiving', {
        purchaseOrderId: form.purchaseOrderId ? Number(form.purchaseOrderId) : undefined,
        purchaseOrderLineId: form.purchaseOrderLineId ? Number(form.purchaseOrderLineId) : undefined,
        productId: Number(form.productId),
        quantity: Number(form.quantity),
        locationId: Number(form.locationId),
        lotNumber: form.lotNumber || undefined,
        palletCode: form.palletCode || undefined,
        notes: form.notes || undefined,
      });
      setAlert({ type: 'success', message: `Received ${res.data.lotNumber} / ${res.data.palletCode}` });
      setModalOpen(false);
      setForm({ purchaseOrderId: '', purchaseOrderLineId: '', productId: '', quantity: '', locationId: '', lotNumber: '', palletCode: '', notes: '' });
      setPoLines([]);
      loadData();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const receiveLocations = locations.filter(l =>
    l.location_type === 'STORAGE' || l.location_type === 'STAGING'
  );

  const productOptions = form.purchaseOrderId && poLines.length
    ? poLines.map(l => ({ id: l.product_id, sku: l.sku, name: l.product_name, product_type: '' }))
    : products;

  return (
    <div>
      <PageHeader
        title="Receiving"
        action={hasPermission('receiving.write') && !isViewer && (
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>Receive</button>
        )}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <DataTable
        loading={loading}
        data={records}
        columns={[
          { key: 'received_at', label: 'Date', render: (v) => new Date(String(v)).toLocaleString() },
          { key: 'po_number', label: 'PO', render: (v) => v ? String(v) : '—' },
          { key: 'sku', label: 'SKU' },
          { key: 'product_name', label: 'Product' },
          { key: 'lot_number', label: 'Lot' },
          { key: 'pallet_code', label: 'Pallet' },
          { key: 'quantity_received', label: 'Qty' },
          { key: 'location_code', label: 'Location' },
          { key: 'received_by_name', label: 'Received by' },
        ]}
      />

      <Modal open={modalOpen} title="Receive inventory" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleReceive} className="form">
          <div className="form-row">
            <div className="form-group">
              <label>PO (optional)</label>
              <select
                value={form.purchaseOrderId}
                onChange={e => {
                  const poId = e.target.value;
                  setForm({ ...form, purchaseOrderId: poId, purchaseOrderLineId: '', productId: '', quantity: '' });
                  loadPoLines(poId).catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }));
                }}
              >
                <option value="">Manual</option>
                {purchaseOrders.map(po => (
                  <option key={po.id} value={po.id}>{po.po_number} — {po.supplier_name}</option>
                ))}
              </select>
            </div>
            {form.purchaseOrderId && poLines.length > 0 && (
              <div className="form-group">
                <label>PO line</label>
                <select
                  value={form.purchaseOrderLineId}
                  onChange={e => {
                    const line = poLines.find(l => String(l.id) === e.target.value);
                    setForm({
                      ...form,
                      purchaseOrderLineId: e.target.value,
                      productId: line ? String(line.product_id) : '',
                      quantity: line ? String(line.quantity_remaining) : '',
                    });
                  }}
                >
                  <option value="">Select line...</option>
                  {poLines.map(l => (
                    <option key={l.id} value={l.id}>{l.sku} — {l.quantity_remaining} remaining</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Product</label>
            <select
              value={form.productId}
              onChange={e => setForm({ ...form, productId: e.target.value })}
              required
              disabled={!!form.purchaseOrderLineId}
            >
              <option value="">Select product...</option>
              {productOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}{p.product_type ? ` (${formatProductType(p.product_type)})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Quantity</label>
              <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required min="1" />
            </div>
            <div className="form-group">
              <label>Location</label>
              <select value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })} required>
                <option value="">Select location...</option>
                {receiveLocations.map(l => (
                  <option key={l.id} value={l.id}>{l.code} ({l.location_type})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Lot</label>
              <input value={form.lotNumber} onChange={e => setForm({ ...form, lotNumber: e.target.value })} placeholder="Auto" />
            </div>
            <div className="form-group">
              <label>Pallet</label>
              <input value={form.palletCode} onChange={e => setForm({ ...form, palletCode: e.target.value })} placeholder="Auto" />
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Receive'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
