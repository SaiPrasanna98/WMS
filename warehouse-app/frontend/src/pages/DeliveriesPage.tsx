import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';

interface DeliveryRow {
  id?: number;
  order_id?: number;
  order_number: string;
  customer_name: string;
  status: string;
  priority: string;
  package_count: number;
  pickup_location: string;
  line1: string;
  city: string;
  state?: string;
  postal_code?: string;
  carrier_name?: string;
  tracking_number?: string;
  delivery_method?: string;
  row_type?: string;
  driver_name?: string;
  packages?: Array<{ package_barcode: string }>;
}

export function DeliveriesPage() {
  const { isViewer, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [detail, setDetail] = useState<DeliveryRow | null>(null);
  const [pickupScans, setPickupScans] = useState('');
  const [proofModal, setProofModal] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isDriverOnly = hasPermission('deliveries.proof') && !hasPermission('orders.read');
  const canWrite = hasPermission('deliveries.write') && !isViewer;

  const load = () => {
    setLoading(true);
    const url = isDriverOnly ? '/deliveries' : '/deliveries?includePending=true';
    api.get(url)
      .then(res => setDeliveries(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [isDriverOnly]);

  const openDetail = async (row: DeliveryRow) => {
    if (row.row_type === 'pending_dispatch') {
      navigate('/dispatch');
      return;
    }
    if (!row.id) return;
    try {
      const res = await api.get(`/deliveries/${row.id}`);
      setDetail(res.data);
      setPickupScans('');
      setCarrierName(res.data.carrier_name ?? '');
      setTrackingNumber(res.data.tracking_number ?? '');
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleArrive = async () => {
    if (!detail?.id) return;
    try {
      await api.post(`/deliveries/${detail.id}/arrive`);
      setAlert({ type: 'success', message: 'Arrival recorded' });
      openDetail(detail);
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handlePickup = async () => {
    if (!detail?.id) return;
    const barcodes = pickupScans.split(',').map(s => s.trim()).filter(Boolean);
    setSubmitting(true);
    try {
      await api.post(`/deliveries/${detail.id}/pickup`, { packageBarcodes: barcodes });
      await api.post(`/deliveries/${detail.id}/start-transit`);
      setAlert({ type: 'success', message: 'Pickup confirmed — in transit' });
      openDetail(detail);
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail?.id) return;
    setSubmitting(true);
    try {
      await api.post('/proof-of-delivery', {
        deliveryId: detail.id,
        recipientName,
        notes: deliveryNotes || undefined,
      });
      setAlert({ type: 'success', message: 'Delivery completed' });
      setProofModal(false);
      setDetail(null);
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const saveTracking = async () => {
    if (!detail?.id) return;
    setSubmitting(true);
    try {
      await api.put(`/deliveries/${detail.id}/tracking`, {
        carrierName: carrierName || undefined,
        trackingNumber: trackingNumber || undefined,
        deliveryMethod: carrierName ? 'CARRIER' : 'INTERNAL_DRIVER',
      });
      setAlert({ type: 'success', message: 'Tracking updated' });
      openDetail(detail);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleFail = async () => {
    if (!detail?.id) return;
    const notes = window.prompt('Reason for failed delivery?');
    if (!notes) return;
    try {
      await api.post(`/deliveries/${detail.id}/fail`, { notes });
      setAlert({ type: 'success', message: 'Marked as failed' });
      setDetail(null);
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const pendingCount = deliveries.filter(d => d.row_type === 'pending_dispatch').length;
  const activeCount = deliveries.filter(d => d.row_type !== 'pending_dispatch').length;

  return (
    <div>
      <PageHeader
        title="Deliveries"
        subtitle={`${pendingCount} ready for dispatch · ${activeCount} in progress`}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      {deliveries.length === 0 && !loading && (
        <div className="settings-card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 className="settings-card-title">No deliveries</h3>
          <p className="page-subtitle">
            Deliveries appear after orders are picked, packed, and assigned to a driver.
          </p>
        </div>
      )}

      <DataTable
        loading={loading}
        data={deliveries as unknown as Record<string, unknown>[]}
        onRowClick={(row) => openDetail(row as unknown as DeliveryRow)}
        emptyMessage=""
        columns={[
          { key: 'order_number', label: 'Order' },
          { key: 'customer_name', label: 'Customer' },
          {
            key: 'status', label: 'Status',
            render: (v, row) => (
              <StatusBadge
                status={String(v)}
                type={row.row_type === 'pending_dispatch' ? 'order' : 'delivery'}
              />
            ),
          },
          { key: 'priority', label: 'Priority' },
          { key: 'package_count', label: 'Packages' },
          { key: 'driver_name', label: 'Driver', render: (v) => v ? String(v) : '—' },
          {
            key: 'tracking_number', label: 'Tracking',
            render: (_: unknown, row: Record<string, unknown>) =>
              row.tracking_number ? `${row.carrier_name ?? ''} ${row.tracking_number}` : '—',
          },
          {
            key: 'address', label: 'Deliver to',
            render: (_: unknown, row: Record<string, unknown>) => `${row.line1}, ${row.city}`,
          },
          {
            key: 'actions', label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={(e) => { e.stopPropagation(); openDetail(row as unknown as DeliveryRow); }}
              >
                {row.row_type === 'pending_dispatch' ? 'Dispatch' : 'Open'}
              </button>
            ),
          },
        ]}
      />

      <Modal open={!!detail && detail.row_type !== 'pending_dispatch'} title={`Delivery — ${detail?.order_number ?? ''}`} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <p className="page-subtitle" style={{ marginBottom: 12 }}>
              {detail.customer_name} — <StatusBadge status={detail.status} type="delivery" />
            </p>
            <dl className="settings-dl">
              <div className="settings-row"><dt>Pickup</dt><dd>{detail.pickup_location}</dd></div>
              <div className="settings-row"><dt>Deliver to</dt><dd>{detail.line1}, {detail.city} {detail.state} {detail.postal_code}</dd></div>
              <div className="settings-row"><dt>Packages</dt><dd>{detail.package_count}</dd></div>
              {detail.driver_name && <div className="settings-row"><dt>Driver</dt><dd>{detail.driver_name}</dd></div>}
            </dl>

            {canWrite && detail.delivery_method === 'CARRIER' && (
              <div className="settings-card" style={{ marginTop: 12, marginBottom: 12, padding: 12 }}>
                <h4 className="section-title">External carrier tracking (optional)</h4>
                <p className="page-subtitle" style={{ marginBottom: 8 }}>Only needed when shipping via FedEx/UPS — skip for your own drivers.</p>
                <div className="form-row">
                  <div className="form-group">
                    <label>Carrier</label>
                    <input value={carrierName} onChange={e => setCarrierName(e.target.value)} placeholder="FedEx, UPS..." />
                  </div>
                  <div className="form-group">
                    <label>Tracking #</label>
                    <input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} />
                  </div>
                </div>
                <button className="btn btn-outline btn-sm" disabled={submitting} onClick={saveTracking}>Save tracking</button>
              </div>
            )}

            {canWrite && detail.status === 'ASSIGNED' && (
              <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={handleArrive}>Arrived at warehouse</button>
            )}

            {canWrite && ['ASSIGNED', 'ARRIVED_AT_WAREHOUSE'].includes(detail.status) && (
              <div style={{ marginTop: 16 }}>
                <div className="form-group">
                  <label>Package barcodes (optional for testing)</label>
                  <input
                    value={pickupScans}
                    onChange={e => setPickupScans(e.target.value)}
                    placeholder={detail.packages?.map(p => p.package_barcode).join(', ') ?? 'Leave empty to release all packages'}
                  />
                  <p className="form-hint">
                    {detail.packages?.length
                      ? `Packed: ${detail.packages.map(p => p.package_barcode).join(', ')} — leave blank to auto-release all`
                      : 'No packages found — pack the order first in Warehouse tasks'}
                  </p>
                </div>
                <button className="btn btn-primary" disabled={submitting || !detail.packages?.length} onClick={handlePickup}>
                  Confirm pickup & start transit
                </button>
              </div>
            )}

            {canWrite && ['PICKED_UP', 'IN_TRANSIT'].includes(detail.status) && (
              <div className="action-buttons" style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={() => setProofModal(true)}>Complete delivery</button>
                <button className="btn btn-outline" onClick={handleFail}>Failed delivery</button>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal open={proofModal} title="Proof of delivery" onClose={() => setProofModal(false)}>
        <form onSubmit={handleProof}>
          <div className="form-group">
            <label>Recipient name</label>
            <input value={recipientName} onChange={e => setRecipientName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setProofModal(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>Submit proof</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
