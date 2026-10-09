import test from 'node:test';
import assert from 'node:assert/strict';
import { transferProblems, transferDraftProblems, receiveProblems, receivedStatus, transfersForOrg, searchTransfers, isStuck } from '../src/lib/transfer-rules.ts';

const today = '2026-10-09';
const source = { id: 'g1', active: true };
const target = { id: 'g2', active: true };
const line = { itemId: 'it1', itemName: 'Steel', qty: 10, free: 50, trackBatches: true, batchNo: 'B1', batchQty: 30, active: true };
const draft = { date: today, fromId: 'g1', toId: 'g2', vehicleNo: '', reason: '' };
const check = (patch = {}, checks = [line], from = source, to = target) => transferDraftProblems({ ...draft, ...patch }, from, to, today, checks);

test('accepts valid active source, destination and allocated stock', () => assert.deepEqual(check(), []));
test('blocks identical warehouses, missing warehouses and inactive warehouses', () => {
  assert.ok(check({toId:'g1'}).some((x) => x.includes('different')));
  assert.ok(transferDraftProblems(draft, undefined, target, today, [line]).some((x) => x.includes('source')));
  assert.ok(check({}, [line], source, {...target, active:false}).some((x) => x.includes('destination')));
});
test('checks impossible and future business dates', () => {
  for (const date of ['2026-02-30', '2026-10-10', 'nonsense']) assert.ok(check({date}).some((x) => x.includes('transfer date')));
});
test('checks total item demand across repeated batches', () => {
  assert.ok(check({}, [{...line, qty: 27}, {...line, qty: 26, batchNo: 'B2', batchQty: 40}]).some((x) => x.includes('only 50 free')));
  assert.deepEqual(check({}, [{...line, qty: 18}, {...line, qty: 15, batchNo: 'B2', batchQty: 40}]), []);
});
test('checks aggregate batch demand across repeated batch rows', () => {
  assert.ok(check({}, [{...line, qty: 19}, {...line, qty: 16}]).some((x) => x.includes('batch B1 has only 30')));
});
test('requires batch and rejects made-up batches at source', () => {
  assert.ok(check({}, [{...line, batchNo:''}]).some((x) => x.includes('choose a batch')));
  assert.ok(check({}, [{...line, batchNo:'NO-SUCH-BATCH', batchQty:undefined}]).some((x) => x.includes('not available')));
});
test('blocks invalid and inactive items, negative, nan and overly precise quantities', () => {
  for (const qty of [-1, 0, NaN, Infinity, 0.0001, 1_000_000_000]) assert.ok(check({}, [{...line, qty}]).length, String(qty));
  assert.ok(check({}, [{...line, active:false}]).some((x) => x.includes('inactive')));
});
test('held stock is respected through free stock and no negative-stock bypass', () => assert.ok(transferProblems('g1','g2',[{...line,free:3}]).some((x) => x.includes('only 3 free'))));
test('enforces line count and field lengths', () => {
  assert.ok(check({}, []).length);
  assert.ok(check({}, Array(201).fill(line)).some((x) => x.includes('200')));
  assert.ok(check({vehicleNo:'a'.repeat(33)}).some((x) => x.includes('Vehicle')));
  assert.ok(check({reason:'a'.repeat(501)}).some((x) => x.includes('reason')));
});
test('received lines require an exact match to dispatched line count', () => {
  assert.ok(receiveProblems([{itemName:'Steel',sent:10,received:10}],2).some((x) => x.includes('every transfer line')));
  assert.ok(receiveProblems([],1).length);
});
test('receiving guards oversupply, invalid precision, negatives and NaN', () => {
  for (const received of [-1, 11, Infinity, NaN, 5.0001]) assert.ok(receiveProblems([{itemName:'Steel',sent:10,received}]).length,String(received));
});
test('shortage requires a bounded explanation and allows full delivery', () => {
  const row = { itemName:'Steel', sent:10, received:8 };
  assert.ok(receiveProblems([row]).some((x) => x.includes('reason')));
  assert.deepEqual(receiveProblems([{...row,reason:'Damaged'}]),[]);
  assert.ok(receiveProblems([{...row,reason:'x'.repeat(501)}]).length);
  assert.deepEqual(receiveProblems([{...row,received:10}]),[]);
});
test('receipt status distinguishes full from short delivery', () => {
  assert.equal(receivedStatus([{sent:10,received:10}]),'received');
  assert.equal(receivedStatus([{sent:10,received:9}]),'partially_received');
});
test('organisation-scoped records cannot leak into another org', () => {
  const ts = [{id:'a',number:'TRF-1',fromName:'A',toName:'B',vehicleNo:'ABC',status:'received',date:today},
    {id:'b',number:'TRF-2',fromName:'B',toName:'C',vehicleNo:'DEF',status:'in_transit',date:today}];
  const owned = transfersForOrg(ts,{a:'org1',b:'org2'},'org1');
  assert.deepEqual(owned.map((t) => t.id),['a']);
  assert.deepEqual(searchTransfers(owned,'def'),[]);
  assert.equal(searchTransfers(owned,'trf-1').length,1);
});
test('stuck-in-transit uses calendar-day differences', () => {
  assert.equal(isStuck('2026-10-05',today),true);
  assert.equal(isStuck('2026-10-08',today),false);
  assert.equal(isStuck('bad',today),false);
});
