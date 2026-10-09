import test from 'node:test';
import assert from 'node:assert/strict';
import { orderDraftProblems, stockHoldProblems, orderCustomerEligible, filterSalesOrders, orderPage, salesOrdersForOrg } from '../src/lib/sales-order-rules.ts';

const draft = { date: '2026-10-09', customerId: 'p1', godownId: 'g1', notes: '', lines: [{ itemId: 'i1', uom: 'BAG', qty: 2.5, rate: 100.55, discountPct: 10 }] };
const item = { id: 'i1', name: 'Cement', active: true, baseUom: 'BAG', allowNegative: false, stock: [{ godownId: 'g1', onHand: 20, held: 8 }] };

test('well-formed sales order draft passes validation', () => {
  assert.deepEqual(orderDraftProblems(draft), []);
});
test('rejects bad dates, missing customer, godown and lines', () => {
  const problems = orderDraftProblems({ ...draft, date: '2026-02-30', customerId: '', godownId: '', lines: [] });
  for (const phrase of ['date', 'customer', 'godown', 'one item']) assert.ok(problems.some((p) => p.includes(phrase)));
});
test('rejects out-of-range rates and quantities, invalid precision and oversized notes', () => {
  for (const line of [
    { ...draft.lines[0], qty: 0 },
    { ...draft.lines[0], qty: -2 },
    { ...draft.lines[0], qty: 1.0005 },
    { ...draft.lines[0], rate: -10 },
    { ...draft.lines[0], rate: 3.456 },
    { ...draft.lines[0], discountPct: 101 },
    { ...draft.lines[0], discountPct: 1.234 },
    { ...draft.lines[0], qty: Infinity },
  ]) assert.ok(orderDraftProblems({ ...draft, lines: [line] }).length, JSON.stringify(line));
  assert.ok(orderDraftProblems({ ...draft, notes: 'x'.repeat(2001) }).length);
});
test('aggregates duplicate item lines against free stock', () => {
  assert.deepEqual(stockHoldProblems([{ itemId: 'i1', qty: 7 }, { itemId: 'i1', qty: 6 }], 'g1', [item]), ['Cement: need 13, free 12']);
  assert.deepEqual(stockHoldProblems([{ itemId: 'i1', qty: 7 }, { itemId: 'i1', qty: 5 }], 'g1', [item]), []);
});
test('godown-specific availability, negative-stock option and missing item', () => {
  assert.ok(stockHoldProblems([{ itemId: 'i1', qty: 1 }], 'g2', [item]).length);
  assert.deepEqual(stockHoldProblems([{ itemId: 'i1', qty: 100 }], 'g2', [{ ...item, allowNegative: true }]), []);
  assert.ok(stockHoldProblems([{ itemId: 'bad', qty: 1 }], 'g1', [item])[0].includes('not found'));
});
test('inactive items cannot be reserved', () => {
  assert.ok(stockHoldProblems([{ itemId: 'i1', qty: 1 }], 'g1', [{ ...item, active: false }])[0].includes('inactive'));
});
test('customer and dual-role party allowed; suppliers and blocked records rejected', () => {
  assert.equal(orderCustomerEligible('customer', false), true);
  assert.equal(orderCustomerEligible('both', false), true);
  assert.equal(orderCustomerEligible('customer', true), false);
  assert.equal(orderCustomerEligible('supplier', false), false);
  assert.equal(orderCustomerEligible('transporter', false), false);
});
test('search matches multiple tokens, filters status and sorts by date', () => {
  const orders = [
    { id: 'a', number: 'SO-4', date: '2026-10-01', customerName: 'Alpha Works', status: 'confirmed', grandTotal: 1 },
    { id: 'b', number: null, date: '2026-10-09', customerName: 'Alpha Industries', status: 'draft', grandTotal: 2 },
    { id: 'c', number: 'SO-3', date: '2026-10-03', customerName: 'Beta Works', status: 'confirmed', grandTotal: 3 },
  ];
  assert.deepEqual(filterSalesOrders(orders, 'all', 'alpha').map((o) => o.id), ['b', 'a']);
  assert.deepEqual(filterSalesOrders(orders, 'confirmed', 'works').map((o) => o.id), ['c', 'a']);
  assert.deepEqual(filterSalesOrders(orders, 'all', 'alpha so-4').map((o) => o.id), ['a']);
});
test('pagination bounds page and preserves complete ordered rows', () => {
  const rows = Array.from({ length: 51 }, (_, i) => i);
  assert.deepEqual(orderPage(rows, 3), { rows: [50], page: 3, totalPages: 3 });
  assert.deepEqual(orderPage(rows, 40), { rows: [50], page: 3, totalPages: 3 });
  assert.equal(orderPage([], 0).page, 1);
});
test('demo sales orders cannot leak across organisations', () => {
  const orders = [{ id: 'order1' }, { id: 'order2' }];
  const owners = { order1: 'org1', order2: 'org2' };
  assert.deepEqual(salesOrdersForOrg(orders, owners, 'org1'), [{ id: 'order1' }]);
  assert.deepEqual(salesOrdersForOrg(orders, owners, 'org2'), [{ id: 'order2' }]);
  assert.deepEqual(salesOrdersForOrg(orders, owners, 'org3'), []);
  assert.deepEqual(salesOrdersForOrg(orders, owners, ''), []);
});
