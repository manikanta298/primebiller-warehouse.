import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustmentProblems, adjustmentDraftProblems, adjustmentValue, needsApproval,
  canApproveAdjustment, adjustmentsForOrg, searchAdjustments,
} from '../src/lib/adjustment-rules.ts';

const today = '2026-10-09';
const godown = { active: true };
const input = { date: today, godownId: 'g1', reason: 'damage', notes: '' };
const down = { itemId: 'i1', itemName: 'Steel', active: true, direction: 'down', qty: 4, onHand: 12, held: 3, unitCost: 30, trackBatches: true, batchNo: 'LOT-A', batchQty: 8 };
const up = { ...down, direction: 'up', unitCost: 32.50, batchNo: 'NEW-LOT', batchQty: undefined };
const check = (rows = [down], patch = {}, g = godown) => adjustmentDraftProblems({ ...input, ...patch }, g, today, rows);

test('accepts a stock write-off with adequate free and batch quantities', () => {
  assert.deepEqual(check(), []);
  assert.deepEqual(check([{ ...down, trackBatches: false, batchNo: undefined }]), []);
});
test('rejects invalid, inactive or missing godowns', () => {
  assert.ok(adjustmentDraftProblems(input, undefined, today, [down]).some(x => x.includes('active godown')));
  assert.ok(check([down], {}, {active:false}).some(x => x.includes('active godown')));
});
test('rejects invalid or future adjustment business dates', () => {
  for (const date of ['2026-02-30', '2026-10-10', '', '2026-01-39']) assert.ok(check([down], {date}).some(x => x.includes('adjustment date')), date);
});
test('aggregates repeated down lines at the item level instead of bypassing availability', () => {
  const lines = [{ ...down, qty: 5 }, { ...down, qty: 5, batchNo:'LOT-B', batchQty: 7 }];
  assert.ok(check(lines).some(x => x.includes('only 9 free')));
  assert.deepEqual(check([{...lines[0],qty:4}, {...lines[1],qty:4}]), []);
});
test('aggregates repeated batch reductions before posting', () => {
  assert.ok(check([{ ...down, qty: 5 }, { ...down, qty: 5 }]).some(x => x.includes('batch LOT-A has only 8')));
});
test('ignores opposite-direction gains when testing free stock', () => {
  assert.ok(check([{ ...down, direction: 'down', qty: 10 }, { ...up, direction: 'up', qty: 10 }], {reason:'correction'}).some(x => x.includes('only 9 free')));
});
test('prevents reductions from reserved stock even if on-hand covers them', () => {
  assert.ok(check([{ ...down, qty: 10, batchQty: 20 }]).some(x => x.includes('only 9 free')));
});
test('requires tracked batches and refuses unknown depletion batch', () => {
  assert.ok(check([{ ...down, batchNo: '' }]).some(x => x.includes('choose a batch')));
  assert.ok(check([{ ...down, batchNo: 'WRONG', batchQty: undefined }]).some(x => x.includes('not available')));
});
test('accepts a new batch when increasing tracked stock', () => {
  assert.deepEqual(check([up], {reason:'found'}), []);
});
test('checks reason/direction pairing and rejects invalid reason', () => {
  assert.ok(check([up]).some(x => x.includes('cannot increase')));
  assert.ok(check([down], {reason:'found'}).some(x => x.includes('cannot reduce')));
  assert.ok(check([down], {reason:'unknown'}).some(x => x.includes('Choose an adjustment reason')));
});
test('rejects infinite, zero, overly large, negative and over-precise quantities', () => {
  for (const qty of [0, -1, Infinity, NaN, 1.0001, 1_000_000_000]) assert.ok(check([{...down,qty}]).length, String(qty));
});
test('rejects invalid up cost including fractional paise', () => {
  for (const unitCost of [0, -1, NaN, Infinity, 1.001, 1_000_000_000]) assert.ok(check([{...up,unitCost}], {reason:'found'}).length, String(unitCost));
});
test('rejects inactive item, excess lines, notes and batch number', () => {
  assert.ok(check([{ ...down, active: false }]).some(x => x.includes('inactive')));
  assert.ok(check(Array(201).fill(down)).some(x => x.includes('200 lines')));
  assert.ok(check([down], {notes:'x'.repeat(501)}).some(x => x.includes('Notes')));
  assert.ok(check([{...down,batchNo:'x'.repeat(101)}]).some(x => x.includes('batch number')));
});
test('values adjustments by direction and ignores invalid quantities in previews', () => {
  const r = adjustmentValue([{direction:'up',qty:2,unitCost:50},{direction:'down',qty:3,unitCost:20},{direction:'up',qty:NaN,unitCost:5}]);
  assert.deepEqual(r,{up:100,down:60,net:40,gross:160});
});
test('role-based approval is for above threshold and only Owner/Manager may decide', () => {
  assert.equal(needsApproval('Storekeeper',25000),false);
  assert.equal(needsApproval('Storekeeper',25000.01),true);
  assert.equal(needsApproval('Manager',40000),false);
  assert.equal(needsApproval('Storekeeper',200,100),true);
  assert.equal(canApproveAdjustment('Owner'),true);
  assert.equal(canApproveAdjustment('Storekeeper'),false);
});
test('filters tenant-owned adjustments before applying search', () => {
  const rows=[{id:'a',number:'ADJ-01',date:today,godownName:'A',reason:'damage',createdBy:'Alice',status:'posted'},
              {id:'b',number:'ADJ-02',date:today,godownName:'B',reason:'found',createdBy:'Bob',status:'posted'}];
  const owned=adjustmentsForOrg(rows,{a:'org1',b:'org2'},'org1');
  assert.deepEqual(owned.map(x=>x.id),['a']);
  assert.equal(searchAdjustments(owned,'bob').length,0);
  assert.equal(searchAdjustments(owned,'damage').length,1);
  assert.equal(searchAdjustments(owned,'adj-01').length,1);
});
