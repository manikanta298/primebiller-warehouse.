import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveWarehouseCost, warehouseStockRow, warehouseUnitCost, warehouseStockValue } from '../src/lib/warehouse-stock.ts';
import { warehouseCatalogue } from '../src/lib/warehouse-dashboard-rules.ts';
import { itemStock } from '../src/lib/item-list-rules.ts';
import { dashboardInventory } from '../src/lib/dashboard-rules.ts';

const product = () => ({id:'i1',name:'Product',sku:'P1',category:'',brand:'',hsn:'1234',costPrice:10,stock:[
  {godownId:'g1',onHand:10,held:2,reorderLevel:1,maxLevel:100,unitCost:10},
  {godownId:'g2',onHand:30,held:4,reorderLevel:2,maxLevel:200,unitCost:20},
],batches:[]});
test('receipt and removal in one warehouse leave every field of the other warehouse and item default cost unchanged',()=>{
  const item=product(), other=structuredClone(item.stock[1]);
  receiveWarehouseCost(item,'g1',10,30); warehouseStockRow(item,'g1').onHand+=10;
  assert.deepEqual(item.stock[1],other); assert.equal(item.costPrice,10);
  assert.equal(warehouseUnitCost(item,'g1'),20);assert.equal(warehouseUnitCost(item,'g2'),20);
  assert.equal(warehouseStockValue(item,'g1'),400);assert.equal(warehouseStockValue(item,'g2'),600);
  warehouseStockRow(item,'g1').onHand-=3;
  assert.deepEqual(item.stock[1],other);assert.equal(itemStock(item,'g1').onHand,17);assert.equal(itemStock(item,'g2').free,26);
  assert.equal(warehouseCatalogue([item],'g2')[0].value,600);
  assert.equal(dashboardInventory([item],[{id:'g2',name:'Other'}],'g2',[]).stockValue,600);
});
test('a first receipt creates only its target row; legacy warehouse cost remains a read fallback',()=>{
  const item=product();delete item.stock[1].unitCost;
  const before=structuredClone(item.stock);
  receiveWarehouseCost(item,'g3',5,50);warehouseStockRow(item,'g3').onHand+=5;
  assert.deepEqual(item.stock.slice(0,2),before);
  assert.equal(warehouseUnitCost(item,'g3'),50);assert.equal(warehouseUnitCost(item,'g2'),10);
  for(const id of ['', 'all']) assert.throws(()=>warehouseStockRow(item,id),/one warehouse/);
});
test('explicit transfer cost uses the source cost and changes only the destination average on receipt',()=>{
  const item=product(); const sourceCost=warehouseUnitCost(item,'g1');
  warehouseStockRow(item,'g1').onHand-=4;
  const source=structuredClone(item.stock[0]);
  receiveWarehouseCost(item,'g2',3,sourceCost);warehouseStockRow(item,'g2').onHand+=3;
  assert.deepEqual(item.stock[0],source);assert.equal(warehouseUnitCost(item,'g2'),19.09);
  assert.equal(item.stock[1].onHand,33);assert.equal(item.stock[1].held,4);
});
