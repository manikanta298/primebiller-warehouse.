import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planFifoAllocations, dispatchPlanProblems, dispatchTransportProblems, challansForOrg, filterChallans, canCancelTestEwb,
} from '../src/lib/challan-rules.ts';

const order = [
  { id: 'l1', itemId: 'a', qty: 8, deliveredQty: 1 },
  { id: 'l2', itemId: 'a', qty: 8, deliveredQty: 0 },
  { id: 'l3', itemId: 'b', qty: 10, deliveredQty: 0 },
];
const items = [
  { id: 'a', name: 'Steel', trackBatches: true, allowNegative: false, stock: [{ godownId: 'g1', onHand: 15 }],
    batches: [{ batchNo: 'OLD', godownId: 'g1', qty: 8, receivedDate: '2026-01-01' }, { batchNo: 'NEW', godownId: 'g1', qty: 7, receivedDate: '2026-02-01' }] },
  { id: 'b', name: 'Cement', trackBatches: false, allowNegative: false, stock: [{ godownId: 'g1', onHand: 10 }], batches: [] },
];
const draft = [{ soLineId: 'l1', qty: 7, allocations: [{ batchNo: 'OLD', qty: 7 }] }, { soLineId: 'l2', qty: 8, allocations: [{ batchNo: 'OLD', qty: 1 }, { batchNo: 'NEW', qty: 7 }] }];
const errors = (d, reason, its = items) => dispatchPlanProblems(d, order, its, 'g1', reason);

test('consecutive FIFO allocation splits a shared batch across repeated item order lines', () => {
  assert.deepEqual(planFifoAllocations(draft, order, items, 'g1'), { l1: [{ batchNo: 'OLD', qty: 7 }], l2: [{ batchNo: 'OLD', qty: 1 }, { batchNo: 'NEW', qty: 7 }] });
  assert.deepEqual(errors(draft), []);
});
test('duplicate sales-order line cannot bypass pending quantity', () => {
  const bad = [...draft, { soLineId: 'l1', qty: 7, allocations: [{ batchNo: 'NEW', qty: 7 }] }];
  assert.ok(errors(bad).some((e) => e.includes('more than once')));
});
test('aggregate stock is checked across two sales-order lines for the same item', () => {
  const its = [{ ...items[0], stock: [{ godownId: 'g1', onHand: 14 }] }, items[1]];
  assert.ok(errors(draft, undefined, its).some((e) => e.includes('only 14 on hand')));
});
test('aggregate batch usage cannot exceed available batch stock', () => {
  const bad = [ { ...draft[0], allocations: [{ batchNo: 'OLD', qty: 7 }] }, { ...draft[1], allocations: [{ batchNo: 'OLD', qty: 8 }] } ];
  assert.ok(errors(bad, 'Requested different batch').some((e) => e.includes('batch OLD has 8')));
});
test('wrong godown, unknown batch, general allocation for tracked item all rejected', () => {
  for (const allocations of [[{ batchNo: 'WRONG', qty: 7 }], [{ qty: 7 }]]) {
    assert.ok(errors([{ ...draft[0], allocations }], 'Manual override valid').length);
  }
  assert.ok(errors([{ ...draft[0], allocations: [{ batchNo: 'NEW', qty: 7 }] }], 'Switched batches').some((e) => e.includes('FIFO')) === false);
});
test('manual FIFO override needs a meaningful reason', () => {
  const override = [{ soLineId: 'l1', qty: 7, allocations: [{ batchNo: 'NEW', qty: 7 }] }];
  assert.ok(errors(override).some((e) => e.includes('reason')));
  assert.deepEqual(errors(override, 'Customer asked for new heat'), []);
});
test('non-batch items require general stock and matching quantity', () => {
  assert.deepEqual(errors([{ soLineId: 'l3', qty: 4, allocations: [{ qty: 4 }] }]), []);
  assert.ok(errors([{ soLineId: 'l3', qty: 4, allocations: [{ batchNo: 'OLD', qty: 4 }] }], 'By request').some((e) => e.includes('not batch tracked')));
});
test('rejects fractional-overprecision, Infinity, NaN, negative and over-pending quantities', () => {
  for (const qty of [0, -1, Infinity, NaN, 1.0011, 8]) assert.ok(errors([{ soLineId: 'l1', qty, allocations: [{ batchNo: 'OLD', qty }] }]).length, String(qty));
});
test('transport validation rejects invalid vehicle, bad phone and unsafe distance', () => {
  const t = { vehicleNo: 'TS09EA1234', driverName: 'Driver', driverPhone: '9999999999', transporter: 'Self', distanceKm: 20 };
  assert.deepEqual(dispatchTransportProblems(t, 75000), []);
  assert.ok(dispatchTransportProblems({ ...t, vehicleNo: 'invalid' }, 70000).some((x) => x.includes('vehicle')));
  assert.ok(dispatchTransportProblems({ ...t, driverPhone: '123' }, 70000).some((x) => x.includes('phone')));
  assert.ok(dispatchTransportProblems({ ...t, distanceKm: 0 }, 70000).some((x) => x.includes('Distance')));
  assert.ok(dispatchTransportProblems({ ...t, distanceKm: Infinity }, 0).length);
});
test('EWB cancellation window excludes future timestamps and 24 hours elapsed', () => {
  assert.equal(canCancelTestEwb('2026-10-09T10:00:00Z', '2026-10-09T10:30:00Z'), true);
  assert.equal(canCancelTestEwb('2026-10-09T10:00:00Z', '2026-10-10T10:00:00Z'), false);
  assert.equal(canCancelTestEwb('2026-10-09T10:00:00Z', '2026-10-09T09:59:00Z'), false);
});
test('demo challan tenant filtering does not expose another organisation', () => {
  const c = [{ id: 'c1' }, { id: 'c2' }], owners = { c1: 'org1', c2: 'org2' };
  assert.deepEqual(challansForOrg(c, owners, 'org1'), [{ id: 'c1' }]);
  assert.deepEqual(challansForOrg(c, owners, 'org2'), [{ id: 'c2' }]);
  assert.deepEqual(challansForOrg(c, owners, ''), []);
});
test('challan search matches order, customer, vehicle, warehouse, status and date', () => {
  const base = { customerName: 'Alpha Works', soNumber: 'SO-1', godownName: 'Main', vehicleNo: 'TS09EA1234', status: 'in_transit' };
  const rows = [{ ...base, id: 'a', number: 'DC-1', date: '2026-10-01' }, { ...base, id: 'b', number: 'DC-2', date: '2026-10-03', customerName: 'Beta Works', status: 'delivered' }];
  assert.deepEqual(filterChallans(rows, 'all', 'alpha ts09').map((x) => x.id), ['a']);
  assert.deepEqual(filterChallans(rows, 'delivered', '').map((x) => x.id), ['b']);
});
