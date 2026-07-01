import { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';
import { formatStatus } from '../utils/labels';

interface Customer { id: number; name: string; email?: string; addresses?: Array<{ id: number; line1: string; city: string; label: string }> }
interface Product { id: number; name: string; sku: string }
interface OrderRow {
  id: number; order_number: string; customer_name: string; status: string;
  priority: string; estimated_ship_date?: string; estimated_delivery_date?: string;
  created_at: string;
}

export function OrdersPage() {
  const { hasPermission, isViewer } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [drivers, setDrivers] = useState<Array<{ id: number; full_name: string; isAvailable?: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Record<string, unknown> | null>(null);
  const [inventoryCheck, setInventoryCheck] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [assignDriverId, setAssignDriverId] = useState('');
  const [form, setForm] = useState({
    customerId: '', addressId: '', priority: 'NORMAL', notes: '',
    productId: '', quantity: '',
  });
  const [editForm, setEditForm] = useState({
    priority: 'NORMAL', notes: '', addressId: '', productId: '', quantity: '',
  });
  const [customerForm, setCustomerForm] = useState({
    name: '', email: '', phone: '', line1: '', city: '', state: '', postalCode: '',
  });
  const creatingOrderRef = useRef(false);
  const createIdempotencyKeyRef = useRef('');

  const loadCustomers = () => {
    return api.get('/customers').then(res => setCustomers(res.data));
  };

  const loadOrders = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    setLoading(true);
    api.get(`/orders?${params}`)
      .then(res => setOrders(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadOrders(); }, [search, statusFilter]);

  useEffect(() => {
    if (!createOpen) return;
    createIdempotencyKeyRef.current = crypto.randomUUID();
    Promise.all([
      loadCustomers(),
      api.get('/products?type=FINISHED_GOOD'),
    ]).then(([, pRes]) => {
      setProducts(pRes.data);
    }).catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }));
  }, [createOpen]);

  const openDetail = async (id: number) => {
    try {
      const [orderRes, checkRes] = await Promise.all([
        api.get(`/orders/${id}`),
        api.get(`/orders/${id}/inventory-check`),
      ]);
      setSelectedOrder(orderRes.data);
      setInventoryCheck(checkRes.data);
      if (hasPermission('drivers.read')) {
        const dRes = await api.get('/drivers/available');
        setDrivers(dRes.data);
      }
      setDetailOpen(true);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post('/customers', {
        name: customerForm.name,
        email: customerForm.email || undefined,
        phone: customerForm.phone || undefined,
        address: {
          line1: customerForm.line1,
          city: customerForm.city,
          state: customerForm.state || undefined,
          postalCode: customerForm.postalCode || undefined,
        },
      });
      await loadCustomers();
      const detail = await api.get(`/customers/${res.data.id}`);
      setForm(f => ({ ...f, customerId: String(res.data.id), addressId: String(detail.data.addresses?.[0]?.id ?? '') }));
      setCustomerModalOpen(false);
      setCustomerForm({ name: '', email: '', phone: '', line1: '', city: '', state: '', postalCode: '' });
      setAlert({ type: 'success', message: `Customer "${res.data.name}" created` });
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingOrderRef.current) return;
    creatingOrderRef.current = true;
    setSubmitting(true);
    try {
      const res = await api.post('/orders', {
        idempotencyKey: createIdempotencyKeyRef.current,
        customerId: Number(form.customerId),
        deliveryAddressId: Number(form.addressId),
        priority: form.priority,
        notes: form.notes || undefined,
        items: [{ productId: Number(form.productId), quantity: Number(form.quantity) }],
      });
      setCreateOpen(false);
      setForm({ customerId: '', addressId: '', priority: 'NORMAL', notes: '', productId: '', quantity: '' });
      setAlert({ type: 'success', message: res.data.message ?? `Order ${res.data.orderNumber} created` });
      loadOrders();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      creatingOrderRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirm = async (managerOverride = false) => {
    if (!selectedOrder) return;
    setSubmitting(true);
    try {
      await api.post(`/orders/${selectedOrder.id}/confirm`, {
        managerOverride,
        overrideReason: managerOverride ? overrideReason : undefined,
      });
      setAlert({ type: 'success', message: 'Order confirmed' });
      openDetail(Number(selectedOrder.id));
      loadOrders();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedOrder || !window.confirm('Cancel this order? Reserved inventory will be released.')) return;
    setSubmitting(true);
    try {
      await api.post(`/orders/${selectedOrder.id}/cancel`);
      setAlert({ type: 'success', message: 'Order cancelled' });
      setDetailOpen(false);
      loadOrders();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = async () => {
    if (!selectedOrder) return;
    try {
      const [pRes, cRes] = await Promise.all([
        api.get('/products?type=FINISHED_GOOD'),
        api.get(`/customers/${selectedOrder.customer_id}`),
      ]);
      setProducts(pRes.data);
      const items = (selectedOrder.items as Array<Record<string, unknown>>) ?? [];
      const first = items[0];
      setEditForm({
        priority: String(selectedOrder.priority ?? 'NORMAL'),
        notes: String(selectedOrder.notes ?? ''),
        addressId: String(selectedOrder.delivery_address_id ?? ''),
        productId: first ? String(first.product_id) : '',
        quantity: first ? String(first.quantity_ordered) : '',
      });
      setCustomers(prev => {
        const exists = prev.find(c => c.id === cRes.data.id);
        return exists ? prev.map(c => c.id === cRes.data.id ? cRes.data : c) : [...prev, cRes.data];
      });
      setEditOpen(true);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    setSubmitting(true);
    try {
      await api.put(`/orders/${selectedOrder.id}`, {
        priority: editForm.priority,
        notes: editForm.notes || undefined,
        deliveryAddressId: Number(editForm.addressId),
        items: [{ productId: Number(editForm.productId), quantity: Number(editForm.quantity) }],
      });
      setAlert({ type: 'success', message: 'Order updated' });
      setEditOpen(false);
      openDetail(Number(selectedOrder.id));
      loadOrders();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignDriver = async () => {
    if (!selectedOrder || !assignDriverId) return;
    setSubmitting(true);
    try {
      await api.post(`/drivers/${assignDriverId}/assign-order`, { orderId: selectedOrder.id });
      setAlert({ type: 'success', message: 'Driver assigned' });
      openDetail(Number(selectedOrder.id));
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!form.customerId) return;
    api.get(`/customers/${form.customerId}`).then(res => {
      setCustomers(prev => prev.map(c => c.id === res.data.id ? res.data : c));
      const defaultAddr = res.data.addresses?.find((a: { is_default: number }) => a.is_default) ?? res.data.addresses?.[0];
      if (defaultAddr) setForm(f => ({ ...f, addressId: String(defaultAddr.id) }));
    });
  }, [form.customerId]);

  const selectedCustomer = customers.find(c => String(c.id) === form.customerId);
  const editCustomer = customers.find(c => c.id === Number(selectedOrder?.customer_id));
  const canEditOrder = selectedOrder && ['NEW', 'INVENTORY_CHECK'].includes(String(selectedOrder.status));
  const canCancelOrder = selectedOrder && !['DELIVERED', 'IN_TRANSIT', 'CANCELLED'].includes(String(selectedOrder.status));

  return (
    <div>
      <PageHeader
        title="Customer orders"
        action={hasPermission('orders.write') && !isViewer && (
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>New order</button>
        )}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search orders..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All statuses</option>
          {['NEW', 'INVENTORY_CHECK', 'CONFIRMED', 'ALLOCATED', 'PICKING', 'PACKING', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].map(s => (
            <option key={s} value={s}>{formatStatus(s)}</option>
          ))}
        </select>
      </div>

      <DataTable
        loading={loading}
        data={orders as unknown as Record<string, unknown>[]}
        onRowClick={(row) => openDetail(Number(row.id))}
        columns={[
          { key: 'order_number', label: 'Order #' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} type="order" /> },
          { key: 'priority', label: 'Priority' },
          { key: 'estimated_delivery_date', label: 'Est. delivery', render: (v) => v ? String(v) : '—' },
          {
            key: 'actions', label: 'Actions', render: (_: unknown, row: Record<string, unknown>) => (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={(e) => { e.stopPropagation(); openDetail(Number(row.id)); }}
              >
                Open
              </button>
            ),
          },
        ]}
      />

      <Modal open={createOpen} title="New customer order" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label>Customer</label>
            <div className="form-row" style={{ alignItems: 'end' }}>
              <select
                value={form.customerId}
                onChange={e => setForm({ ...form, customerId: e.target.value, addressId: '' })}
                required
                style={{ flex: 1 }}
              >
                <option value="">{customers.length === 0 ? 'No customers — add one first' : 'Select customer...'}</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {hasPermission('customers.write') && !isViewer && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setCustomerModalOpen(true)}>
                  Add customer
                </button>
              )}
            </div>
          </div>
          {selectedCustomer?.addresses && (
            <div className="form-group">
              <label>Delivery address</label>
              <select value={form.addressId} onChange={e => setForm({ ...form, addressId: e.target.value })} required>
                <option value="">Select address...</option>
                {(selectedCustomer.addresses ?? []).map(a => (
                  <option key={a.id} value={a.id}>{a.label}: {a.line1}, {a.city}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Product</label>
              <select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} required>
                <option value="">Select product...</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Quantity</label>
              <input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required />
            </div>
          </div>
          <div className="form-group">
            <label>Priority</label>
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create order'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={customerModalOpen} title="Add customer" onClose={() => setCustomerModalOpen(false)}>
        <form onSubmit={handleCreateCustomer}>
          <div className="form-group">
            <label>Company / customer name</label>
            <input value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={customerForm.email} onChange={e => setCustomerForm({ ...customerForm, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input value={customerForm.phone} onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>Street address</label>
            <input value={customerForm.line1} onChange={e => setCustomerForm({ ...customerForm, line1: e.target.value })} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>City</label>
              <input value={customerForm.city} onChange={e => setCustomerForm({ ...customerForm, city: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>State</label>
              <input value={customerForm.state} onChange={e => setCustomerForm({ ...customerForm, state: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>Postal code</label>
            <input value={customerForm.postalCode} onChange={e => setCustomerForm({ ...customerForm, postalCode: e.target.value })} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setCustomerModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Save customer'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={detailOpen} title={`Order ${selectedOrder?.order_number ?? ''}`} onClose={() => setDetailOpen(false)}>
        {selectedOrder && (
          <>
            <div className="settings-card" style={{ marginBottom: 16 }}>
              <dl className="settings-dl">
                <div className="settings-row"><dt>Customer</dt><dd>{String(selectedOrder.customer_name)}</dd></div>
                <div className="settings-row"><dt>Status</dt><dd><StatusBadge status={String(selectedOrder.status)} type="order" /></dd></div>
                <div className="settings-row"><dt>Priority</dt><dd>{formatStatus(String(selectedOrder.priority))}</dd></div>
                <div className="settings-row"><dt>Est. delivery</dt><dd>{selectedOrder.estimated_delivery_date ? String(selectedOrder.estimated_delivery_date) : '—'}</dd></div>
              </dl>
            </div>
            {(selectedOrder.items as Array<Record<string, unknown>> | undefined)?.length ? (
              <div className="settings-card" style={{ marginBottom: 16 }}>
                <h3 className="settings-card-title">Line items</h3>
                <table className="data-table compact">
                  <thead>
                    <tr><th>Product</th><th>SKU</th><th>Qty</th></tr>
                  </thead>
                  <tbody>
                    {(selectedOrder.items as Array<Record<string, unknown>>).map((item, i) => (
                      <tr key={i}>
                        <td>{String(item.product_name)}</td>
                        <td>{String(item.sku)}</td>
                        <td>{String(item.quantity_ordered)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="settings-card" style={{ marginBottom: 16 }}>
              <h3 className="settings-card-title">Fulfillment schedule</h3>
              <dl className="settings-dl">
                <div className="settings-row"><dt>Pick by</dt><dd>{String(selectedOrder.estimated_pick_date ?? '—')}</dd></div>
                <div className="settings-row"><dt>Pack by</dt><dd>{String(selectedOrder.estimated_pack_date ?? '—')}</dd></div>
                <div className="settings-row"><dt>Ship by</dt><dd>{String(selectedOrder.estimated_ship_date ?? '—')}</dd></div>
                <div className="settings-row"><dt>Deliver by</dt><dd>{String(selectedOrder.estimated_delivery_date ?? '—')}</dd></div>
                {selectedOrder.promise_notes ? (
                  <div className="settings-row"><dt>Capacity notes</dt><dd>{String(selectedOrder.promise_notes)}</dd></div>
                ) : null}
              </dl>
            </div>
            {selectedOrder.invoice ? (
              <div className="settings-card" style={{ marginBottom: 16 }}>
                <h3 className="settings-card-title">Invoice</h3>
                <p>
                  {String((selectedOrder.invoice as Record<string, unknown>).invoice_number)} —{' '}
                  <StatusBadge status={String((selectedOrder.invoice as Record<string, unknown>).status)} type="invoice" /> —{' '}
                  ${Number((selectedOrder.invoice as Record<string, unknown>).total_amount).toFixed(2)}
                </p>
              </div>
            ) : null}
            {selectedOrder.delivery ? (
              <div className="settings-card" style={{ marginBottom: 16 }}>
                <h3 className="settings-card-title">Delivery & tracking</h3>
                <dl className="settings-dl">
                  <div className="settings-row"><dt>Driver</dt><dd>{String((selectedOrder.delivery as Record<string, unknown>).driver_name ?? '—')}</dd></div>
                  <div className="settings-row"><dt>Status</dt><dd><StatusBadge status={String((selectedOrder.delivery as Record<string, unknown>).status)} type="delivery" /></dd></div>
                  {(selectedOrder.delivery as Record<string, unknown>).tracking_number ? (
                    <div className="settings-row">
                      <dt>Tracking</dt>
                      <dd>{String((selectedOrder.delivery as Record<string, unknown>).carrier_name)} {String((selectedOrder.delivery as Record<string, unknown>).tracking_number)}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
            <div className="action-buttons" style={{ marginBottom: 16 }}>
              {canEditOrder && hasPermission('orders.write') && !isViewer && (
                <button className="btn btn-outline" onClick={openEdit}>Edit order</button>
              )}
              {canCancelOrder && hasPermission('orders.write') && !isViewer && (
                <button className="btn btn-outline" disabled={submitting} onClick={handleCancel}>Cancel order</button>
              )}
            </div>
            {!canEditOrder && hasPermission('orders.write') && !isViewer && !['DELIVERED', 'CANCELLED'].includes(String(selectedOrder.status)) && (
              <p className="page-subtitle" style={{ marginBottom: 16 }}>
                This order is past confirmation — use Cancel order if you need to stop it, then create a new order with corrected details.
              </p>
            )}
            {inventoryCheck && (
              <div className="settings-card" style={{ marginBottom: 16 }}>
                <h3 className="settings-card-title">Inventory availability</h3>
                {inventoryCheck.sufficient === false && (
                  <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                    Insufficient available quantity. Receive stock or confirm with manager override.
                  </div>
                )}
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Ordered</th>
                      <th>Available</th>
                      <th>Reserved</th>
                      <th>ATP</th>
                      <th>OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inventoryCheck.lines as Array<Record<string, unknown>>).map((line, i) => (
                      <tr key={i}>
                        <td>{String(line.productName)}</td>
                        <td>{String(line.quantityOrdered)}</td>
                        <td>{String(line.available)}</td>
                        <td>{String(line.reserved)}</td>
                        <td>{String(line.atp)}</td>
                        <td>{line.sufficient ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {['INVENTORY_CHECK', 'NEW'].includes(String(selectedOrder.status)) && hasPermission('orders.confirm') && !isViewer && (
              <div className="action-buttons" style={{ marginBottom: 16 }}>
                <button className="btn btn-primary" disabled={submitting} onClick={() => handleConfirm(false)}>Confirm order</button>
                {hasPermission('orders.override') && (
                  <>
                    <input type="text" placeholder="Override reason" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className="search-input" style={{ maxWidth: 200 }} />
                    <button className="btn btn-outline" disabled={submitting} onClick={() => handleConfirm(true)}>Manager override</button>
                  </>
                )}
              </div>
            )}
            {String(selectedOrder.status) === 'READY_FOR_PICKUP' && hasPermission('deliveries.write') && !selectedOrder.delivery && (
              <div style={{ marginBottom: 16 }}>
                <p className="page-subtitle" style={{ marginBottom: 8 }}>Assign from Dispatch for carrier tracking, or quick-assign below:</p>
                <div className="form-row">
                  <select value={assignDriverId} onChange={e => setAssignDriverId(e.target.value)} className="filter-select">
                    <option value="">Available driver...</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                  <button className="btn btn-primary" disabled={!assignDriverId || submitting} onClick={handleAssignDriver}>Assign</button>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal open={editOpen} title={`Edit order ${selectedOrder?.order_number ?? ''}`} onClose={() => setEditOpen(false)}>
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          Changes are allowed before the order is confirmed. Customer cannot be changed — cancel and recreate if needed.
        </p>
        <form onSubmit={handleEdit}>
          {editCustomer?.addresses && (
            <div className="form-group">
              <label>Delivery address</label>
              <select value={editForm.addressId} onChange={e => setEditForm({ ...editForm, addressId: e.target.value })} required>
                <option value="">Select address...</option>
                {(editCustomer.addresses ?? []).map(a => (
                  <option key={a.id} value={a.id}>{a.label}: {a.line1}, {a.city}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Product</label>
              <select value={editForm.productId} onChange={e => setEditForm({ ...editForm, productId: e.target.value })} required>
                <option value="">Select product...</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Quantity</label>
              <input type="number" min="1" value={editForm.quantity} onChange={e => setEditForm({ ...editForm, quantity: e.target.value })} required />
            </div>
          </div>
          <div className="form-group">
            <label>Priority</label>
            <select value={editForm.priority} onChange={e => setEditForm({ ...editForm, priority: e.target.value })}>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={2} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setEditOpen(false)}>Close</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
