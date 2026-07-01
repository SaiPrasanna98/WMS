import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { Pallet, WarehouseLocation } from '../types';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';

function formatLocation(pallet: Pallet): string {
  if (!pallet.location_code) return '—';
  const parts = [pallet.location_code];
  if (pallet.shelf) parts.push(`shelf ${pallet.shelf}`);
  if (pallet.rack) parts.push(`rack ${pallet.rack}`);
  return parts.join(' · ');
}

export function PalletsPage() {
  const { hasPermission, isViewer } = useAuth();
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [moveModal, setMoveModal] = useState<{ open: boolean; pallet: Pallet | null; empty: boolean }>({
    open: false, pallet: null, empty: false,
  });
  const [toLocationId, setToLocationId] = useState('');
  const [moveNotes, setMoveNotes] = useState('');
  const [adjustModal, setAdjustModal] = useState<{ open: boolean; pallet: Pallet | null }>({ open: false, pallet: null });
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canMove = (hasPermission('pallets.move') || hasPermission('pallets.write')) && !isViewer;
  const canWrite = hasPermission('pallets.write') && !isViewer;
  const canAdjust = hasPermission('inventory.adjust') && !isViewer;

  const loadData = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    Promise.all([
      api.get(`/pallets?${params}`),
      api.get('/locations'),
    ]).then(([palletsRes, locRes]) => {
      let data = palletsRes.data as Pallet[];
      if (locationFilter) {
        data = data.filter(p => String(p.location_id) === locationFilter);
      }
      setPallets(data);
      setLocations(locRes.data);
    }).catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [search, statusFilter, locationFilter]);

  const openMove = (pallet: Pallet, empty: boolean) => {
    setMoveModal({ open: true, pallet, empty });
    setToLocationId('');
    setMoveNotes(empty ? 'Relocate empty pallet to free shelf space' : '');
  };

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveModal.pallet) return;
    setSubmitting(true);
    try {
      await api.post(`/pallets/${moveModal.pallet.id}/move`, {
        toLocationId: Number(toLocationId),
        notes: moveNotes || undefined,
      });
      setAlert({
        type: 'success',
        message: moveModal.empty ? 'Empty pallet relocated' : 'Pallet moved successfully',
      });
      setMoveModal({ open: false, pallet: null, empty: false });
      setToLocationId('');
      setMoveNotes('');
      loadData();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkDepleted = async (pallet: Pallet) => {
    if (!window.confirm(`Mark pallet ${pallet.pallet_id} as depleted? You can then relocate it to a lower shelf.`)) return;
    try {
      await api.post(`/pallets/${pallet.id}/mark-depleted`);
      setAlert({ type: 'success', message: 'Pallet marked depleted. Use Relocate to move the empty pallet.' });
      loadData();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const openAdjust = (pallet: Pallet) => {
    setAdjustModal({ open: true, pallet });
    setAdjustQty(String(pallet.quantity));
    setAdjustReason('');
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModal.pallet) return;
    setSubmitting(true);
    try {
      await api.post('/inventory/adjust', {
        palletId: adjustModal.pallet.id,
        newQuantity: Number(adjustQty),
        reason: adjustReason || undefined,
      });
      setAlert({ type: 'success', message: 'Cycle count adjustment saved' });
      setAdjustModal({ open: false, pallet: null });
      loadData();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const canMoveStock = (row: Pallet) =>
    row.status === 'ACTIVE' && row.quantity > 0 && row.qc_status !== 'FAILED';

  const canRelocateEmpty = (row: Pallet) =>
    row.status === 'DEPLETED' || row.quantity === 0;

  const destinationLocations = locations.filter(
    loc => !moveModal.pallet || loc.id !== moveModal.pallet.location_id
  );

  const renderActions = (_: unknown, row: Record<string, unknown>) => {
    const pallet = row as unknown as Pallet;
    const buttons: React.ReactNode[] = [];

    if (canMove && canMoveStock(pallet)) {
      buttons.push(
        <button key="move" className="btn btn-sm btn-primary" onClick={() => openMove(pallet, false)}>
          Move
        </button>
      );
    }
    if (canMove && canRelocateEmpty(pallet)) {
      buttons.push(
        <button key="relocate" className="btn btn-sm btn-outline" onClick={() => openMove(pallet, true)}>
          Relocate
        </button>
      );
    }
    if (canWrite && pallet.quantity === 0 && pallet.status === 'ACTIVE') {
      buttons.push(
        <button key="depleted" className="btn btn-sm btn-outline" onClick={() => handleMarkDepleted(pallet)}>
          Mark empty
        </button>
      );
    }
    if (canAdjust && pallet.status !== 'HOLD') {
      buttons.push(
        <button key="adjust" className="btn btn-sm btn-outline" onClick={() => openAdjust(pallet)}>
          Adjust
        </button>
      );
    }

    if (buttons.length === 0) return <span className="cell-secondary">—</span>;
    return <div className="action-buttons">{buttons}</div>;
  };

  return (
    <div>
      <PageHeader
        title="Pallets"
        subtitle="Move stock between locations, or relocate empty pallets to free upper shelves"
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      {!canMove && !canWrite && (
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          You have read-only access. Sign in as Warehouse Worker or Manager to move pallets.
        </p>
      )}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search pallets..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DEPLETED">Depleted (empty)</option>
          <option value="HOLD">On hold</option>
        </select>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="filter-select">
          <option value="">All locations</option>
          {locations.map(loc => (
            <option key={loc.id} value={loc.id}>{loc.code}</option>
          ))}
        </select>
      </div>

      <DataTable
        loading={loading}
        data={pallets as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'pallet_id', label: 'Pallet ID' },
          { key: 'product_name', label: 'Product' },
          { key: 'lot_number', label: 'Lot' },
          { key: 'quantity', label: 'Qty' },
          {
            key: 'location_code',
            label: 'Location',
            render: (_, row) => formatLocation(row as unknown as Pallet),
          },
          { key: 'qc_status', label: 'QC', render: (v) => v ? <StatusBadge status={String(v)} type="qc" /> : '-' },
          { key: 'status', label: 'Status', render: (v) => String(v).replace(/_/g, ' ') },
          ...(canMove || canWrite || canAdjust ? [{
            key: 'actions' as const,
            label: 'Actions',
            render: renderActions,
          }] : []),
        ]}
      />

      <Modal
        open={moveModal.open}
        title={moveModal.empty ? `Relocate empty pallet ${moveModal.pallet?.pallet_id ?? ''}` : `Move pallet ${moveModal.pallet?.pallet_id ?? ''}`}
        onClose={() => setMoveModal({ open: false, pallet: null, empty: false })}
      >
        {moveModal.pallet && (
          <p className="page-subtitle" style={{ marginBottom: 16 }}>
            {moveModal.pallet.product_name} — Lot {moveModal.pallet.lot_number}
            {moveModal.empty
              ? ' — Empty pallet (move to lower shelf or staging area)'
              : ` — Qty ${moveModal.pallet.quantity}`}
          </p>
        )}
        <form onSubmit={handleMove} className="form">
          <div className="form-group">
            <label>Destination location</label>
            <select value={toLocationId} onChange={e => setToLocationId(e.target.value)} required>
              <option value="">Select location...</option>
              {destinationLocations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.code} ({loc.location_type.replace(/_/g, ' ')})
                  {loc.shelf ? ` — shelf ${loc.shelf}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Notes (optional)</label>
            <input
              type="text"
              value={moveNotes}
              onChange={e => setMoveNotes(e.target.value)}
              placeholder={moveModal.empty ? 'e.g. Moved from top shelf to floor level' : 'Reason for move'}
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setMoveModal({ open: false, pallet: null, empty: false })}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : moveModal.empty ? 'Relocate pallet' : 'Move pallet'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={adjustModal.open}
        title={`Cycle count — ${adjustModal.pallet?.pallet_id ?? ''}`}
        onClose={() => setAdjustModal({ open: false, pallet: null })}
      >
        {adjustModal.pallet && (
          <p className="page-subtitle" style={{ marginBottom: 16 }}>
            Current quantity: {adjustModal.pallet.quantity}. Set to zero to mark pallet as depleted.
          </p>
        )}
        <form onSubmit={handleAdjust}>
          <div className="form-group">
            <label>Counted quantity</label>
            <input
              type="number"
              min="0"
              step="any"
              value={adjustQty}
              onChange={e => setAdjustQty(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Reason</label>
            <input
              type="text"
              value={adjustReason}
              onChange={e => setAdjustReason(e.target.value)}
              placeholder="e.g. Cycle count variance"
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setAdjustModal({ open: false, pallet: null })}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save adjustment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
