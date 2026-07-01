import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { PageHeader, DataTable, SearchBar, Alert } from '../components/UI';
import { ProductCell } from '../components/Cells';
import { formatTransactionType } from '../utils/labels';

export function InventoryTransactionsPage() {
  const [transactions, setTransactions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (typeFilter) params.set('type', typeFilter);
    setLoading(true);
    api.get(`/inventory-transactions?${params}`)
      .then(res => setTransactions(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  }, [search, typeFilter]);

  return (
    <div>
      <PageHeader title="Movement history" />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search..." />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="filter-select">
          <option value="">All actions</option>
          <option value="RECEIVE">Received</option>
          <option value="MOVE">Moved</option>
          <option value="PICK">Picked</option>
          <option value="CONSUME">Consumed</option>
          <option value="SHIP">Shipped</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        data={transactions}
        columns={[
          { key: 'created_at', label: 'Date', render: (v) => new Date(String(v)).toLocaleString() },
          { key: 'transaction_type', label: 'Action', render: (v) => formatTransactionType(String(v)) },
          {
            key: 'product_name',
            label: 'Product',
            render: (_, row) => <ProductCell name={String(row.product_name)} code={row.sku ? String(row.sku) : undefined} />,
          },
          { key: 'lot_number', label: 'Lot', render: (v) => (v ? String(v) : '—') },
          { key: 'quantity', label: 'Qty' },
          { key: 'from_location', label: 'From', render: (v) => (v ? String(v) : '—') },
          { key: 'to_location', label: 'To', render: (v) => (v ? String(v) : '—') },
          { key: 'performed_by_name', label: 'By' },
        ]}
      />
    </div>
  );
}
