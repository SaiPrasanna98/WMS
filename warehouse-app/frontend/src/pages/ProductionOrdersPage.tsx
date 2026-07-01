import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { Product, Pallet } from '../types';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';

interface ProductionOrder {
  id: number;
  order_number: string;
  sku: string;
  product_name: string;
  quantity_planned: number;
  quantity_produced: number;
  status: string;
  scheduled_date?: string;
  created_by_name: string;
}

interface ProductionMaterial {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  quantity_required: number;
  quantity_consumed: number;
  status: string;
}

export function ProductionOrdersPage() {
  const { hasPermission, isViewer } = useAuth();
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [materials, setMaterials] = useState<ProductionMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [consumeOpen, setConsumeOpen] = useState<{ open: boolean; orderId: number | null }>({ open: false, orderId: null });
  const [submitting, setSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState({ productId: '', quantityPlanned: '', notes: '' });
  const [consumeForm, setConsumeForm] = useState({ materialId: '', palletId: '', quantity: '' });

  const loadOrders = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/production-orders?${params}`)
      .then(res => setOrders(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadOrders(); }, [search, statusFilter]);

  const updateStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/production-orders/${id}/status`, { status });
      setAlert({ type: 'success', message: `Order status updated to ${status}` });
      loadOrders();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const openCreate = () => {
    api.get('/products?type=FINISHED_GOOD')
      .then(res => setProducts(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }));
    setCreateOpen(true);
  };

  const openConsume = async (orderId: number) => {
    try {
      const [orderRes, palletRes] = await Promise.all([
        api.get(`/production-orders/${orderId}`),
        api.get('/pallets?status=ACTIVE'),
      ]);
      setMaterials(orderRes.data.materials || []);
      setPallets(palletRes.data);
      setConsumeOpen({ open: true, orderId });
      setConsumeForm({ materialId: '', palletId: '', quantity: '' });
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/production-orders', {
        productId: Number(createForm.productId),
        quantityPlanned: Number(createForm.quantityPlanned),
        notes: createForm.notes || undefined,
      });
      setAlert({ type: 'success', message: 'Production order created' });
      setCreateOpen(false);
      setCreateForm({ productId: '', quantityPlanned: '', notes: '' });
      loadOrders();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConsume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consumeOpen.orderId) return;
    setSubmitting(true);
    try {
      await api.post(`/production-orders/${consumeOpen.orderId}/consume`, {
        materialId: Number(consumeForm.materialId),
        palletId: Number(consumeForm.palletId),
        quantity: Number(consumeForm.quantity),
      });
      setAlert({ type: 'success', message: 'Material consumed' });
      setConsumeOpen({ open: false, orderId: null });
      loadOrders();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const statusActions: Record<string, string[]> = {
    CREATED: ['MATERIAL_REQUESTED'],
    MATERIAL_REQUESTED: ['IN_PROGRESS'],
    IN_PROGRESS: ['COMPLETED', 'QC_PENDING'],
    COMPLETED: ['QC_PENDING'],
  };

  const selectedMaterial = materials.find(m => m.id === Number(consumeForm.materialId));
  const eligiblePallets = pallets.filter(p =>
    selectedMaterial ? p.product_id === selectedMaterial.product_id && p.status === 'ACTIVE' : false
  );

  return (
    <div>
      <PageHeader
        title="Production"
        action={hasPermission('production.write') && !isViewer && (
          <button className="btn btn-primary" onClick={openCreate}>Create Order</button>
        )}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search orders..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All Statuses</option>
          <option value="CREATED">Created</option>
          <option value="MATERIAL_REQUESTED">Material Requested</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="QC_PENDING">QC Pending</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        data={orders as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'order_number', label: 'Order #' },
          { key: 'sku', label: 'SKU' },
          { key: 'product_name', label: 'Product' },
          { key: 'quantity_planned', label: 'Planned' },
          { key: 'quantity_produced', label: 'Produced' },
          { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} type="production" /> },
          { key: 'scheduled_date', label: 'Scheduled', render: (v) => v ? new Date(String(v)).toLocaleDateString() : '-' },
          ...(hasPermission('production.write') && !isViewer ? [{
            key: 'actions' as const,
            label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => {
              const nextStatuses = statusActions[String(row.status)] || [];
              return (
                <div className="action-buttons">
                  {nextStatuses.map(s => (
                    <button key={s} className="btn btn-sm btn-outline" onClick={() => updateStatus(row.id as number, s)}>
                      → {s.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              );
            },
          }] : []),
          ...(hasPermission('production.consume') && !isViewer ? [{
            key: 'consume' as const,
            label: 'Materials',
            render: (_: unknown, row: Record<string, unknown>) => (
              ['MATERIAL_REQUESTED', 'IN_PROGRESS'].includes(String(row.status)) ? (
                <button className="btn btn-sm btn-primary" onClick={() => openConsume(row.id as number)}>Consume</button>
              ) : null
            ),
          }] : []),
        ]}
      />

      <Modal open={createOpen} title="Create Production Order" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="form">
          <div className="form-group">
            <label>Finished Good</label>
            <select value={createForm.productId} onChange={e => setCreateForm({ ...createForm, productId: e.target.value })} required>
              <option value="">Select product...</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Planned Quantity</label>
            <input type="number" min="1" value={createForm.quantityPlanned} onChange={e => setCreateForm({ ...createForm, quantityPlanned: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea value={createForm.notes} onChange={e => setCreateForm({ ...createForm, notes: e.target.value })} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating...' : 'Create Order'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={consumeOpen.open} title="Consume Material" onClose={() => setConsumeOpen({ open: false, orderId: null })}>
        <form onSubmit={handleConsume} className="form">
          <div className="form-group">
            <label>Material</label>
            <select value={consumeForm.materialId} onChange={e => setConsumeForm({ ...consumeForm, materialId: e.target.value, palletId: '' })} required>
              <option value="">Select material...</option>
              {materials.map(m => (
                <option key={m.id} value={m.id}>
                  {m.sku} — {m.quantity_consumed}/{m.quantity_required} consumed
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Pallet</label>
            <select value={consumeForm.palletId} onChange={e => setConsumeForm({ ...consumeForm, palletId: e.target.value })} required>
              <option value="">Select pallet...</option>
              {eligiblePallets.map(p => (
                <option key={p.id} value={p.id}>{p.pallet_id} (qty: {p.quantity})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Quantity</label>
            <input type="number" min="1" value={consumeForm.quantity} onChange={e => setConsumeForm({ ...consumeForm, quantity: e.target.value })} required />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setConsumeOpen({ open: false, orderId: null })}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Consuming...' : 'Consume'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
