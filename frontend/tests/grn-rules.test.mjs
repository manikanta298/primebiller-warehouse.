import test from 'node:test';
import assert from 'node:assert/strict';
import { grnDraftProblems, grnsForOrg, filterGrns } from '../src/lib/grn-rules.ts';
import { apportionFreight, weightedAverageCost } from '../src/lib/purchase-rules.ts';

const today = '2026-10-09';
const supplier = { id: 's1', kind: 'supplier', blocked: false };
const godown = { id: 'g1', active: true };
const items = [
  { id: 'it1', name: 'Steel', active: true, trackBatches: true, batches: [{batchNo: 'H123', godownId: 'g1', mfgDate: '2026-01-01', expiryDate: '2027-01-01'}] },
  { id: 'it2', name: 'Bolts', active: true, trackBatches: false, batches: [] },
];
const line = { poLineId: undefined, itemId: 'it1', received: 10, rejected: 1, rate: 100, batchNo: 'H123', mfgDate: '2026-01-01', expiryDate: '2027-01-01', rejectionReason: 'Damaged' };
const base = { date: today, supplierId: 's1', godownId: 'g1', supplierInvoiceNo: 'INV-100', supplierInvoiceDate: '2026-10-08', vehicleNo: '', freight: 50, lines: [line] };
const validate = (changes = {}, s = supplier, g = godown, catalog = items, po = undefined, previous = []) => grnDraftProblems({ ...base, ...changes }, s, g, catalog, po, today, previous);

 test('valid direct GRN with rejected items and freight', () => assert.deepEqual(validate(), []));
 test('rejects impossible, future and invoice-after-receipt dates', () => {
  for (const date of ['2026-02-30', '2026-10-10', 'bad']) assert.ok(validate({ date }).some((e) => e.includes('receipt date')));
  assert.ok(validate({ supplierInvoiceDate: '2026-10-10' }).some((e) => e.includes('invoice date')));
  assert.ok(validate({ supplierInvoiceDate: '2026-02-30' }).some((e) => e.includes('invoice date')));
 });
 test('requires active supplier and godown', () => {
  assert.ok(grnDraftProblems(base, undefined, godown, items, undefined, today).some((e) => e.includes('supplier')));
  assert.ok(validate({}, { ...supplier, blocked: true }).length);
  assert.ok(validate({}, { ...supplier, kind: 'customer' }).length);
  assert.ok(validate({}, supplier, { ...godown, active: false }).length);
 });
 test('rejects supplier invoice duplicates by same supplier case-insensitively', () => {
  assert.ok(validate({}, supplier, godown, items, undefined, [{ supplierId: 's1', supplierInvoiceNo: 'inv-100 ' }]).some((e) => e.includes('already')));
  assert.deepEqual(validate({}, supplier, godown, items, undefined, [{ supplierId: 's2', supplierInvoiceNo: 'INV-100' }]), []);
 });
 test('rejects invalid quantities, fractional precision and rate', () => {
  for (const changes of [{received: 0},{received: -1},{received: Infinity},{received: 0.0005},{rejected: -1},{rejected: 11},{rejected: 0.0001},{rate: 0},{rate: 1.001},{rate: Infinity}])
    assert.ok(validate({lines:[{...line, ...changes}]}).length, JSON.stringify(changes));
 });
 test('only accepted stock needs batch; rejection needs explanation', () => {
  assert.ok(validate({lines:[{...line, batchNo:''}]}).some((e) => e.includes('batch')));
  assert.ok(validate({lines:[{...line, rejectionReason:''}]}).some((e) => e.includes('rejection')));
  assert.deepEqual(validate({freight:0, lines:[{...line, rejected:10, rejectionReason:'Rejected', batchNo:''}]}), []);
 });
 test('prevents conflicting batch metadata and expired or future-dated batches', () => {
  assert.ok(validate({ lines:[{...line, mfgDate:'2026-02-01'}] }).some((e) => e.includes('existing batch')));
  assert.ok(validate({ lines:[{...line, expiryDate:'2026-07-01'}] }).some((e) => e.includes('expiry')));
  assert.ok(validate({ lines:[{...line, mfgDate:'2026-10-10'}] }).some((e) => e.includes('manufacturing')));
 });
 test('prevents duplicate item + batch receipt lines', () => {
  assert.ok(validate({lines:[line, {...line}]}).some((e) => e.includes('repeated')));
  assert.deepEqual(validate({freight:0, lines:[line, {...line, batchNo:'H125', mfgDate:'', expiryDate:''}]}), []);
 });
 test('validates linked PO lifecycle supplier/warehouse and line item', () => {
  const po = { status:'open', supplierId:'s1', godownId:'g1', lines:[{id:'pl1', itemId:'it1', qty:20, receivedQty:5}] };
  const linked = {...base, poId:'p1', lines:[{...line,poLineId:'pl1'}]};
  assert.deepEqual(validate(linked, supplier, godown, items, po), []);
  assert.ok(validate({...linked,lines:[{...line,poLineId:'incorrect'}]}, supplier, godown, items, po).some((e)=>e.includes('purchase order')));
  assert.ok(validate(linked,supplier,godown,items,{...po,status:'draft'}).some((e)=>e.includes('Approve')));
  assert.ok(validate(linked,supplier,godown,items,{...po,godownId:'g2'}).some((e)=>e.includes('match')));
  assert.ok(validate(linked,supplier,godown,items,undefined).some((e)=>e.includes('not found')));
 });
 test('adds repeated receipt quantities before checking PO remaining', () => {
  const po={status:'partially_received',supplierId:'s1',godownId:'g1',lines:[{id:'pl1',itemId:'it1',qty:20,receivedQty:5}]};
  const linked={poId:'p1',freight:0,lines:[{...line,poLineId:'pl1',received:9,rejected:0,rejectionReason:''}, {...line,poLineId:'pl1',received:7,rejected:0,rejectionReason:'',batchNo:'H999',mfgDate:'',expiryDate:''}]};
  assert.ok(validate(linked,supplier,godown,items,po).some((e)=>e.includes('Combined')));
 });
 test('does not allow freight on fully rejected receipts', () => assert.ok(validate({lines:[{...line,rejected:10}],freight:0.01}).some((e)=>e.includes('Freight'))));
 test('rejects extra long values, empty and too many lines', () => {
   assert.ok(validate({ supplierInvoiceNo:' ' }).length);
   assert.ok(validate({ lines: [] }).length);
   assert.ok(validate({ lines:Array(201).fill(line) }).length);
   assert.ok(validate({ freight:1.001 }).length);
   assert.ok(validate({ vehicleNo:'x'.repeat(40) }).length);
 });
 test('zero accepted rows do not receive freight drift', () => {
  assert.deepEqual(apportionFreight([100, 200, 0], 0.01), [0, 0.01, 0]);
  assert.equal(apportionFreight([0, 0], 20).reduce((a,b)=>a+b,0), 0);
  assert.equal(weightedAverageCost(10, 100, 10, 200), 150);
 });
 test('GRN organisation scoping and direct/linked list filters', () => {
  const rows = [{id:'a',number:'GRN-1',date:'2026-10-09',supplierName:'Steel',supplierInvoiceNo:'S1',godownName:'North',poNumber:'PO-1'},
    {id:'b',number:'GRN-2',date:'2026-10-08',supplierName:'Bolt',supplierInvoiceNo:'B1',godownName:'South'}];
  assert.deepEqual(grnsForOrg(rows,{a:'org1',b:'org2'},'org1').map((r)=>r.id),['a']);
  assert.deepEqual(grnsForOrg(rows,{a:'org1'},'').map((r)=>r.id),[]);
  assert.deepEqual(filterGrns(rows,'steel','linked').map((r)=>r.id),['a']);
  assert.deepEqual(filterGrns(rows,'','direct').map((r)=>r.id),['b']);
 });
