import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { Lot } from '../types';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';

export function LotsPage() {
  const { hasPermission, isViewer } = useAuth();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editModal, setEditModal] = useState<{ open: boolean; lot: Lot | null }>({ open: false, lot: null });
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canEdit = hasPermission('lots.write') && !isViewer;

  const loadLots = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('qcStatus', statusFilter);
    setLoading(true);
    api.get(`/lots?${params}`)
      .then(res => setLots(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadLots(); }, [search, statusFilter]);

  const openEdit = (lot: Lot) => {
    setEditModal({ open: true, lot });
    setExpiryDate(lot.expiry_date ? String(lot.expiry_date).slice(0, 10) : '');
    setNotes(lot.notes ?? '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal.lot) return;
    setSubmitting(true);
    try {
      await api.put(`/lots/${editModal.lot.id}`, {
        expiryDate: expiryDate || null,
        notes: notes || null,
      });
      setAlert({ type: 'success', message: 'Lot updated' });
      setEditModal({ open: false, lot: null });
      loadLots();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Lots"
        subtitle="Batch tracking — edit expiry dates and notes. Quantity is calculated from pallets."
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search lots..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All QC Status</option>
          <option value="PENDING">Pending</option>
          <option value="PASSED">Passed</option>
          <option value="FAILED">Failed</option>
          <option value="HOLD">Hold</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        data={lots as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'lot_number', label: 'Lot Number' },
          { key: 'product_name', label: 'Product' },
          { key: 'quantity', label: 'Quantity' },
          { key: 'qc_status', label: 'QC Status', render: (v) => <StatusBadge status={String(v)} type="qc" /> },
          {
            key: 'expiry_date',
            label: 'Expiry',
            render: (v) => v ? new Date(String(v)).toLocaleDateString() : '—',
          },
          { key: 'received_date', label: 'Received', render: (v) => v ? new Date(String(v)).toLocaleDateString() : '—' },
          ...(canEdit ? [{
            key: 'actions' as const,
            label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => (
              <button className="btn btn-sm btn-outline" onClick={() => openEdit(row as unknown as Lot)}>
                Edit
              </button>
            ),
          }] : []),
        ]}
      />

      <Modal open={editModal.open} title={`Edit lot ${editModal.lot?.lot_number ?? ''}`} onClose={() => setEditModal({ open: false, lot: null })}>
        {editModal.lot && (
          <p className="page-subtitle" style={{ marginBottom: 16 }}>
            {editModal.lot.product_name} — Qty {editModal.lot.quantity} (from pallets)
          </p>
        )}
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Expiry date</label>
            <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Supplier batch info, storage conditions, etc."
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setEditModal({ open: false, lot: null })}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
