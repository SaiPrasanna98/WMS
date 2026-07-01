import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { PageHeader, DataTable, Alert, Modal } from '../components/UI';

export function NotificationsPage() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get('/notifications')
      .then(res => setRows(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Customer notifications" />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <DataTable
        loading={loading}
        data={rows}
        onRowClick={(row) => setDetail(row)}
        columns={[
          { key: 'created_at', label: 'When', render: (v) => new Date(String(v)).toLocaleString() },
          { key: 'customer_name', label: 'Customer' },
          { key: 'notification_type', label: 'Type', render: (v) => String(v).replace(/_/g, ' ') },
          { key: 'recipient', label: 'To' },
          { key: 'subject', label: 'Subject' },
          { key: 'status', label: 'Status' },
        ]}
      />

      <Modal open={!!detail} title="Notification" onClose={() => setDetail(null)}>
        {detail && (
          <>
            <dl className="settings-dl">
              <div className="settings-row"><dt>To</dt><dd>{String(detail.recipient)}</dd></div>
              <div className="settings-row"><dt>Subject</dt><dd>{String(detail.subject)}</dd></div>
              <div className="settings-row"><dt>Type</dt><dd>{String(detail.notification_type)}</dd></div>
            </dl>
            <pre className="audit-json" style={{ marginTop: 16 }}>{String(detail.body)}</pre>
          </>
        )}
      </Modal>
    </div>
  );
}
