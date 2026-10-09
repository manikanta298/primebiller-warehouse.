import test from 'node:test';
import assert from 'node:assert/strict';
import { poDraftProblems, poWorkflowProblems, purchaseOrdersForOrg, filterPurchaseOrders } from '../src/lib/purchase-rules.ts';
import { computeTotals, supplyType } from '../src/lib/gst.ts';

const today = '2026-10-09';
const supplier = { id: 'sup1', kind: 'supplier', stateCode: '36', blocked: false };
const godown = { id: 'g1', active: true };
const catalog = [{ id: 'it1', name: 'Steel bar', active: true }, { id: 'it2', name: 'Cement', active: true }];
const draft = { date: today, supplierId: 'sup1', godownId: 'g1', notes: '', lines: [{ itemId: 'it1', qty: 1.25, rate: 72.50 }] };
const check = (changes = {}, s = supplier, g = godown, items = catalog) => poDraftProblems({ ...draft, ...changes }, s, g, items, today);

test('valid PO with 3-decimal quantity and 2-decimal prices is accepted', () => {
  assert.deepEqual(check(), []);
  assert.deepEqual(check({ lines: [{ itemId: 'it1', qty: 0.001, rate: 0 }] }), []);
});
test('rejects impossible or future order dates', () => {
  for (const date of ['2026-02-30', '2026-10-10', 'not-a-date']) assert.ok(check({ date }).some((v) => v.toLowerCase().includes('date')));
});
test('supplier must be eligible, unblocked, and in current organisation', () => {
  for (const s of [undefined, { ...supplier, kind: 'customer' }, { ...supplier, blocked: true }]) assert.ok(poDraftProblems(draft, s, godown, catalog, today).some((v) => v.includes('active supplier')));
  assert.deepEqual(check({}, { ...supplier, kind: 'both' }), []);
});
test('delivery warehouse must exist and be active', () => {
  assert.ok(poDraftProblems(draft, supplier, undefined, catalog, today).some((v) => v.includes('godown')));
  assert.ok(check({}, supplier, { ...godown, active: false }).some((v) => v.includes('godown')));
});
test('rejects unknown, inactive and cross-org catalog items', () => {
  assert.ok(check({ lines: [{ itemId: 'foreign', qty: 1, rate: 9 }] }).some((v) => v.includes('active item')));
  assert.ok(check({}, supplier, godown, [{ ...catalog[0], active: false }]).length);
});
test('rejects duplicate item IDs, avoiding ambiguous PO to GRN links', () => {
  assert.ok(check({ lines: [draft.lines[0], { itemId: 'it1', qty: 2, rate: 8 }] }).some((v) => v.includes('duplicate')));
});
test('rejects fractional precision errors, negative, infinite, and oversized quantities', () => {
  for (const qty of [0, -1, 1.0005, Infinity, NaN, 1_000_000_000]) assert.ok(check({ lines: [{ itemId: 'it1', qty, rate: 1 }] }).length);
  for (const rate of [-1, 2.345, NaN, Infinity, 1_000_000_000]) assert.ok(check({ lines: [{ itemId: 'it1', qty: 1, rate }] }).length);
});
test('requires complete lines and limits size and notes', () => {
  assert.ok(check({ lines: [] }).length);
  assert.ok(check({ lines: new Array(201).fill({ itemId: 'it1', qty: 1, rate: 1 }) }).length);
  assert.ok(check({ notes: 'x'.repeat(2001) }).length);
});
test('only drafts can be approved', () => {
  const po = { status: 'draft', lines: [{ receivedQty: 0 }], grns: [] };
  assert.deepEqual(poWorkflowProblems(po, 'approve'), []);
  assert.ok(poWorkflowProblems({ ...po, status: 'open' }, 'approve').length);
});
test('cancellation needs a reason and no receipt activity', () => {
  const po = { status: 'open', lines: [{ receivedQty: 0 }], grns: [] };
  assert.deepEqual(poWorkflowProblems(po, 'cancel', 'Supplier delay'), []);
  assert.ok(poWorkflowProblems(po, 'cancel', 'bad').length);
  assert.ok(poWorkflowProblems({ ...po, status: 'partially_received' }, 'cancel', 'Supplier delay').length);
  assert.ok(poWorkflowProblems({ ...po, grns: [{ id: 'g1' }] }, 'cancel', 'Supplier delay').length);
  assert.ok(poWorkflowProblems({ ...po, lines: [{ receivedQty: 1 }] }, 'cancel', 'Supplier delay').length);
});
test('PO organisation ownership prevents cross-tenant list and detail discovery', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'missing' }];
  assert.deepEqual(purchaseOrdersForOrg(rows, { a: 'org1', b: 'org2' }, 'org1'), [{ id: 'a' }]);
  assert.deepEqual(purchaseOrdersForOrg(rows, { a: 'org1' }, ''), []);
});
test('list search and status filters preserve most recent-first sorting', () => {
  const rows = [
    { number: 'PO/001', date: '2026-10-02', supplierName: 'Steel Works', godownName: 'North', status: 'open' },
    { number: 'PO/002', date: '2026-10-08', supplierName: 'Steel Works', godownName: 'South', status: 'draft' },
    { number: 'PO/003', date: '2026-10-09', supplierName: 'Other Supplier', godownName: 'South', status: 'cancelled' },
  ];
  assert.deepEqual(filterPurchaseOrders(rows, 'steel works', 'all').map((r) => r.number), ['PO/002', 'PO/001']);
  assert.deepEqual(filterPurchaseOrders(rows, '', 'draft').map((r) => r.number), ['PO/002']);
  assert.deepEqual(filterPurchaseOrders(rows, 'south', 'all').map((r) => r.number), ['PO/003', 'PO/002']);
});
test('GST estimates calculate intra-state and interstate taxes consistently', () => {
  const lines = [{ qty: 3, rate: 100, gstRate: 18, discountPct: 0 }];
  const intra = computeTotals(lines, supplyType('36', '36'));
  const inter = computeTotals(lines, supplyType('36', '37'));
  assert.equal(intra.grandTotal, inter.grandTotal);
  assert.equal(intra.cgst + intra.sgst, inter.igst);
  assert.equal(intra.grandTotal, 354);
});
