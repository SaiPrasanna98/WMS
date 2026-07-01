import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { WarehouseLocation } from '../types';
import { PageHeader, DataTable, SearchBar, Alert } from '../components/UI';

export function LocationsPage() {
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (typeFilter) params.set('type', typeFilter);
    setLoading(true);
    api.get(`/locations?${params}`)
      .then(res => setLocations(res.data))
      .catch(err => setAlert({ type: 'error', message: getErrorMessage(err) }))
      .finally(() => setLoading(false));
  }, [search, typeFilter]);

  return (
    <div>
      <PageHeader title="Locations" />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search locations..." />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="filter-select">
          <option value="">All Types</option>
          <option value="STORAGE">Storage</option>
          <option value="STAGING">Staging</option>
          <option value="PRODUCTION">Production</option>
          <option value="SHIPPING">Shipping</option>
          <option value="QC">QC</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        data={locations as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'code', label: 'Code' },
          { key: 'zone', label: 'Zone' },
          { key: 'aisle', label: 'Aisle' },
          { key: 'rack', label: 'Rack' },
          { key: 'location_type', label: 'Type', render: (v) => String(v).replace(/_/g, ' ') },
          { key: 'palletCount', label: 'Pallets' },
        ]}
      />
    </div>
  );
}
