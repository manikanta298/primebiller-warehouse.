import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FindItems } from "@/routes/_authenticated/find-items";
import { ItemPicker } from "@/components/app/ItemPicker";
const items=[{id:'i1',name:'Cement Bag',sku:'CE001',hsn:'2523',brand:'Demo',category:'Building',salePrice:100,baseUom:'BAG',active:true,stock:[{godownId:'g1',onHand:10,held:4,reorderLevel:1,maxLevel:100}]},{id:'i2',name:'Cable',sku:'CA001',hsn:'1234',brand:'Demo',category:'Electrical',salePrice:50,baseUom:'MTR',active:true,stock:[]}];
const nav=vi.hoisted(()=>vi.fn());
vi.mock('@/api/client',()=>({api:{listItems:async()=>items}}));
vi.mock('@/lib/session',()=>({useSession:()=>({orgId:'org1',godownId:'all'})}));
vi.mock('@tanstack/react-router',()=>({createFileRoute:()=> (options:unknown)=>options,useNavigate:()=>nav,Link:({children,to,params,...props}:any)=><a {...props} href={`${to}:${params.id}`}>{children}</a>}));
afterEach(()=>{cleanup();nav.mockClear()});
const wrap=(child:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{child}</QueryClientProvider>);
describe('Find Items and item picker',()=>{
 it('shows matching items after two letters with highlighted text and free stock',async()=>{
  wrap(<FindItems/>);const search=screen.getByLabelText('Find items');fireEvent.change(search,{target:{value:'CE'}});
  const link=await screen.findByRole('link',{name:/Cement/});expect(link.querySelector('mark')).toHaveTextContent('Ce');expect(link).toHaveTextContent('Free stock: 6');
  expect(screen.queryByRole('link',{name:/Cable/})).toBeNull();fireEvent.keyDown(search,{key:'Enter'});expect(nav).toHaveBeenCalledWith({to:'/items/$id',params:{id:'i1'}});
 });
 it('item picker matches mixed case and selects the highlighted item on Enter',async()=>{
  const pick=vi.fn();wrap(<ItemPicker value='' godownId='g1' onPick={pick}/>);const search=screen.getByLabelText('Search item');fireEvent.focus(search);fireEvent.change(search,{target:{value:'cE'}});
  const option=await screen.findByRole('option');expect(option).toHaveAttribute('aria-selected','true');expect(option.querySelector('mark')).toHaveTextContent('Ce');fireEvent.keyDown(search,{key:'Enter'});expect(pick).toHaveBeenCalledWith(items[0]);
 });
});
