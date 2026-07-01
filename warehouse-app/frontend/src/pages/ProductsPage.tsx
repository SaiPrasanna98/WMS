import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { Product } from '../types';
import { useAuth } from '../context/AuthContext';
import { PageHeader, DataTable, SearchBar, Alert, Modal } from '../components/UI';
import { ProductCell } from '../components/Cells';
import { formatProductType } from '../utils/labels';

export function ProductsPage() {
  const { hasPermission, isViewer } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ sku: '', name: '', productType: 'RAW_MATERIAL', unitOfMeasure: 'EA', reorderLevel: 0, description: '' });

  const loadProducts = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (typeFilter) params.set('type', typeFilter);
    api.get(`/products?${params}`)
      .then(res => setProducts(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProducts(); }, [search, typeFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/products', form);
      setAlert({ type: 'success', message: 'Product added' });
      setModalOpen(false);
      setForm({ sku: '', name: '', productType: 'RAW_MATERIAL', unitOfMeasure: 'EA', reorderLevel: 0, description: '' });
      loadProducts();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  return (
    <div>
      <PageHeader
        title="Products"
        action={hasPermission('products.write') && !isViewer && (
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>Add product</button>
        )}
      />

      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="filter-select">
          <option value="">All types</option>
          <option value="RAW_MATERIAL">Raw material</option>
          <option value="FINISHED_GOOD">Finished good</option>
          <option value="PACKAGING">Packaging</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        data={products as unknown as Record<string, unknown>[]}
        columns={[
          {
            key: 'name',
            label: 'Product',
            render: (_, row) => <ProductCell name={String(row.name)} code={String(row.sku)} />,
          },
          { key: 'product_type', label: 'Type', render: (v) => formatProductType(String(v)) },
          { key: 'currentInventory', label: 'On hand', render: (v, row) => `${v ?? 0} ${row.unit_of_measure}` },
          { key: 'reorder_level', label: 'Reorder at', render: (v, row) => `${v} ${row.unit_of_measure}` },
        ]}
      />

      <Modal open={modalOpen} title="Add product" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleCreate} className="form">
          <div className="form-group">
            <label>Product name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Product code</label>
              <input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} required placeholder="e.g. RM-001" />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={form.productType} onChange={e => setForm({ ...form, productType: e.target.value })}>
                <option value="RAW_MATERIAL">Raw material</option>
                <option value="FINISHED_GOOD">Finished good</option>
                <option value="PACKAGING">Packaging</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Unit</label>
              <input value={form.unitOfMeasure} onChange={e => setForm({ ...form, unitOfMeasure: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Reorder level</label>
              <input type="number" value={form.reorderLevel} onChange={e => setForm({ ...form, reorderLevel: Number(e.target.value) })} />
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
