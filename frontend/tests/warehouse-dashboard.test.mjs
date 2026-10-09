import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warehouseCatalogue, warehouseActivityFromLedger, warehouseActivityPeriod } from '../src/lib/warehouse-dashboard-rules.ts';

const makeItem = (id, stock = [], props = {}) => ({ id, sku: `SKU-${id}`, name: `Product ${id}`, brand: 'A', category: 'Goods', hsn: '1001', costPrice: 20, baseUom: 'PCS', stock, ...props });
const entry = (id, itemId, godownId, qty, at = '2026-10-09T11:30') => ({ id, at, docNo: `DOC-${id}`, docType: qty < 0 ? 'challan' : 'grn', type: qty < 0 ? 'DC_ISSUE' : 'PURCHASE_IN', itemId, itemName: itemId, godownId, godownName: godownId, qty, unitCost: 10, user: 'Storekeeper' });

test('new products appear at every warehouse even when they have no balance rows', () => {
  const rows = warehouseCatalogue([makeItem('new'), makeItem('old', [{ godownId: 'g1', onHand: 8, held: 2 }])], 'g2');
  assert.deepEqual(rows.map((r) => [r.item.id, r.onHand, r.free]), [['new', 0, 0], ['old', 0, 0]]);
});
test('warehouse quantities remain independent and reservations reduce free stock', () => {
  const item = makeItem('a', [{ godownId: 'g1', onHand: 10, held: 3 }, { godownId: 'g2', onHand: 5, held: 0 }]);
  assert.equal(warehouseCatalogue([item], 'g1')[0].free, 7);
  assert.equal(warehouseCatalogue([item], 'g2')[0].free, 5);
  assert.equal(warehouseCatalogue([item], 'g1')[0].value, 200);
});
test('filters use the selected warehouse free stock, including held and zero', () => {
  const items = [makeItem('zero'), makeItem('held', [{ godownId: 'g1', onHand: 2, held: 2 }]), makeItem('free', [{ godownId: 'g1', onHand: 2, held: 0 }])];
  assert.deepEqual(warehouseCatalogue(items, 'g1', '', 'available').map((r) => r.item.id), ['free']);
  assert.deepEqual(warehouseCatalogue(items, 'g1', '', 'zero').map((r) => r.item.id), ['held', 'zero']);
  assert.deepEqual(warehouseCatalogue(items, 'g1', '', 'reserved').map((r) => r.item.id), ['held']);
  assert.equal(warehouseCatalogue(items, 'g1', 'SKU-ZERO').length, 1);
});
test('movement dashboard ignores other warehouses and dates outside period', () => {
  const x = warehouseActivityFromLedger([entry('a', 'i1', 'g1', 5), entry('b', 'i1', 'g1', -3), entry('c', 'i1', 'g2', -70), entry('d', 'i1', 'g1', -15, '2026-08-01T10:00')], 'g1', '2026-09-10', '2026-10-09');
  assert.equal(x.incomingValue, 50);
  assert.equal(x.outgoingValue, 30);
  assert.equal(x.incomingMovements, 1);
  assert.equal(x.outgoingMovements, 1);
  assert.equal(x.recent.length, 2);
});
test('sale decreases stock at dispatch and is not double-counted when invoiced', () => {
  const postedDispatch = [entry('dc1', 'i1', 'g1', -2)];
  const beforeInvoice = warehouseActivityFromLedger(postedDispatch, 'g1', '2026-09-10', '2026-10-09');
  const afterInvoice = warehouseActivityFromLedger(postedDispatch, 'g1', '2026-09-10', '2026-10-09');
  assert.equal(afterInvoice.outgoingValue, beforeInvoice.outgoingValue);
  assert.equal(afterInvoice.outgoingMovements, 1);
});
test('cancelled dispatch reversal is incoming movement and restores net value', () => {
  const a = warehouseActivityFromLedger([entry('dc', 'i1', 'g1', -4), { ...entry('reverse', 'i1', 'g1', 4), type: 'DC_REVERSE' }], 'g1', '2026-09-10', '2026-10-09');
  assert.equal(a.incomingValue, a.outgoingValue);
});
test('30 day period includes today and previous 29 calendar days', () => {
  assert.equal(warehouseActivityPeriod('2026-10-09'), '2026-09-10');
});
