import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { ProductCell, StockStatusBadge } from '../components/Cells';
import { formatProductType } from '../utils/labels';

interface InventoryItem {
  productId: number;
  code: string;
  name: string;
  type: string;
  unit: string;
  onHand: number;
  reserved: number;
  atp: number;
  reorderLevel: number;
  palletCount: number;
  stockStatus: 'OK' | 'LOW' | 'OUT';
}

interface InventorySummary {
  totalProducts: number;
  totalOnHand: number;
  lowStock: number;
  outOfStock: number;
}

interface PalletRow {
  id: number;
  pallet_id: string;
  quantity: number;
  status: string;
  location_code?: string;
  lot_number?: string;
  qc_status?: string;
}

export function InventoryPage() {
  const { hasPermission, isViewer } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [palletModal, setPalletModal] = useState<{ open: boolean; product: InventoryItem | null }>({ open: false, product: null });
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [palletsLoading, setPalletsLoading] = useState(false);
  const [adjustPallet, setAdjustPallet] = useState<PalletRow | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canAdjust = hasPermission('inventory.adjust') && !isViewer;

  const loadInventory = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (typeFilter) params.set('type', typeFilter);
    if (stockFilter) params.set('stock', stockFilter);
    setLoading(true);
    api.get(`/inventory?${params}`)
      .then(res => {
        setItems(res.data.items);
        setSummary(res.data.summary);
      })
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadInventory(); }, [search, typeFilter, stockFilter]);

  const openPallets = async (product: InventoryItem) => {
    setPalletModal({ open: true, product });
    setAdjustPallet(null);
    setPalletsLoading(true);
    try {
      const res = await api.get(`/pallets?productId=${product.productId}`);
      setPallets(res.data);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setPalletsLoading(false);
    }
  };

  const openAdjust = (pallet: PalletRow) => {
    setAdjustPallet(pallet);
    setAdjustQty(String(pallet.quantity));
    setAdjustReason('');
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustPallet) return;
    setSubmitting(true);
    try {
      await api.post('/inventory/adjust', {
        palletId: adjustPallet.id,
        newQuantity: Number(adjustQty),
        reason: adjustReason || undefined,
      });
      setAlert({ type: 'success', message: 'Inventory correction saved' });
      setAdjustPallet(null);
      if (palletModal.product) {
        openPallets(palletModal.product);
      }
      loadInventory();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Inventory" />

      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      {summary && (
        <div className="inline-stats">
          <div className="inline-stat"><span className="inline-stat-value">{summary.totalOnHand.toLocaleString()}</span><span className="inline-stat-label">Units on hand</span></div>
          <div className="inline-stat"><span className="inline-stat-value">{summary.totalProducts}</span><span className="inline-stat-label">Products</span></div>
          <div className="inline-stat"><span className="inline-stat-value">{summary.lowStock}</span><span className="inline-stat-label">Low stock</span></div>
          <div className="inline-stat"><span className="inline-stat-value">{summary.outOfStock}</span><span className="inline-stat-label">Out of stock</span></div>
        </div>
      )}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="filter-select">
          <option value="">All types</option>
          <option value="RAW_MATERIAL">Raw material</option>
          <option value="FINISHED_GOOD">Finished good</option>
          <option value="PACKAGING">Packaging</option>
        </select>
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value)} className="filter-select">
          <option value="">All stock levels</option>
          <option value="low">Low stock only</option>
          <option value="out">Out of stock only</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        data={items as unknown as Record<string, unknown>[]}
        emptyMessage="No inventory records"
        onRowClick={(row) => openPallets(row as unknown as InventoryItem)}
        columns={[
          {
            key: 'name',
            label: 'Product',
            render: (_, row) => <ProductCell name={String(row.name)} code={String(row.code)} />,
          },
          { key: 'type', label: 'Type', render: (v) => formatProductType(String(v)) },
          {
            key: 'onHand',
            label: 'On hand',
            render: (v, row) => `${v} ${row.unit}`,
          },
          {
            key: 'reserved',
            label: 'Reserved',
            render: (v, row) => {
              const reserved = Number(v);
              return reserved > 0 ? `${reserved} ${row.unit}` : '—';
            },
          },
          {
            key: 'atp',
            label: 'Available for orders',
            render: (v, row) => {
              const atp = Number(v);
              const onHand = Number(row.onHand);
              const label = `${atp} ${row.unit}`;
              if (onHand > 0 && atp < onHand) {
                return <span title="On hand minus reserved (for orders)">{label}</span>;
              }
              return label;
            },
          },
          { key: 'reorderLevel', label: 'Reorder at', render: (v, row) => `${v} ${row.unit}` },
          { key: 'palletCount', label: 'Pallets' },
          {
            key: 'stockStatus',
            label: 'Status',
            render: (v) => <StockStatusBadge status={v as 'OK' | 'LOW' | 'OUT'} />,
          },
          {
            key: 'actions',
            label: 'Actions',
            render: (_: unknown, row: Record<string, unknown>) => (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={(e) => { e.stopPropagation(); openPallets(row as unknown as InventoryItem); }}
              >
                {canAdjust ? 'Correct stock' : 'View pallets'}
              </button>
            ),
          },
        ]}
      />

      <Modal
        open={palletModal.open}
        title={palletModal.product ? `Stock — ${palletModal.product.name}` : 'Stock'}
        onClose={() => { setPalletModal({ open: false, product: null }); setAdjustPallet(null); }}
      >
        {adjustPallet ? (
          <>
            <p className="page-subtitle" style={{ marginBottom: 16 }}>
              Pallet {adjustPallet.pallet_id} — current quantity: {adjustPallet.quantity}
            </p>
            <form onSubmit={handleAdjust}>
              <div className="form-group">
                <label>Correct quantity</label>
                <input type="number" min="0" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Reason</label>
                <input value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="e.g. Cycle count correction" />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-outline" onClick={() => setAdjustPallet(null)}>Back</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save correction'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            {palletsLoading ? (
              <p className="page-subtitle">Loading pallets...</p>
            ) : pallets.length === 0 ? (
              <p className="page-subtitle">No pallets for this product.</p>
            ) : (
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>Lot</th>
                    <th>QC</th>
                    <th>Location</th>
                    <th>Qty</th>
                    <th>Status</th>
                    {canAdjust && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {pallets.map(p => (
                    <tr key={p.id}>
                      <td>{p.pallet_id}</td>
                      <td>{p.lot_number ?? '—'}</td>
                      <td>{p.qc_status ?? '—'}</td>
                      <td>{p.location_code ?? '—'}</td>
                      <td>{p.quantity}</td>
                      <td>{p.status}</td>
                      {canAdjust && (
                        <td>
                          <button className="btn btn-sm btn-outline" onClick={() => openAdjust(p)}>Adjust</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
