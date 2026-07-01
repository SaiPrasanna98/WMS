import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';

interface InvoiceRow {
  id: number;
  invoice_number: string;
  order_number: string;
  customer_name: string;
  status: string;
  total_amount: number;
  issued_at?: string;
}

export function InvoicesPage() {
  const { hasPermission, isViewer } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canWrite = hasPermission('invoices.write') && !isViewer;

  const load = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    setLoading(true);
    api.get(`/invoices?${params}`)
      .then(res => setInvoices(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [search, statusFilter]);

  const openDetail = async (id: number) => {
    try {
      const res = await api.get(`/invoices/${id}`);
      setDetail(res.data);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const sendInvoice = async () => {
    if (!detail) return;
    setSubmitting(true);
    try {
      await api.post(`/invoices/${detail.id}/send`);
      setAlert({ type: 'success', message: 'Invoice sent' });
      openDetail(Number(detail.id));
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const markPaid = async () => {
    if (!detail) return;
    setSubmitting(true);
    try {
      await api.post(`/invoices/${detail.id}/mark-paid`);
      setAlert({ type: 'success', message: 'Invoice marked paid' });
      openDetail(Number(detail.id));
      load();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Quotes created on order confirmation — finalize when delivery completes"
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search invoices..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All statuses</option>
          <option value="QUOTE">Quote</option>
          <option value="SENT">Sent</option>
          <option value="PAID">Paid</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        data={invoices as unknown as Record<string, unknown>[]}
        onRowClick={(row) => openDetail(Number(row.id))}
        columns={[
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'order_number', label: 'Order' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} type="invoice" /> },
          { key: 'total_amount', label: 'Total', render: (v) => `$${Number(v).toFixed(2)}` },
          { key: 'issued_at', label: 'Issued', render: (v) => v ? String(v).slice(0, 10) : '—' },
        ]}
      />

      <Modal open={!!detail} title={String(detail?.invoice_number ?? 'Invoice')} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <p className="page-subtitle" style={{ marginBottom: 16 }}>
              {String(detail.customer_name)} — Order {String(detail.order_number)} —{' '}
              <StatusBadge status={String(detail.status)} type="invoice" />
            </p>
            <table className="data-table compact" style={{ marginBottom: 16 }}>
              <thead>
                <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Line total</th></tr>
              </thead>
              <tbody>
                {(detail.lineItems as Array<Record<string, unknown>>).map((line, i) => (
                  <tr key={i}>
                    <td>{String(line.description)}</td>
                    <td>{String(line.quantity)}</td>
                    <td>${Number(line.unit_price).toFixed(2)}</td>
                    <td>${Number(line.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="settings-dl">
              <div className="settings-row"><dt>Subtotal</dt><dd>${Number(detail.subtotal).toFixed(2)}</dd></div>
              <div className="settings-row"><dt>Handling</dt><dd>${Number(detail.handling_fee).toFixed(2)}</dd></div>
              <div className="settings-row"><dt>Shipping</dt><dd>${Number(detail.shipping_fee).toFixed(2)}</dd></div>
              <div className="settings-row"><dt>Tax</dt><dd>${Number(detail.tax_amount).toFixed(2)}</dd></div>
              <div className="settings-row"><dt><strong>Total</strong></dt><dd><strong>${Number(detail.total_amount).toFixed(2)}</strong></dd></div>
            </dl>
            {canWrite && (
              <div className="action-buttons" style={{ marginTop: 16 }}>
                {detail.status === 'QUOTE' && (
                  <button className="btn btn-primary" disabled={submitting} onClick={sendInvoice}>Send to customer</button>
                )}
                {['QUOTE', 'SENT'].includes(String(detail.status)) && (
                  <button className="btn btn-outline" disabled={submitting} onClick={markPaid}>Mark paid</button>
                )}
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
