import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';
import { formatStatus } from '../utils/labels';

interface PoLine {
  productId: string;
  quantity: string;
  unitCost: string;
}

export function PurchaseOrdersPage() {
  const { hasPermission, isViewer } = useAuth();
  const canWrite = hasPermission('purchase_orders.write') && !isViewer;
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [products, setProducts] = useState<Array<{ id: number; sku: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    supplierName: '', expectedDate: '', notes: '',
    lines: [{ productId: '', quantity: '', unitCost: '' }] as PoLine[],
  });

  const load = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    setLoading(true);
    Promise.all([
      api.get(`/purchase-orders?${params}`),
      api.get('/products'),
    ]).then(([poRes, prodRes]) => {
      setOrders(poRes.data);
      setProducts(prodRes.data);
    }).catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [search, statusFilter]);

  const openDetail = async (id: number) => {
    try {
      const res = await api.get(`/purchase-orders/${id}`);
      setSelected(res.data);
      setDetailOpen(true);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/purchase-orders', {
        supplierName: form.supplierName,
        expectedDate: form.expectedDate || undefined,
        notes: form.notes || undefined,
        items: form.lines.map(l => ({
          productId: Number(l.productId),
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost) || 0,
        })),
      });
      setCreateOpen(false);
      setForm({ supplierName: '', expectedDate: '', notes: '', lines: [{ productId: '', quantity: '', unitCost: '' }] });
      setAlert({ type: 'success', message: 'Purchase order created' });
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!selected || !window.confirm('Cancel this purchase order?')) return;
    try {
      await api.post(`/purchase-orders/${selected.id}/cancel`);
      setDetailOpen(false);
      setAlert({ type: 'success', message: 'Purchase order cancelled' });
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        action={canWrite && (
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>New PO</button>
        )}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search PO or supplier..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All statuses</option>
          {['OPEN', 'PARTIAL', 'RECEIVED', 'CANCELLED'].map(s => (
            <option key={s} value={s}>{formatStatus(s)}</option>
          ))}
        </select>
      </div>

      <DataTable
        loading={loading}
        data={orders}
        onRowClick={(row) => openDetail(Number(row.id))}
        columns={[
          { key: 'po_number', label: 'PO #' },
          { key: 'supplier_name', label: 'Supplier' },
          { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} type="order" /> },
          { key: 'expected_date', label: 'Expected', render: (v) => v ? String(v) : '—' },
          { key: 'items', label: 'Lines', render: (v) => String(Array.isArray(v) ? v.length : 0) },
        ]}
      />

      <Modal open={createOpen} title="New purchase order" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label>Supplier</label>
            <input value={form.supplierName} onChange={e => setForm({ ...form, supplierName: e.target.value })} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Expected date</label>
              <input type="date" value={form.expectedDate} onChange={e => setForm({ ...form, expectedDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          {form.lines.map((line, i) => (
            <div key={i} className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>{i === 0 ? 'Product' : ''}</label>
                <select
                  value={line.productId}
                  onChange={e => {
                    const lines = [...form.lines];
                    lines[i] = { ...lines[i], productId: e.target.value };
                    setForm({ ...form, lines });
                  }}
                  required
                >
                  <option value="">Select...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>{i === 0 ? 'Qty' : ''}</label>
                <input type="number" min="1" value={line.quantity} onChange={e => {
                  const lines = [...form.lines];
                  lines[i] = { ...lines[i], quantity: e.target.value };
                  setForm({ ...form, lines });
                }} required />
              </div>
              <div className="form-group">
                <label>{i === 0 ? 'Unit cost' : ''}</label>
                <input type="number" min="0" step="0.01" value={line.unitCost} onChange={e => {
                  const lines = [...form.lines];
                  lines[i] = { ...lines[i], unitCost: e.target.value };
                  setForm({ ...form, lines });
                }} />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm btn-outline"
            style={{ marginBottom: 16 }}
            onClick={() => setForm({ ...form, lines: [...form.lines, { productId: '', quantity: '', unitCost: '' }] })}
          >
            Add line
          </button>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={detailOpen} title={`PO ${selected?.po_number ?? ''}`} onClose={() => setDetailOpen(false)}>
        {selected && (
          <>
            <dl className="settings-dl" style={{ marginBottom: 16 }}>
              <div className="settings-row"><dt>Supplier</dt><dd>{String(selected.supplier_name)}</dd></div>
              <div className="settings-row"><dt>Status</dt><dd><StatusBadge status={String(selected.status)} type="order" /></dd></div>
              <div className="settings-row"><dt>Expected</dt><dd>{selected.expected_date ? String(selected.expected_date) : '—'}</dd></div>
            </dl>
            <table className="data-table compact">
              <thead>
                <tr><th>SKU</th><th>Product</th><th>Ordered</th><th>Received</th><th>Remaining</th></tr>
              </thead>
              <tbody>
                {(selected.items as Array<Record<string, unknown>>).map((item, i) => (
                  <tr key={i}>
                    <td>{String(item.sku)}</td>
                    <td>{String(item.product_name)}</td>
                    <td>{String(item.quantity_ordered)}</td>
                    <td>{String(item.quantity_received)}</td>
                    <td>{Number(item.quantity_ordered) - Number(item.quantity_received)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canWrite && ['OPEN', 'PARTIAL'].includes(String(selected.status)) && (
              <div className="form-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn btn-outline" onClick={handleCancel}>Cancel PO</button>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
