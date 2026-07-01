export function ProductCell({ name, code }: { name: string; code?: string }) {
  return (
    <div className="cell-stack">
      <span className="cell-primary">{name}</span>
      {code && <span className="cell-secondary">{code}</span>}
    </div>
  );
}

export function StockStatusBadge({ status }: { status: 'OK' | 'LOW' | 'OUT' }) {
  const cls = status === 'OK' ? 'badge-success' : status === 'LOW' ? 'badge-warning' : 'badge-danger';
  const label = status === 'OK' ? 'In stock' : status === 'LOW' ? 'Low stock' : 'Out of stock';
  return <span className={`badge ${cls}`}>{label}</span>;
}
