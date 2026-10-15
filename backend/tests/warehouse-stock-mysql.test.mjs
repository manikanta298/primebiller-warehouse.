import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applySchema } from '../src/schema-migration.ts';
process.env.DATABASE_URL='mysql://test:test@localhost/test';
process.env.JWT_SECRET='a'.repeat(64);
const {saveItem}=await import('../src/uow.ts');
test('MySQL warehouse cost migration preserves quantities; concurrent warehouse saves never overwrite other balances',{
  skip:!process.env.MYSQL_MIGRATION_TEST_URL,
},async()=>{
  const url=new URL(process.env.MYSQL_MIGRATION_TEST_URL);assert.match(url.pathname,/^\/migration_test[a-z0-9_]*$/i);
  const mysql=await import('mysql2/promise');const db=mysql.createPool({...{uri:process.env.MYSQL_MIGRATION_TEST_URL},decimalNumbers:true});
  const sql=readFileSync(new URL('../db/migrations/007_warehouse_stock_isolation.sql',import.meta.url),'utf8');
  try{
    await db.query('DROP TABLE IF EXISTS item_stock');
    await db.query('CREATE TABLE item_stock (org_id VARCHAR(40),item_id VARCHAR(40),godown_id VARCHAR(40),on_hand DECIMAL(18,3),held DECIMAL(18,3),reorder_level DECIMAL(18,3),max_level DECIMAL(18,3),PRIMARY KEY(org_id,item_id,godown_id)) ENGINE=InnoDB');
    await db.query("INSERT INTO item_stock VALUES ('org1','i1','g1',10,2,1,100),('org1','i1','g2',30,4,2,200)");
    const [before]=await db.query('SELECT * FROM item_stock ORDER BY godown_id');
    await applySchema(sql,db);await applySchema(sql,db);
    const [after]=await db.query('SELECT * FROM item_stock ORDER BY godown_id');
    assert.deepEqual(after.map(({unit_cost,...r})=>r),before);assert.ok(after.every(r=>r.unit_cost===null));
    const original={id:'i1',costPrice:10,batches:[],stock:after.map(r=>({godownId:r.godown_id,onHand:r.on_hand,held:r.held,reorderLevel:r.reorder_level,maxLevel:r.max_level}))};
    async function change(gid,delta,cost){
      const conn=await db.getConnection();const item=structuredClone(original);const row=item.stock.find(r=>r.godownId===gid);row.onHand+=delta;row.unitCost=cost;
      try{await conn.beginTransaction();await saveItem(conn,'org1',item,original);await conn.commit();}catch(e){await conn.rollback();throw e;}finally{conn.release();}
    }
    await Promise.all([change('g1',5,12),change('g2',-3,20)]);
    const [result]=await db.query('SELECT * FROM item_stock ORDER BY godown_id');
    assert.deepEqual(result.map(r=>[r.godown_id,r.on_hand,r.held,r.unit_cost]),[['g1',15,2,12],['g2',27,4,20]]);
    assert.deepEqual(result.map(r=>[r.reorder_level,r.max_level]),[[1,100],[2,200]]);
  }finally{await db.query('DROP TABLE IF EXISTS item_stock');await db.end();}
});
