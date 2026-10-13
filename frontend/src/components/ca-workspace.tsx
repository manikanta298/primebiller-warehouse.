import {useEffect,useState} from "react";
import {useMutation,useQuery} from "@tanstack/react-query";
import {api,type CaExport} from "@/api/client";
import {getSession,useSession} from "@/lib/session";
import {download} from "@/lib/download";
import {indiaMasterDate} from "@/lib/master-rules";
import {validReportMonth} from "@/lib/reports";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";

const collections=[['invoices','Invoices'],['receipts','Receipts'],['advances','Advances'],['quotations','Quotations'],['salesOrders','Sales orders'],['challans','Challans'],['pos','Purchase orders'],['grns','Goods receipts'],['transfers','Transfers'],['adjustments','Stock adjustments'],['items','Items and stock'],['parties','Parties'],['warehouses','Warehouses'],['stockLedger','Stock ledger'],['units','Units'],['categories','Categories'],['brands','Brands'],['hsn','HSN rates']] as const;
export function CaWorkspace(){
  const session=useSession(),orgId=session?.orgId??"";
  const [period,setPeriod]=useState(indiaMasterDate().slice(0,7));
  const [auditCursors,setAuditCursors]=useState<string[]>([]);
  const [collection,setCollection]=useState('invoices'),[cursors,setCursors]=useState<string[]>([]);
  const [selected,setSelected]=useState<{orgId:string;collection:string;id:string}|null>(null);
  const [error,setError]=useState(''),[lastExport,setLastExport]=useState<CaExport|null>(null);
  useEffect(()=>{setCursors([]);setSelected(null);setLastExport(null);setError('');},[orgId,collection]);
  const overview=useQuery({queryKey:['ca',orgId,'overview'],queryFn:()=>api.caOverview(orgId),enabled:!!orgId});
  const records=useQuery({queryKey:['ca',orgId,'records',collection,cursors],queryFn:()=>api.caRecords(orgId,collection,cursors[cursors.length-1]),enabled:!!orgId});
  useEffect(()=>setAuditCursors([]),[selected,orgId]);
  const detail=useQuery({queryKey:['ca',orgId,'detail',selected],queryFn:()=>api.caRecord(orgId,selected!.collection,selected!.id),enabled:!!selected&&selected.orgId===orgId});
  const audit=useQuery({queryKey:['ca',orgId,'audit',selected?.id,auditCursors],queryFn:()=>api.caInvoiceAudit(orgId,selected!.id,auditCursors[auditCursors.length-1]),enabled:!!selected&&selected.orgId===orgId&&selected.collection==='invoices'});
  const exportReport=useMutation({mutationFn:({report,format}:{report:'gstr1'|'gstr3b'|'sales';format:'csv'|'json'})=>api.caExport(orgId,report,period,format),onSuccess:file=>{if(getSession()?.orgId!==file.metadata.orgId)return;download(file.filename,file.content,file.mimeType);setLastExport(file);setError('');},onError:(e:Error)=>setError(e.message)});
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Chartered Accountant workspace</h1><p className="mt-1 text-sm text-muted-foreground">Read-only access to business records in the selected organisation. Posted documents cannot be edited here.</p></div>
    <section className="rounded-lg border bg-card p-4 sm:p-6"><h2 className="text-lg font-semibold">Audit downloads</h2><p className="mt-1 text-sm text-muted-foreground">GSTR summaries are supporting workpapers. GSTR-3B marks ITC, RCM and other undetermined sections as pending review.</p>
      <div className="my-4 max-w-xs space-y-2"><Label htmlFor="ca-period">Reporting month</Label><Input id="ca-period" type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></div>
      <div className="grid gap-3 md:grid-cols-3">{([['gstr1','GSTR-1 summary'],['gstr3b','GSTR-3B summary'],['sales','Sales register']] as const).map(([report,label])=><div key={report} className="rounded-md border p-3"><h3 className="mb-3 font-medium">{label}</h3><div className="flex flex-wrap gap-2">{(['csv','json'] as const).map(format=><Button key={format} className="min-h-11" variant="outline" disabled={!validReportMonth(period)||exportReport.isPending} onClick={()=>exportReport.mutate({report,format})}>Download {label} {format.toUpperCase()}</Button>)}</div></div>)}</div>
      {lastExport&&<p className="mt-3 break-all text-xs text-muted-foreground">Downloaded {lastExport.filename}. SHA-256: {lastExport.sha256}</p>}
      {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
    <section className="rounded-lg border bg-card p-4 sm:p-6"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-lg font-semibold">Business records</h2><label className="flex flex-wrap items-center gap-2 text-sm">Record type<select aria-label="Record type" className="min-h-11 rounded-md border bg-background px-3" value={collection} onChange={e=>setCollection(e.target.value)}>{collections.map(([key,label])=><option key={key} value={key}>{label} ({overview.data?.counts[key]??'…'})</option>)}</select></label></div>
      {overview.error&&<p role="alert">{overview.error.message}</p>}{records.error&&<p role="alert">{records.error.message}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr>{['Record','Date','Status','Total','Action'].map(h=><th key={h} className="border-b p-3 text-left">{h}</th>)}</tr></thead><tbody>{records.data?.records.map(r=><tr key={r.id}><td className="border-b p-3">{r.number||r.label||r.id}{r.label&&r.label!==r.number&&<div className="text-xs text-muted-foreground">{r.label}</div>}</td><td className="border-b p-3">{r.date||'—'}</td><td className="border-b p-3">{r.status||'—'}</td><td className="border-b p-3">{r.total==null?'—':Number(r.total).toFixed(2)}</td><td className="border-b p-3"><Button className="min-h-11" variant="outline" size="sm" onClick={()=>setSelected({orgId,collection,id:r.id})}>View record</Button></td></tr>)}</tbody></table></div>
      {records.isPending&&<p className="py-4">Loading records…</p>}{records.data?.records.length===0&&<p className="py-4 text-muted-foreground">No records found.</p>}
      <div className="mt-4 flex gap-2"><Button variant="outline" disabled={!cursors.length} onClick={()=>setCursors(c=>c.slice(0,-1))}>Previous</Button><Button variant="outline" disabled={!records.data?.nextCursor} onClick={()=>setCursors(c=>[...c,records.data!.nextCursor!])}>Next</Button></div>
    </section>
    <Dialog open={!!selected&&selected.orgId===orgId} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Read-only record</DialogTitle><DialogDescription>Inspect the saved record and its available audit history. Changes are disabled.</DialogDescription></DialogHeader>{detail.error&&<p role="alert">{detail.error.message}</p>}{detail.data&&<><Button variant="outline" onClick={()=>download(`ca-${selected!.collection}-${selected!.id}.json`,JSON.stringify({orgId,collection:selected!.collection,record:detail.data!.record},null,2),'application/json')}>Download record JSON</Button><pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(detail.data.record,null,2)}</pre></>}{selected?.collection==='invoices'&&<div><h3 className="font-semibold">Invoice audit history</h3>{audit.error&&<p role="alert">{audit.error.message}</p>}{audit.data&&<><p className="my-2 text-xs text-muted-foreground">{audit.data.coverage}</p><pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(audit.data.events,null,2)}</pre><div className="mt-2 flex gap-2"><Button variant="outline" disabled={!auditCursors.length} onClick={()=>setAuditCursors(c=>c.slice(0,-1))}>Previous audit events</Button><Button variant="outline" disabled={!audit.data.nextCursor} onClick={()=>setAuditCursors(c=>[...c,audit.data!.nextCursor!])}>Next audit events</Button></div></>}</div>}</DialogContent></Dialog>
  </div>;
}
