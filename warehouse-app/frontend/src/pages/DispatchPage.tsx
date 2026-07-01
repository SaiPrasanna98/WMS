import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Alert } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';

interface BoardData {
  drivers: Array<{
    id: number; full_name: string; status: string; isAvailable: boolean;
    activeDeliveries: number; slotsRemaining: number;
  }>;
  unassignedOrders: Array<{
    id: number; order_number: string; customer_name: string; priority: string;
    estimated_delivery_date?: string;
  }>;
  activeDeliveries: Array<{
    id: number; order_number: string; customer_name: string; driver_name?: string;
    status: string; tracking_number?: string; carrier_name?: string;
  }>;
}

export function DispatchPage() {
  const { hasPermission, isViewer } = useAuth();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [assignOrderId, setAssignOrderId] = useState<number | null>(null);
  const [driverId, setDriverId] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<'INTERNAL_DRIVER' | 'CARRIER'>('INTERNAL_DRIVER');
  const [submitting, setSubmitting] = useState(false);

  const canAssign = hasPermission('deliveries.write') && !isViewer;

  const load = () => {
    setLoading(true);
    api.get('/dispatch/board')
      .then(res => setBoard(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignOrderId || !driverId) return;
    setSubmitting(true);
    try {
      await api.post(`/drivers/${driverId}/assign-order`, {
        orderId: assignOrderId,
        carrierName: carrierName || undefined,
        trackingNumber: trackingNumber || undefined,
        deliveryMethod,
      });
      setAlert({ type: 'success', message: 'Driver assigned — delivery created' });
      setAssignOrderId(null);
      setDriverId('');
      setCarrierName('');
      setTrackingNumber('');
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="table-loading">Loading dispatch board...</div>;

  const availableDrivers = board?.drivers.filter(d => d.isAvailable) ?? [];

  return (
    <div>
      <PageHeader
        title="Dispatch"
        subtitle="Assign packed orders to your own drivers. Use carrier tracking only when shipping via FedEx/UPS (optional)."
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="inline-stats" style={{ marginBottom: 24 }}>
        <div className="inline-stat">
          <span className="inline-stat-value">{availableDrivers.length}</span>
          <span className="inline-stat-label">Drivers available</span>
        </div>
        <div className="inline-stat">
          <span className="inline-stat-value">{board?.unassignedOrders.length ?? 0}</span>
          <span className="inline-stat-label">Awaiting dispatch</span>
        </div>
        <div className="inline-stat">
          <span className="inline-stat-value">{board?.activeDeliveries.length ?? 0}</span>
          <span className="inline-stat-label">On the road</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <section className="settings-card" style={{ padding: 16 }}>
          <h3 className="settings-card-title">Drivers</h3>
          {board?.drivers.length === 0 ? (
            <p className="page-subtitle">No drivers — add profiles on the Drivers page.</p>
          ) : (
            <table className="data-table compact">
              <thead>
                <tr><th>Driver</th><th>Status</th><th>Routes</th><th>Slots</th></tr>
              </thead>
              <tbody>
                {board?.drivers.map(d => (
                  <tr key={d.id}>
                    <td>{d.full_name}</td>
                    <td><StatusBadge status={d.status} type="driver" /></td>
                    <td>{d.activeDeliveries}</td>
                    <td>{d.isAvailable ? `${d.slotsRemaining} free` : 'Full'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="settings-card" style={{ padding: 16 }}>
          <h3 className="settings-card-title">Ready for pickup — unassigned</h3>
          {board?.unassignedOrders.length === 0 ? (
            <p className="page-subtitle">No orders waiting for dispatch.</p>
          ) : (
            <ul style={{ listStyle: 'none' }}>
              {board?.unassignedOrders.map(o => (
                <li key={o.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                  <strong>{o.order_number}</strong> — {o.customer_name}
                  <br />
                  <span className="page-subtitle">Priority: {o.priority} · Est. delivery: {o.estimated_delivery_date ?? '—'}</span>
                  {canAssign && (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => setAssignOrderId(o.id)}>Assign</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="settings-card" style={{ padding: 16, marginTop: 24 }}>
        <h3 className="settings-card-title">Active deliveries</h3>
        {board?.activeDeliveries.length === 0 ? (
          <p className="page-subtitle">Nothing in transit right now.</p>
        ) : (
          <table className="data-table compact">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Driver</th><th>Status</th><th>Tracking</th></tr>
            </thead>
            <tbody>
              {board?.activeDeliveries.map(d => (
                <tr key={d.id}>
                  <td>{d.order_number}</td>
                  <td>{d.customer_name}</td>
                  <td>{d.driver_name ?? '—'}</td>
                  <td><StatusBadge status={d.status} type="delivery" /></td>
                  <td>{d.carrier_name ? `${d.carrier_name}: ${d.tracking_number ?? '—'}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {assignOrderId && canAssign && (
        <div className="modal-overlay" onClick={() => setAssignOrderId(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Assign delivery</h2>
              <button className="modal-close" onClick={() => setAssignOrderId(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleAssign}>
                <div className="form-group">
                  <label>Delivery method</label>
                  <select value={deliveryMethod} onChange={e => setDeliveryMethod(e.target.value as 'INTERNAL_DRIVER' | 'CARRIER')}>
                    <option value="INTERNAL_DRIVER">Our driver</option>
                    <option value="CARRIER">Carrier (FedEx, UPS, etc.)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Driver {deliveryMethod === 'INTERNAL_DRIVER' && '(required)'}</label>
                  <select value={driverId} onChange={e => setDriverId(e.target.value)} required>
                    <option value="">Select driver...</option>
                    {(deliveryMethod === 'INTERNAL_DRIVER' ? availableDrivers : board?.drivers ?? []).map(d => (
                      <option key={d.id} value={d.id}>{d.full_name}{d.isAvailable ? '' : ' (busy)'}</option>
                    ))}
                  </select>
                </div>
                {deliveryMethod === 'CARRIER' && (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Carrier name (optional)</label>
                      <input value={carrierName} onChange={e => setCarrierName(e.target.value)} placeholder="FedEx, UPS, DHL..." />
                    </div>
                    <div className="form-group">
                      <label>Tracking number (optional)</label>
                      <input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} placeholder="1Z999..." />
                    </div>
                  </div>
                )}
                <div className="form-actions">
                  <button type="button" className="btn btn-outline" onClick={() => setAssignOrderId(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Assigning...' : 'Assign driver'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
