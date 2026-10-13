import {Router} from "express";
import {createHash} from "node:crypto";
import {z} from "zod";
import {h} from "../http.js";
import {requirePerm} from "../auth.js";
import {rows,one,withConnection} from "../db.js";
import {ApiError} from "../errors.js";
import {DOC_TABLES,hydrateItems,rowToGodown,rowToParty,type DocKey} from "../uow.js";
import {invoiceAuditHandler} from "./invoice-audit.js";
import {buildGstr1,gstr1Rows,salesRegister,toCsv,validReportMonth} from "../shared/reports.js";
import {buildGstr3bWorkpaper,gstr3bWorkpaperRows} from "../shared/ca-reports.js";
import type {Invoice} from "../shared/types.js";

export const caRouter=Router();
caRouter.use((req,_res,next)=>{try{requirePerm(req.ctx,"caAudit","Your role cannot access the CA workspace");next();}catch(e){next(e);}});
const masters={items:"items",parties:"parties",warehouses:"godowns",units:"uoms",categories:"categories",brands:"brands",hsn:"hsn_rates",stockLedger:"stock_ledger"} as const;
const collections={...DOC_TABLES,...masters};
const collectionSchema=z.enum(Object.keys(collections) as [keyof typeof collections,...(keyof typeof collections)[]]);
caRouter.get("/overview",h(req=>withConnection(async conn=>{
  const counts:Record<string,number>={};for(const [key,table]of Object.entries(collections)){const r=await one(conn,`SELECT COUNT(*) AS n FROM ${table} WHERE org_id = ?`,[req.ctx.orgId]);counts[key]=Number(r?.["n"]??0);}
  return {orgId:req.ctx.orgId,role:req.ctx.role,readOnly:true,counts};
})));
caRouter.get("/records/:collection",h(req=>withConnection(async conn=>{
  const key=collectionSchema.parse(req.params["collection"]),table=collections[key];
  const query=z.object({after:z.string().max(40).optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).strict().parse(req.query);
  if(key==="stockLedger"&&query.after&&!/^\d+$/.test(query.after))throw new ApiError(422,"validation","Invalid stock ledger cursor");
  const doc=key in DOC_TABLES;
  const label=doc?(key==="advances"?"JSON_UNQUOTE(JSON_EXTRACT(body,'$.customerName'))":"number"):key==="hsn"?"description":key==="stockLedger"?"item_name":"name";
  const number=doc&&key!=="advances"?"number":key==="items"?"sku":["warehouses","units","hsn"].includes(key)?"code":key==="stockLedger"?"doc_no":"NULL";
  const result=await rows(conn,`SELECT CAST(id AS CHAR) AS id, ${label} AS label, ${number} AS number,
    ${doc?"doc_date":key==="stockLedger"?"at":"NULL"} AS date, ${doc?"status":"NULL"} AS status,
    ${doc?"total":"NULL"} AS total FROM ${table} WHERE org_id = ? ${query.after?"AND id > ?":""} ORDER BY id LIMIT ?`,query.after?[req.ctx.orgId,query.after,query.limit+1]:[req.ctx.orgId,query.limit+1]);
  const more=result.length>query.limit,page=result.slice(0,query.limit);
  return {collection:key,records:page,nextCursor:more?String(page[page.length-1]!["id"]):null};
})));
caRouter.get("/records/:collection/:id",h(req=>withConnection(async conn=>{
  const key=collectionSchema.parse(req.params["collection"]),id=String(req.params["id"]);
  if(key==="stockLedger"&&!/^\d+$/.test(id))throw new ApiError(422,"validation","Invalid ledger ID");
  const row=await one(conn,`SELECT * FROM ${collections[key]} WHERE org_id = ? AND id = ?`,[req.ctx.orgId,id]);
  if(!row)throw new ApiError(404,"not_found","Record not found in this organisation");
  if(key in DOC_TABLES)return {collection:key,record:typeof row["body"]==="string"?JSON.parse(row["body"]):row["body"]};
  if(key==="items")return {collection:key,record:(await hydrateItems(conn,[row]))[0]};
  if(key==="parties")return {collection:key,record:rowToParty(row)};
  if(key==="warehouses")return {collection:key,record:rowToGodown(row)};
  return {collection:key,record:row};
})));
caRouter.get("/invoices/:id/audit",invoiceAuditHandler);

caRouter.get("/reports/:report/export",h((req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const report=z.enum(["gstr1","gstr3b","sales"]).parse(req.params["report"]);
  const query=z.object({period:z.string().refine(validReportMonth,"Use YYYY-MM"),format:z.enum(["csv","json"]).default("csv")}).strict().parse(req.query);
  return withConnection(async conn=>{
    await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.beginTransaction();
    try{
      const org=await one(conn,"SELECT id, name, gstin FROM orgs WHERE id = ?",[req.ctx.orgId]);
      if(!org)throw new ApiError(404,"not_found","Organisation not found");
      const source=await rows(conn,"SELECT body FROM invoices WHERE org_id = ? AND doc_date >= ? AND doc_date < DATE_ADD(?, INTERVAL 1 MONTH) ORDER BY doc_date, number",[req.ctx.orgId,query.period+"-01",query.period+"-01"]);
      const invoices=source.map(r=>typeof r["body"]==="string"?JSON.parse(r["body"]):r["body"]) as Invoice[];
      const data=report==="gstr1"?buildGstr1(invoices,query.period,org["gstin"]):report==="gstr3b"?buildGstr3bWorkpaper(invoices,query.period):salesRegister(invoices);
      const metadata={report,orgId:req.ctx.orgId,organisation:org["name"],gstin:org["gstin"],period:query.period,generatedAt:new Date().toISOString(),generatorVersion:"ca-workpaper-v1",status:"DRAFT_WORKPAPER",notice:"Audit supporting workpaper; not a complete GST Portal upload or filed return."};
      const reportRows=report==="gstr1"?gstr1Rows(data as ReturnType<typeof buildGstr1>):report==="gstr3b"?gstr3bWorkpaperRows(data as ReturnType<typeof buildGstr3bWorkpaper>):(data as ReturnType<typeof salesRegister>).map(row=>({...row}));
      const context={report,organisation:org["name"],organisationId:req.ctx.orgId,organisationGSTIN:org["gstin"],reportingPeriod:query.period,generatedAtUTC:metadata.generatedAt,generatorVersion:metadata.generatorVersion,exportStatus:metadata.status,notice:metadata.notice};
      const content=query.format==="json"?JSON.stringify({metadata,data},null,2):toCsv((reportRows.length?reportRows:[{section:"NO_RECORDS"}]).map(row=>({...context,...row})));
      await conn.commit();
      return {filename:`ca-${report}-${query.period}.${query.format}`,mimeType:query.format==="csv"?"text/csv;charset=utf-8":"application/json",content,sha256:createHash("sha256").update(content).digest("hex"),metadata};
    }catch(error){await conn.rollback();throw error;}
  });
}));
