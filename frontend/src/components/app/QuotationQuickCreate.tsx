import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Item, Party, PartyInput } from "@/api/types";
import { normaliseParty, partyProblems, PARTY_STATE_NAMES } from "@/lib/party-rules";
import { HSN_PATTERN } from "@/lib/gst";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function QuickCustomer({ stateCode, onCreated, onClose }: { stateCode: string; onCreated: (party: Party) => void; onClose: () => void }) {
  const [data,setData] = useState<PartyInput>({ kind: "customer", name: "", phone: "", email: "", city: "", address: "", stateCode, gstin: "", pan: "", creditLimit: 0, creditDays: 30, blocked: false });
  const set = (patch: Partial<PartyInput>) => setData(d => ({...d,...patch}));
  const save = useMutation({ mutationFn: async () => { const problems=partyProblems(data); if(problems.length) throw new Error(problems[0]); return api.saveParty(normaliseParty(data)); }, onSuccess: onCreated });
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Create customer</DialogTitle><DialogDescription>Save a new customer and use it in this quotation immediately. GSTIN and PAN are optional.</DialogDescription></DialogHeader><form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending} className="contents">
    <label className="text-sm">Name<Input aria-label="New customer name" required maxLength={200} value={data.name} onChange={e=>set({name:e.target.value})}/></label>
    <label className="text-sm">Phone<Input aria-label="New customer phone" maxLength={40} value={data.phone} onChange={e=>set({phone:e.target.value})}/></label>
    <label className="text-sm">Email<Input aria-label="New customer email" type="email" maxLength={190} value={data.email??""} onChange={e=>set({email:e.target.value})}/></label>
    <label className="text-sm">State<select aria-label="New customer state" required className="min-h-11 w-full rounded border bg-background px-2" value={data.stateCode} onChange={e=>set({stateCode:e.target.value})}><option value="">Choose state</option>{Object.entries(PARTY_STATE_NAMES).map(([code,name])=><option key={code} value={code}>{name} ({code})</option>)}</select></label>
    <label className="text-sm">City<Input aria-label="New customer city" maxLength={120} value={data.city} onChange={e=>set({city:e.target.value})}/></label>
    <label className="text-sm">Address<Input aria-label="New customer address" maxLength={400} value={data.address??""} onChange={e=>set({address:e.target.value})}/></label>
    <label className="text-sm">GSTIN (optional)<Input aria-label="New customer GSTIN" maxLength={15} value={data.gstin??""} onChange={e=>set({gstin:e.target.value.toUpperCase()})}/></label>
    <label className="text-sm">PAN (optional)<Input aria-label="New customer PAN" maxLength={10} value={data.pan??""} onChange={e=>set({pan:e.target.value.toUpperCase()})}/></label>
    {save.error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{save.error.message}</p>}<div className="flex gap-2 sm:col-span-2"><Button disabled={save.isPending} type="submit">{save.isPending?"Creating…":"Create and select customer"}</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button></div>
  </fieldset></form></DialogContent></Dialog>;
}
export function QuickItem({ onCreated, onClose }: { onCreated:(item:Item)=>void; onClose:()=>void }) {
  const [data,setData]=useState<Omit<Item,"id"|"stock"|"batches">>({name:"",sku:"",hsn:"",baseUom:"PCS",gstRate:0,salePrice:0,costPrice:0,brand:"",category:"",conversions:[],allowNegative:false,trackBatches:false,active:true});
  const set=(patch:Partial<typeof data>)=>setData(d=>({...d,...patch}));
  const save=useMutation({mutationFn:()=>{if(!HSN_PATTERN.test(data.hsn)) throw new Error("HSN must contain 4, 6 or 8 digits"); return api.createItem({...data,name:data.name.trim(),sku:data.sku.trim(),baseUom:data.baseUom.trim()});},onSuccess:onCreated});
  return <Dialog open onOpenChange={open=>{if(!open&&!save.isPending)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Create item</DialogTitle><DialogDescription>The new item will be selected on this quotation line. Creating an item does not add stock.</DialogDescription></DialogHeader><form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending} className="contents">
    <label className="text-sm">Name<Input aria-label="New item name" required maxLength={200} value={data.name} onChange={e=>set({name:e.target.value})}/></label><label className="text-sm">SKU<Input aria-label="New item SKU" required maxLength={80} value={data.sku} onChange={e=>set({sku:e.target.value})}/></label>
    <label className="text-sm">HSN<Input aria-label="New item HSN" required maxLength={8} value={data.hsn} onChange={e=>set({hsn:e.target.value})}/></label><label className="text-sm">Base unit<Input aria-label="New item unit" required maxLength={12} value={data.baseUom} onChange={e=>set({baseUom:e.target.value.toUpperCase()})}/></label>
    <label className="text-sm">Sale price<Input aria-label="New item sale price" type="number" min={0} step="0.01" required value={data.salePrice} onChange={e=>set({salePrice:Number(e.target.value)})}/></label><label className="text-sm">GST rate %<Input aria-label="New item GST rate" type="number" min={0} max={28} step="0.01" required value={data.gstRate} onChange={e=>set({gstRate:Number(e.target.value)})}/></label>
    {save.error&&<p role="alert" className="text-sm text-destructive sm:col-span-2">{save.error.message}</p>}<div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={save.isPending}>{save.isPending?"Creating…":"Create and select item"}</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button></div>
  </fieldset></form></DialogContent></Dialog>;
}
