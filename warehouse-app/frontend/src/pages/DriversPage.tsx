import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';
import { formatDriverStatus } from '../utils/labels';

interface DriverRow {
  id: number;
  full_name: string;
  email: string;
  phone?: string;
  license_number?: string;
  vehicle_info?: string;
  status: string;
  activeDeliveries: number;
  slotsRemaining: number;
  max_active_deliveries: number;
  isAvailable: boolean;
}

interface UserOption { id: number; full_name: string; email: string }

export function DriversPage() {
  const { hasPermission, isViewer } = useAuth();
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [form, setForm] = useState({ userId: '', licenseNumber: '', phone: '', vehicleInfo: '', maxActiveDeliveries: '3' });
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const canWrite = hasPermission('drivers.write') && !isViewer;

  const load = () => {
    setLoading(true);
    api.get('/drivers')
      .then(res => setDrivers(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openAdd = async () => {
    try {
      const res = await api.get('/drivers/users-without-profile');
      setUsers(res.data);
      setAddOpen(true);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/drivers', {
        userId: Number(form.userId),
        licenseNumber: form.licenseNumber || undefined,
        phone: form.phone || undefined,
        vehicleInfo: form.vehicleInfo || undefined,
        maxActiveDeliveries: Number(form.maxActiveDeliveries),
      });
      setAlert({ type: 'success', message: 'Driver profile created' });
      setAddOpen(false);
      setForm({ userId: '', licenseNumber: '', phone: '', vehicleInfo: '', maxActiveDeliveries: '3' });
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (id: number, status: string) => {
    try {
      await api.put(`/drivers/${id}/status`, { status });
      setAlert({ type: 'success', message: 'Driver status updated' });
      load();
      if (detail) {
        const res = await api.get(`/drivers/${id}`);
        setDetail(res.data);
      }
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const openDetail = async (id: number) => {
    try {
      const res = await api.get(`/drivers/${id}`);
      setDetail(res.data);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  return (
    <div>
      <PageHeader
        title="Drivers"
        subtitle="Fleet profiles, availability, and capacity — drivers log in to complete deliveries"
        action={canWrite && (
          <button className="btn btn-primary" onClick={openAdd}>Add driver</button>
        )}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <DataTable
        loading={loading}
        data={drivers as unknown as Record<string, unknown>[]}
        onRowClick={(row) => openDetail(Number(row.id))}
        columns={[
          { key: 'full_name', label: 'Driver' },
          { key: 'phone', label: 'Phone', render: (v) => v ? String(v) : '—' },
          { key: 'vehicle_info', label: 'Vehicle', render: (v) => v ? String(v) : '—' },
          {
            key: 'status', label: 'Status',
            render: (v) => <StatusBadge status={String(v)} type="driver" />,
          },
          { key: 'activeDeliveries', label: 'Active routes' },
          { key: 'slotsRemaining', label: 'Slots left' },
          {
            key: 'actions', label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => (
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

      <Modal open={addOpen} title="Add driver profile" onClose={() => setAddOpen(false)}>
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          Link a user with the Driver role. They can sign in and use the Deliveries page.
        </p>
        <form onSubmit={handleAdd}>
          <div className="form-group">
            <label>User account</label>
            <select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} required>
              <option value="">Select user with Driver role...</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>License #</label>
              <input value={form.licenseNumber} onChange={e => setForm({ ...form, licenseNumber: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>Vehicle</label>
            <input value={form.vehicleInfo} onChange={e => setForm({ ...form, vehicleInfo: e.target.value })} placeholder="e.g. Van — ABC-1234" />
          </div>
          <div className="form-group">
            <label>Max active deliveries</label>
            <input type="number" min="1" max="10" value={form.maxActiveDeliveries} onChange={e => setForm({ ...form, maxActiveDeliveries: e.target.value })} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setAddOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Create driver'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} title={String(detail?.full_name ?? 'Driver')} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <dl className="settings-dl" style={{ marginBottom: 16 }}>
              <div className="settings-row"><dt>Email</dt><dd>{String(detail.email)}</dd></div>
              <div className="settings-row"><dt>License</dt><dd>{String(detail.license_number ?? '—')}</dd></div>
              <div className="settings-row"><dt>Vehicle</dt><dd>{String(detail.vehicle_info ?? '—')}</dd></div>
              <div className="settings-row"><dt>Status</dt><dd>{formatDriverStatus(String(detail.status))}</dd></div>
              <div className="settings-row"><dt>Capacity</dt><dd>{String(detail.activeDeliveries)} / {String(detail.max_active_deliveries)} active</dd></div>
            </dl>
            {canWrite && (
              <div className="action-buttons" style={{ marginBottom: 16 }}>
                <button className="btn btn-outline btn-sm" onClick={() => setStatus(Number(detail.id), 'AVAILABLE')}>Mark available</button>
                <button className="btn btn-outline btn-sm" onClick={() => setStatus(Number(detail.id), 'OFF_DUTY')}>Mark off duty</button>
              </div>
            )}
            {(detail.activeDeliveryList as Array<Record<string, unknown>>)?.length ? (
              <>
                <h3 className="section-title">Current assignments</h3>
                <ul style={{ listStyle: 'none' }}>
                  {(detail.activeDeliveryList as Array<Record<string, unknown>>).map(d => (
                    <li key={String(d.id)} className="settings-card" style={{ marginBottom: 8, padding: 12 }}>
                      {String(d.order_number)} — {String(d.customer_name)} — <StatusBadge status={String(d.status)} type="delivery" />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="page-subtitle">No active deliveries assigned.</p>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
