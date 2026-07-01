import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';

interface Customer {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  is_active: number;
}

interface CustomerAddress {
  id: number;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
  is_default: number;
}

const emptyCustomerForm = {
  name: '', email: '', phone: '', line1: '', city: '', state: '', postalCode: '',
};

const emptyAddressForm = {
  label: 'Delivery', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'US',
};

export function CustomersPage() {
  const { hasPermission, isViewer } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [addressForm, setAddressForm] = useState(emptyAddressForm);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '' });
  const [detailLoading, setDetailLoading] = useState(false);

  const canWrite = hasPermission('customers.write') && !isViewer;

  const loadCustomers = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    setLoading(true);
    api.get(`/customers?${params}`)
      .then(res => setCustomers(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadCustomers(); }, [search]);

  const openDetail = async (customer: Customer | Record<string, unknown>) => {
    const id = Number(customer.id);
    if (!id) {
      setAlert({ type: 'error', message: 'Could not open customer — try refreshing the page.' });
      return;
    }
    setSelected({
      id,
      name: String(customer.name ?? ''),
      email: customer.email ? String(customer.email) : undefined,
      phone: customer.phone ? String(customer.phone) : undefined,
      is_active: Number(customer.is_active ?? 1),
    });
    setEditing(false);
    setEditForm({
      name: String(customer.name ?? ''),
      email: customer.email ? String(customer.email) : '',
      phone: customer.phone ? String(customer.phone) : '',
    });
    setAddresses([]);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await api.get(`/customers/${id}`);
      setSelected(res.data);
      setAddresses(res.data.addresses ?? []);
      setEditForm({
        name: res.data.name,
        email: res.data.email ?? '',
        phone: res.data.phone ?? '',
      });
    } catch (err) {
      setDetailOpen(false);
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/customers', {
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
      setAlert({ type: 'success', message: 'Customer added' });
      setCreateOpen(false);
      setCustomerForm(emptyCustomerForm);
      loadCustomers();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      await api.put(`/customers/${selected.id}`, editForm);
      setAlert({ type: 'success', message: 'Customer updated' });
      setEditing(false);
      setSelected({ ...selected, ...editForm });
      loadCustomers();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      await api.post(`/customers/${selected.id}/addresses`, addressForm);
      setAlert({ type: 'success', message: 'Address added' });
      setAddressForm(emptyAddressForm);
      const res = await api.get(`/customers/${selected.id}`);
      setAddresses(res.data.addresses ?? []);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Click any customer row to view details, edit contact info, and manage delivery addresses"
        action={canWrite && (
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>Add customer</button>
        )}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search customers..." />
      </div>

      <DataTable
        loading={loading}
        data={customers as unknown as Record<string, unknown>[]}
        emptyMessage="No customers yet. Add your first client to start taking orders."
        onRowClick={(row) => openDetail(row)}
        columns={[
          { key: 'name', label: 'Customer' },
          { key: 'email', label: 'Email', render: (v) => v ? String(v) : '—' },
          { key: 'phone', label: 'Phone', render: (v) => v ? String(v) : '—' },
          {
            key: 'actions',
            label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={(e) => { e.stopPropagation(); openDetail(row); }}
              >
                Open
              </button>
            ),
          },
        ]}
      />

      <Modal open={createOpen} title="Add customer" onClose={() => setCreateOpen(false)}>
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
            <label>Primary delivery address</label>
            <input value={customerForm.line1} onChange={e => setCustomerForm({ ...customerForm, line1: e.target.value })} required placeholder="Street address" />
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
            <button type="button" className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save customer'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={detailOpen} title={selected?.name ?? 'Customer'} onClose={() => setDetailOpen(false)}>
        {detailLoading ? (
          <p className="page-subtitle">Loading customer details...</p>
        ) : selected ? (
          <>
            {editing ? (
              <form onSubmit={handleUpdateCustomer}>
                <div className="form-group">
                  <label>Company / customer name</label>
                  <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Email</label>
                    <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
                  </div>
                </div>
                <div className="form-actions" style={{ marginBottom: 20 }}>
                  <button type="button" className="btn btn-outline" onClick={() => setEditing(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="action-buttons" style={{ marginBottom: 16 }}>
                  {canWrite && (
                    <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>Edit customer</button>
                  )}
                </div>
                <dl className="settings-dl" style={{ marginBottom: 20 }}>
                  <div className="settings-row"><dt>Email</dt><dd>{selected.email || '—'}</dd></div>
                  <div className="settings-row"><dt>Phone</dt><dd>{selected.phone || '—'}</dd></div>
                </dl>
              </>
            )}

            <h3 className="section-title">Delivery addresses</h3>
            {addresses.length === 0 ? (
              <p className="page-subtitle">No addresses on file.</p>
            ) : (
              <ul style={{ listStyle: 'none', marginBottom: 16 }}>
                {addresses.map(a => (
                  <li key={a.id} className="settings-card" style={{ marginBottom: 8, padding: 12 }}>
                    <strong>{a.label}</strong>{a.is_default ? ' (default)' : ''}<br />
                    {a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />
                    {a.city}{a.state ? `, ${a.state}` : ''} {a.postal_code ?? ''}
                  </li>
                ))}
              </ul>
            )}

            {canWrite && (
              <>
                <h3 className="section-title">Add address</h3>
                <form onSubmit={handleAddAddress}>
                  <div className="form-group">
                    <label>Label</label>
                    <input value={addressForm.label} onChange={e => setAddressForm({ ...addressForm, label: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Street</label>
                    <input value={addressForm.line1} onChange={e => setAddressForm({ ...addressForm, line1: e.target.value })} required />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>City</label>
                      <input value={addressForm.city} onChange={e => setAddressForm({ ...addressForm, city: e.target.value })} required />
                    </div>
                    <div className="form-group">
                      <label>State</label>
                      <input value={addressForm.state} onChange={e => setAddressForm({ ...addressForm, state: e.target.value })} />
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>Add address</button>
                </form>
              </>
            )}
          </>
        ) : null}
      </Modal>
    </div>
  );
}
