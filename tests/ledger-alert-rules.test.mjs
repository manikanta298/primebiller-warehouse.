import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, stockLedgerCsv, computeAlerts, daysBetween } from '../src/lib/stock-rules.ts';

const rows = [
  {id:'10',at:'2026-09-01T10:00',docNo:'OPEN',type:'OPENING',itemId:'i1',godownId:'g1',qty:10},
  {id:'11',at:'2026-09-05T10:00',docNo:'PO-1',type:'PURCHASE_IN',itemId:'i1',godownId:'g1',qty:6},
  {id:'12',at:'2026-09-06T10:00',docNo:'DC-1',type:'DC_ISSUE',itemId:'i1',godownId:'g1',qty:-4},
  {id:'13',at:'2026-09-07T10:00',docNo:'PO-2',type:'PURCHASE_IN',itemId:'i1',godownId:'g1',qty:2},
  {id:'14',at:'2026-09-08T10:00',docNo:'ADJ-1',type:'ADJ_OUT',itemId:'i1',godownId:'g1',qty:-3},
  {id:'15',at:'2026-09-08T10:00',docNo:'DC-2',type:'DC_ISSUE',itemId:'i1',godownId:'g2',qty:-10},
  {id:'16',at:'2026-09-08T10:00',docNo:'DC-3',type:'DC_ISSUE',itemId:'i2',godownId:'g1',qty:-8},
].map((x)=>({ itemName:'Steel',godownName:x.godownId,batchNo:'LOT-A',unitCost:12,user:'John',docType:'adjustment',...x}));
const filtered = (f={}) => buildLedger(rows,{itemId:'i1',godownId:'g1',...f});

test('ledger uses all movements for true running and closing balance even when type filtered',()=>{
  const x=filtered({type:'PURCHASE_IN'});
  assert.deepEqual(x.rows.map(r=>[r.id,r.running]),[['11',16],['13',14]]);
  assert.equal(x.closing,11);assert.equal(x.totalIn,8);assert.equal(x.totalOut,0);
});
test('ledger document filter does not erase intervening movements',()=>{
  const x=filtered({docNo:'PO-2'});
  assert.deepEqual(x.rows.map(r=>r.running),[14]);assert.equal(x.closing,11);
});
test('date-filtered ledger opens with real pre-period balance from every type',()=>{
  const x=filtered({from:'2026-09-07',to:'2026-09-07',type:'PURCHASE_IN'});
  assert.equal(x.opening,12); assert.equal(x.rows[0].running,14);assert.equal(x.closing,14);
});
test('closing respects to-date and does not include future movements',()=>{
  assert.equal(filtered({to:'2026-09-06'}).closing,12);
});
test('ledger isolates requested item, godown and batch',()=>{
  assert.equal(filtered().closing,11);
  assert.equal(filtered({batchNo:'OTHER'}).closing,0);
  assert.equal(filtered({godownId:'g2'}).closing,-10);
});
test('ledger sorts equal timestamp by numeric id for stable balances',()=>{
  const x=buildLedger([rows[0],{...rows[1],at:'2026-09-02T10:00',id:'10b'}, {...rows[2],at:'2026-09-02T10:00',id:'2'}],{itemId:'i1',godownId:'g1'});
  assert.equal(x.rows.length,3);
});
test('CSV exports displayed movements only and hides balances when item not chosen',()=>{
  const text=stockLedgerCsv(filtered({type:'PURCHASE_IN'}).rows,false);
  assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes('PO-1'));assert.ok(!text.includes('DC-1'));
  assert.ok(!text.includes('"16"'));assert.equal(text.trim().split('\r\n').length,3);
});
test('CSV escapes quotes and neutralizes spreadsheet formulas in untrusted document and username text',()=>{
  const x=stockLedgerCsv([{...rows[1],docNo:'=1+2',itemName:'x"x',user:'@run',running:16}],true);
  assert.ok(x.includes('"\'=1+2"'));assert.ok(x.includes('"x""x"'));assert.ok(x.includes('"\'@run"'));
});
const godowns=[{id:'g1',name:'Main'},{id:'g2',name:'Other'}];
const item=(overrides={})=>({id:'i1',name:'TMT steel',sku:'T-1',baseUom:'KG',costPrice:50,active:true,stock:[{godownId:'g1',onHand:4,held:3,reorderLevel:10}],batches:[],...overrides});
const alerts=(items=[item()],acks=new Set())=>computeAlerts(items,godowns,'2026-10-09',acks);
test('alert free stock subtracts reserved stock and values reorder shortfall',()=>{
  const a=alerts()[0]; assert.equal(a.kind,'below_reorder');assert.equal(a.qty,1);
  assert.equal(a.shortfall,9);assert.equal(a.valueAtRisk,450);
});
test('out of stock emitted even with zero reorder threshold',()=>{
  const a=alerts([item({stock:[{godownId:'g1',onHand:0,held:0,reorderLevel:0}]})])[0];
  assert.equal(a.kind,'out_of_stock');assert.equal(a.shortfall,0);
});
test('alert acknowledgement uses exact active alert id without altering the inventory',()=>{
  const a=alerts()[0];
  assert.equal(alerts([item()],new Set([a.id]))[0].acknowledged,true);
  assert.equal(alerts()[0].acknowledged,false);
});
test('alert scope only includes supplied warehouses and active items',()=>{
  const gs=[{id:'g2',name:'Other'}];
  assert.equal(computeAlerts([item()],gs,'2026-10-09',new Set()).length,0);
  assert.equal(alerts([item({active:false})]).length,0);
});
test('expired and aged batch alerts use calendar dates',()=>{
  const batch={id:'b1',godownId:'g1',batchNo:'H1',qty:2,expiryDate:'2026-10-02',receivedDate:'2026-01-01'};
  const a=alerts([item({stock:[],batches:[batch]})]);
  assert.deepEqual(a.map(x=>x.kind),['near_expiry','over_aged']);
  assert.equal(a[0].daysLeft,-7);assert.equal(daysBetween('2026-10-01','2026-10-09'),8);
});
test('excludes depleted batches and warehouses outside scope',()=>{
  const a=alerts([item({stock:[],batches:[{id:'b1',godownId:'g1',qty:0,receivedDate:'2020-01-01',expiryDate:'2026-10-02'}]})]);
  assert.equal(a.length,0);
});
