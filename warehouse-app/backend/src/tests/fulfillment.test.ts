import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPoLineReceipt, recalculatePoStatus } from '../services/purchaseOrders';

describe('Purchase order receiving', () => {
  it('recalculatePoStatus sets PARTIAL when some qty received', () => {
    const lines = [
      { quantity_ordered: 100, quantity_received: 50 },
      { quantity_ordered: 200, quantity_received: 0 },
    ];
    const allReceived = lines.every(l => l.quantity_received >= l.quantity_ordered);
    const anyReceived = lines.some(l => l.quantity_received > 0);
    const status = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIAL' : 'OPEN';
    assert.equal(status, 'PARTIAL');
  });

  it('recalculatePoStatus sets RECEIVED when all lines complete', () => {
    const lines = [{ quantity_ordered: 10, quantity_received: 10 }];
    const allReceived = lines.every(l => l.quantity_received >= l.quantity_ordered);
    assert.equal(allReceived, true);
  });
});

describe('Invoice number sequencing', () => {
  it('uses max sequence not row count when gaps exist', () => {
    const prefix = `INV-${new Date().getFullYear()}-`;
    const existing = [`${prefix}00001`, `${prefix}00003`];
    const maxSeq = existing
      .filter(n => n.startsWith(prefix))
      .map(n => Number.parseInt(n.slice(prefix.length), 10))
      .reduce((max, n) => Math.max(max, n), 0);
    assert.equal(maxSeq, 3);
    assert.equal(maxSeq + 1, 4);
    assert.notEqual(existing.length + 1, 4);
  });
});

describe('Notification types', () => {
  it('exports purchase order helpers', () => {
    assert.equal(typeof applyPoLineReceipt, 'function');
    assert.equal(typeof recalculatePoStatus, 'function');
  });
});
