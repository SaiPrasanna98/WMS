interface PipelineStep {
  id: string;
  label: string;
  status: 'done' | 'active' | 'pending' | 'blocked' | 'skipped';
  detail?: string;
}

interface OrderPipeline {
  orderNumber: string;
  orderStatus: string;
  steps: PipelineStep[];
  promise: {
    estimatedPickDate?: string;
    estimatedPackDate?: string;
    estimatedShipDate?: string;
    estimatedDeliveryDate?: string;
    promiseNotes?: string;
  };
  invoice: { invoiceNumber?: string; status?: string; totalAmount?: number } | null;
  nextAction: string;
  blockers: string[];
}

const stepClass: Record<string, string> = {
  done: 'pipeline-step-done',
  active: 'pipeline-step-active',
  pending: 'pipeline-step-pending',
  blocked: 'pipeline-step-blocked',
  skipped: 'pipeline-step-skipped',
};

export function OrderPipelinePanel({ pipeline }: { pipeline: OrderPipeline | null }) {
  if (!pipeline) return null;

  return (
    <div className="settings-card" style={{ marginBottom: 16 }}>
      <h3 className="settings-card-title">Order journey (end-to-end)</h3>
      <p className="page-subtitle" style={{ marginBottom: 12 }}>
        <strong>Next:</strong> {pipeline.nextAction}
      </p>

      {pipeline.blockers.length > 0 && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          {pipeline.blockers.map((b, i) => <div key={i}>{b}</div>)}
        </div>
      )}

      <ol className="order-pipeline">
        {pipeline.steps.map(step => (
          <li key={step.id} className={`order-pipeline-step ${stepClass[step.status] ?? ''}`}>
            <span className="order-pipeline-label">{step.label}</span>
            {step.detail && <span className="order-pipeline-detail">{step.detail}</span>}
          </li>
        ))}
      </ol>

      <dl className="settings-dl" style={{ marginTop: 16 }}>
        <div className="settings-row"><dt>Est. delivery</dt><dd>{pipeline.promise.estimatedDeliveryDate ?? '—'}</dd></div>
        <div className="settings-row"><dt>Pick by</dt><dd>{pipeline.promise.estimatedPickDate ?? '—'}</dd></div>
        <div className="settings-row"><dt>Pack by</dt><dd>{pipeline.promise.estimatedPackDate ?? '—'}</dd></div>
        {pipeline.promise.promiseNotes && (
          <div className="settings-row"><dt>Capacity</dt><dd>{pipeline.promise.promiseNotes}</dd></div>
        )}
        {pipeline.invoice && (
          <div className="settings-row">
            <dt>Invoice</dt>
            <dd>{pipeline.invoice.invoiceNumber} — ${Number(pipeline.invoice.totalAmount).toFixed(2)} ({pipeline.invoice.status})</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
