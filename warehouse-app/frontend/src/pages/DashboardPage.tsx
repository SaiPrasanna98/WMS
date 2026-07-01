import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { DashboardData } from '../types';
import { PageHeader } from '../components/UI';
import { StatusBadge } from '../components/StatusBadge';
import { ProductCell } from '../components/Cells';
import { formatTransactionType } from '../utils/labels';

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard')
      .then(res => setData(res.data))
      .catch(err => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return null;

  const cards = [
    { label: 'Units on hand', value: data.cards.totalInventory.toLocaleString() },
    { label: 'Active pallets', value: data.cards.palletsInWarehouse },
    { label: 'QC hold', value: data.cards.qcHoldItems },
    { label: 'Open production', value: data.cards.openProductionOrders },
    { label: 'Pending shipments', value: data.cards.pendingShipments },
    { label: 'Low stock', value: data.cards.lowStockCount },
  ];

  const fulfillmentCards = data.fulfillmentMetrics ? [
    { label: 'Orders today', value: data.fulfillmentMetrics.ordersReceivedToday },
    { label: 'Awaiting stock', value: data.fulfillmentMetrics.ordersAwaitingInventory },
    { label: 'Picking', value: data.fulfillmentMetrics.ordersBeingPicked },
    { label: 'Packing', value: data.fulfillmentMetrics.ordersBeingPacked },
    { label: 'Ready', value: data.fulfillmentMetrics.readyForPickup },
    { label: 'In transit', value: data.fulfillmentMetrics.inTransit },
    { label: 'Delivered today', value: data.fulfillmentMetrics.deliveredToday },
    { label: 'Delayed', value: data.fulfillmentMetrics.delayedOrders },
  ] : [];

  return (
    <div>
      <PageHeader title="Dashboard" />

      <div className="dashboard-cards dashboard-cards-compact">
        {cards.map(card => (
          <div key={card.label} className="stat-card stat-neutral">
            <div className="stat-content">
              <span className="stat-value">{card.value}</span>
              <span className="stat-label">{card.label}</span>
            </div>
          </div>
        ))}
      </div>

      {fulfillmentCards.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: 24 }}>Fulfillment</h3>
          <div className="dashboard-cards dashboard-cards-compact">
            {fulfillmentCards.map(card => (
              <div key={card.label} className="stat-card stat-neutral">
                <div className="stat-content">
                  <span className="stat-value">{card.value}</span>
                  <span className="stat-label">{card.label}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <h3>Recent activity</h3>
          {data.recentTransactions.length === 0 ? (
            <p className="empty-text">No recent activity</p>
          ) : (
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTransactions.map((tx, i) => (
                  <tr key={i}>
                    <td>{formatTransactionType(tx.transaction_type)}</td>
                    <td>{tx.sku}</td>
                    <td>{tx.quantity}</td>
                    <td>{new Date(tx.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="dashboard-panel">
          <h3>Low stock</h3>
          {data.lowStockItems.length === 0 ? (
            <p className="empty-text">All items above reorder level</p>
          ) : (
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Reorder at</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStockItems.map(item => (
                  <tr key={item.id}>
                    <td><ProductCell name={item.name} code={item.sku} /></td>
                    <td>{item.reorder_level} {item.unit_of_measure}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="dashboard-panel">
          <h3>Quality</h3>
          <div className="summary-list">
            {data.qcSummary.map(s => (
              <div key={s.qc_status} className="summary-item">
                <StatusBadge status={s.qc_status} type="qc" />
                <span className="summary-count">{s.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <h3>Shipments</h3>
          <div className="summary-list">
            {data.shipmentSummary.map(s => (
              <div key={s.status} className="summary-item">
                <StatusBadge status={s.status} type="shipment" />
                <span className="summary-count">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
