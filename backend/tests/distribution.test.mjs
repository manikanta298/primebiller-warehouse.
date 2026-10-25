import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
process.env.DATABASE_URL='mysql://test:test@localhost/test';
process.env.JWT_SECRET='x'.repeat(64);
const { queueDocument } = await import('../src/distribution.ts');
const { validSignature } = await import('../src/whatsapp-security.ts');
const { quotationContent, advanceDeliveryStatus, mayDecideRevision, normalizeWhatsappPhone } = await import('../src/shared/distribution-rules.ts');
const { documentPdf } = await import('../src/document-pdf.ts');
const { sendDocument, providerReady } = await import('../src/whatsapp-provider.ts');
const { pool } = await import('../src/db.ts');
const { crmRouter } = await import('../src/routes/crm.ts');
const { whatsappWebhookRouter } = await import('../src/routes/whatsapp-webhook.ts');
const { errorHandler } = await import('../src/errors.ts');
const express = (await import('express')).default;

const quote = {id:'q1', number:'QT1', date:'2026-10-25', validUntil:'2026-11-25',customerId:'c1',customerName:'Customer',godownId:'g1',notes:'',terms:'Terms',supply:'intra',placeOfSupplyCode:'36',grandTotal:100,status:'draft',lines:[{id:'line1',itemId:'i1',itemName:'Item',hsn:'1001',uom:'PCS',qty:1,rate:100,discountPct:0,gstRate:0,deliveredQty:0}]};
test('revision content ignores generated IDs but captures price, recipient and terms changes',()=>{
 assert.equal(quotationContent(quote),quotationContent({...quote,lines:[{...quote.lines[0],id:'new',deliveredQty:1}]}));
 for(const change of [{terms:'new'},{customerId:'other'},{lines:[{...quote.lines[0],rate:200}]}]) assert.notEqual(quotationContent(quote),quotationContent({...quote,...change}));
});
test('approval, phone and monotonic webhook rules fail closed',()=>{
 assert.equal(mayDecideRevision('Owner','u1','u1'),false);
 assert.equal(mayDecideRevision('Sales','u2','u1'),false);
 assert.equal(mayDecideRevision('Manager','u2','u1'),true);
 assert.equal(normalizeWhatsappPhone('+91 98765-43210'),'919876543210');
 for(const phone of ['9876543210','+00123','https://evil.test','+91<script>']) assert.equal(normalizeWhatsappPhone(phone),null);
 assert.equal(advanceDeliveryStatus('read','sent'),'read');
 assert.equal(advanceDeliveryStatus('delivered','failed'),'delivered');
 assert.equal(advanceDeliveryStatus('failed','delivered'),'delivered');
 assert.equal(advanceDeliveryStatus('accepted','sent'),'sent');
});
test('raw webhook verification rejects tampering, missing secret and malformed signatures',()=>{
 const raw=Buffer.from('{"entry":[]}'),secret='test-secret';
 const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 assert.equal(validSignature(raw,signature,secret),true);
 assert.equal(validSignature(Buffer.from('{}'),signature,secret),false);
 assert.equal(validSignature(raw,signature,''),false);
 assert.equal(validSignature(raw,'sha256=bad',secret),false);
});
test('document saves queue immutable snapshots once; revisions require approval and supersede stale work',async()=>{
 const records=[];
 const ctx={orgId:'o1',userId:'u1',userName:'Author'};
 const conn={query:async(sql,p)=>{
  if(sql.startsWith('SELECT version, content_hash')) return [[...records].filter(r=>r.document_type===p[1]).slice(-1),[]];
  if(sql.startsWith('SELECT body FROM org_settings')) return [[{body:{legalName:'Business'}}],[]];
  if(sql.startsWith('SELECT name')) return [[{name:'Business'}],[]];
  if(sql.startsWith('UPDATE document_distributions')) {for(const r of records) if(r.document_type===p[1] && ['queued','pending_approval'].includes(r.status)) r.status='superseded';return [{},[]];}
  if(sql.startsWith('INSERT INTO document_distributions')) {records.push({document_type:p[1],version:p[3],content_hash:p[4],snapshot:JSON.parse(p[5]),status:p[9]});return [{},[]];}
  throw new Error(sql);
 }};
 const u={ctx,conn,party:async()=>({id:'c1',name:'Customer'})};
 await queueDocument(u,'quotation',quote);assert.equal(records[0].status,'queued');
 await queueDocument(u,'quotation',{...quote,lines:[{...quote.lines[0],id:'another'}]});assert.equal(records.length,1);
 await queueDocument(u,'quotation',{...quote,terms:'Updated'});assert.equal(records[0].status,'superseded');assert.equal(records[1].status,'pending_approval');
 assert.equal(records[0].snapshot.document.terms,'Terms');assert.equal(records[1].version,2);
 await queueDocument(u,'invoice',{...quote,id:'inv1'});await queueDocument(u,'invoice',{...quote,id:'inv1',status:'paid'});
 assert.equal(records.filter(r=>r.document_type==='invoice').length,1);
});
test('CRM HTTP endpoints enforce author separation, current revision, tenant scope and consent validation',async()=>{
 let actor='u1',role='Owner';const row={version:2,status:'pending_approval',author_id:'u1'};
 const original=pool.getConnection;
 pool.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,p)=>{
  if(sql.startsWith('SELECT body FROM quotations'))return [p[0]==='o1'?[{body:quote}]:[],[]];
  if(sql.startsWith('SELECT * FROM document_distributions'))return [[row],[]];
  if(sql.startsWith('UPDATE document_distributions SET status = ?')){row.status=p[0];row.decision_by=p[1];return [{},[]];}
  if(sql.startsWith('SELECT * FROM parties'))return [p[0]==='o1'?[{id:'c1',kind:'customer',name:'Customer'}]:[],[]];
  throw new Error(sql);
 }});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.ctx={orgId:req.header('x-org-id')||'o1',userId:actor,userName:'Actor',role};next();});app.use(crmRouter);app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const req=async(path,body,method='POST',org='o1')=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Org-Id':org},body:JSON.stringify(body)});
 try {
  const path='/distribution/quotation/q1/2/decision',body={approve:true,reason:'Reviewed exact version'};
  assert.equal((await req(path,body)).status,403);actor='u2';role='Sales';assert.equal((await req(path,body)).status,403);
  role='Manager';assert.equal((await req(path.replace('/2/','/1/'),body)).status,409);
  assert.equal((await req(path,body,'POST','other')).status,404);
  assert.equal((await req(path,body)).status,200);assert.equal(row.status,'queued');assert.equal(row.decision_by,'u2');
  assert.equal((await req(path,body)).status,409);
  assert.equal((await req('/parties/c1/communication',{enabled:true,phone:'9876543210',evidence:'Permission'},'PUT')).status,422);
 }finally{server.close();pool.getConnection=original;}
});
test('unsigned webhook requests and invalid subscription tokens are rejected before database access',async()=>{
 const app=express();app.use('/webhook',whatsappWebhookRouter);app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/webhook`;
 try {assert.equal((await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal((await fetch(base+'?hub.mode=subscribe&hub.verify_token=wrong')).status,403);}finally{server.close();}
});
test('PDF is generated from snapshot and provider payload uses exact version, PDF and recipient',async()=>{
 const pdf=await documentPdf({document:quote,business:{name:'Test Business'},customer:{}},'quotation',2);
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);
 const old=global.fetch,calls=[];
 Object.assign(process.env,{WHATSAPP_ENABLED:'true',WHATSAPP_ORG_ID:'o1',WHATSAPP_ACCESS_TOKEN:'test',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_GRAPH_VERSION:'v24.0',WHATSAPP_APP_SECRET:'test',WHATSAPP_VERIFY_TOKEN:'test',WHATSAPP_QUOTATION_TEMPLATE:'quote_document',WHATSAPP_INVOICE_TEMPLATE:'invoice_document'});
 assert.equal(providerReady('other'),false);assert.equal(providerReady('o1'),true);
 global.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(calls.length===1?{id:'media1'}:{messages:[{id:'wamid.test'}]}),{status:200});};
 try {assert.equal(await sendDocument({document_type:'quotation',version:2},{document:quote,business:{},customer:{}},'919876543210'),'wamid.test');const payload=JSON.parse(calls[1].options.body);assert.equal(payload.to,'919876543210');assert.equal(payload.template.components[1].parameters[2].text,'2');assert.equal(payload.template.components[0].parameters[0].document.id,'media1');
 global.fetch=async(url)=>{if(url.endsWith('/media'))return new Response('{"id":"media"}');throw new Error('timeout');};await assert.rejects(sendDocument({document_type:'quotation',version:2},{document:quote},'919876543210'),e=>e.uncertain===true);
 }finally{global.fetch=old;delete process.env.WHATSAPP_ENABLED;}
});
test('worker fails closed without consent/provider and never replays processing jobs',async()=>{
 const {processNext}=await import('../src/notification-worker.ts');
 const originalQuery=pool.query,originalConn=pool.getConnection;
 const row={org_id:'o1',document_type:'quotation',document_id:'q1',version:1,status:'queued',customer_id:'c1',snapshot:{document:quote},attempts:0};
 let calls=0;
 const query=async(sql,p=[])=>{
  if(sql.startsWith('SELECT org_id, document_type'))return [row.status==='queued'?[structuredClone(row)]:[],[]];
  if(sql.startsWith('SELECT body'))return [[{body:quote}],[]];
  if(sql.startsWith('SELECT * FROM document_distributions'))return [[structuredClone(row)],[]];
  if(sql.startsWith('SELECT MAX'))return [[{version:1}],[]];
  if(sql.startsWith('SELECT enabled'))return [[{enabled:0,phone:'+919876543210'}],[]];
  if(sql.startsWith("UPDATE document_distributions SET status = 'processing'")){row.status='processing';row.attempts++;return [{},[]];}
  if(sql.startsWith('UPDATE document_distributions SET status = ?')){row.status=p[0];row.error_code=p[1];return [{},[]];}
  throw new Error(sql);
 };
 const originalFetch=global.fetch;global.fetch=async()=>{calls++;throw new Error('must not send');};
 pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
 try {assert.equal(await processNext(),true);assert.equal(row.status,'blocked');assert.equal(row.error_code,'consent_or_phone_required');assert.equal(calls,0);assert.equal(row.attempts,1);row.status='processing';assert.equal(await processNext(),false);assert.equal(calls,0);}
 finally{pool.query=originalQuery;pool.getConnection=originalConn;global.fetch=originalFetch;}
});
