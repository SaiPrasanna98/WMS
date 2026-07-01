import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { Lot } from '../types';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';

export function QCPage() {
  const { hasPermission, isViewer } = useAuth();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [inspectModal, setInspectModal] = useState<{ open: boolean; lotId: number | null; lotNumber: string }>({
    open: false, lotId: null, lotNumber: '',
  });
  const [inspectForm, setInspectForm] = useState({ status: 'PASSED', notes: '' });

  const loadLots = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/qc?${params}`)
      .then(res => setLots(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadLots(); }, [search, statusFilter]);

  const handleInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectModal.lotId) return;
    try {
      await api.post(`/qc/${inspectModal.lotId}/inspect`, inspectForm);
      setAlert({ type: 'success', message: `QC status updated for ${inspectModal.lotNumber}` });
      setInspectModal({ open: false, lotId: null, lotNumber: '' });
      setInspectForm({ status: 'PASSED', notes: '' });
      loadLots();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  return (
    <div>
      <PageHeader title="Quality" />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search lots..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All Statuses</option>
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
          { key: 'sku', label: 'SKU' },
          { key: 'product_name', label: 'Product' },
          { key: 'product_type', label: 'Type', render: (v) => String(v).replace(/_/g, ' ') },
          { key: 'quantity', label: 'Quantity' },
          { key: 'qc_status', label: 'QC Status', render: (v) => <StatusBadge status={String(v)} type="qc" /> },
          { key: 'last_inspector', label: 'Last Inspector', render: (v) => (v ? String(v) : '-') },
          ...(hasPermission('qc.write') && !isViewer ? [{
            key: 'actions' as const,
            label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setInspectModal({ open: true, lotId: row.lot_id as number, lotNumber: row.lot_number as string })}
              >
                Inspect
              </button>
            ),
          }] : []),
        ]}
      />

      <Modal open={inspectModal.open} title={`QC Inspection - ${inspectModal.lotNumber}`} onClose={() => setInspectModal({ open: false, lotId: null, lotNumber: '' })}>
        <form onSubmit={handleInspect} className="form">
          <div className="form-group">
            <label>QC Status</label>
            <select value={inspectForm.status} onChange={e => setInspectForm({ ...inspectForm, status: e.target.value })} required>
              <option value="PASSED">Passed</option>
              <option value="FAILED">Failed</option>
              <option value="HOLD">Hold</option>
            </select>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea value={inspectForm.notes} onChange={e => setInspectForm({ ...inspectForm, notes: e.target.value })} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setInspectModal({ open: false, lotId: null, lotNumber: '' })}>Cancel</button>
            <button type="submit" className="btn btn-primary">Submit Inspection</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
