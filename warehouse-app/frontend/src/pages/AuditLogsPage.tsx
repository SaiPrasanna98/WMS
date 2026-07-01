import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';

export function AuditLogsPage() {
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api.get('/audit-logs/entity-types')
      .then(res => setEntityTypes(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (actionFilter) params.set('action', actionFilter);
    if (entityFilter) params.set('entityType', entityFilter);
    setLoading(true);
    api.get(`/audit-logs?${params}`)
      .then(res => setLogs(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  }, [search, actionFilter, entityFilter]);

  const formatAction = (action: string) => {
    const map: Record<string, string> = {
      CREATE: 'Created',
      UPDATE: 'Updated',
      DELETE: 'Deleted',
      STATUS_CHANGE: 'Status changed',
      LOGIN: 'Signed in',
    };
    return map[action] || action.toLowerCase();
  };

  const formatJson = (value: unknown) => {
    if (!value) return '—';
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <div>
      <PageHeader title="Audit trail" />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search user or record type..." />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="filter-select">
          <option value="">All actions</option>
          <option value="CREATE">Created</option>
          <option value="UPDATE">Updated</option>
          <option value="DELETE">Deleted</option>
          <option value="STATUS_CHANGE">Status changed</option>
          <option value="LOGIN">Signed in</option>
        </select>
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="filter-select">
          <option value="">All record types</option>
          {entityTypes.map(t => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      <DataTable
        loading={loading}
        data={logs}
        onRowClick={(row) => { setSelectedLog(row); setDetailOpen(true); }}
        columns={[
          { key: 'created_at', label: 'When', render: (v) => new Date(String(v)).toLocaleString() },
          { key: 'user_name', label: 'User', render: (v, row) => String(v || row.user_email || 'System') },
          { key: 'action', label: 'Action', render: (v) => formatAction(String(v)) },
          { key: 'entity_type', label: 'Record', render: (v) => String(v).replace(/_/g, ' ') },
          { key: 'entity_id', label: 'ID', render: (v) => v ? String(v) : '—' },
        ]}
      />

      <Modal open={detailOpen} title="Audit event detail" onClose={() => setDetailOpen(false)}>
        {selectedLog && (
          <dl className="settings-dl">
            <div className="settings-row"><dt>When</dt><dd>{new Date(String(selectedLog.created_at)).toLocaleString()}</dd></div>
            <div className="settings-row"><dt>User</dt><dd>{String(selectedLog.user_name ?? selectedLog.user_email ?? 'System')}</dd></div>
            <div className="settings-row"><dt>Action</dt><dd>{formatAction(String(selectedLog.action))}</dd></div>
            <div className="settings-row"><dt>Record</dt><dd>{String(selectedLog.entity_type)} #{String(selectedLog.entity_id ?? '—')}</dd></div>
            <div className="settings-row"><dt>IP address</dt><dd>{String(selectedLog.ip_address ?? '—')}</dd></div>
          </dl>
        )}
        {selectedLog && (
          <div className="settings-card" style={{ marginTop: 16 }}>
            <h3 className="settings-card-title">Before</h3>
            <pre className="audit-json">{formatJson(selectedLog.old_value)}</pre>
            <h3 className="settings-card-title" style={{ marginTop: 12 }}>After</h3>
            <pre className="audit-json">{formatJson(selectedLog.new_value)}</pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
