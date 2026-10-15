import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FindItems } from "@/routes/_authenticated/find-items";
import { ItemsPage } from "@/routes/_authenticated/items.index";
import { ItemPicker } from "@/components/app/ItemPicker";
const items=[{id:'i1',name:'Cement Bag',sku:'CE001',hsn:'2523',brand:'Demo',category:'Building',salePrice:100,baseUom:'BAG',gstRate:18,costPrice:10,active:true,stock:[{godownId:'g1',onHand:10,held:4,reorderLevel:1,maxLevel:100},{godownId:'g2',onHand:40,held:5,reorderLevel:1,maxLevel:100,unitCost:20}]},{id:'i2',name:'Cable',sku:'CA001',hsn:'1234',brand:'Demo',category:'Electrical',salePrice:50,baseUom:'MTR',gstRate:18,costPrice:5,active:true,stock:[]}];
const nav=vi.hoisted(()=>vi.fn());
const scope=vi.hoisted(()=>({gid:"g1",update:vi.fn()}));
vi.mock('@/api/client',()=>({api:{listItems:async()=>items,listGodowns:async()=>[{id:"g1",name:"Warehouse 1"}]}}));
vi.mock('@/lib/session',()=>({useSession:()=>({orgId:'org1',godownId:scope.gid,user:{id:'u1',role:'Owner'}}),updateSession:scope.update}));
vi.mock('@tanstack/react-router',()=>({createFileRoute:()=> (options:unknown)=>options,useNavigate:()=>nav,Link:({children,to,params,...props}:any)=><a {...props} href={`${to}:${params?.id ?? ""}`}>{children}</a>}));
beforeEach(()=>{scope.gid="g1";scope.update.mockClear();});
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

it('does not combine warehouse stock when no warehouse is selected',async()=>{
 scope.gid="all";wrap(<FindItems/>);fireEvent.change(screen.getByLabelText('Find items'),{target:{value:'CE'}});
 const link=await screen.findByRole('link',{name:/Cement/});expect(link).toHaveTextContent('Select a warehouse to view availability');expect(link).not.toHaveTextContent('Free stock: 6');
 fireEvent.change(screen.getByLabelText('Inventory warehouse'),{target:{value:'g1'}});expect(scope.update).toHaveBeenCalledWith({godownId:'g1'});
});

it('item catalogue suppresses global quantities and shows only the selected warehouse',async()=>{
 scope.gid="all";let view=wrap(<ItemsPage/>);
 let row=await screen.findByRole('row',{name:/Cement Bag/});let cells=within(row).getAllByRole('cell');
 expect(cells[3]).toHaveTextContent('—');expect(cells[4]).toHaveTextContent('—');expect(cells[5]).toHaveTextContent('—');
 expect(screen.queryByLabelText('Inventory summary')).toBeNull();expect(screen.getByRole('button',{name:'Export CSV'})).toBeDisabled();
 view.unmount();scope.gid="g2";wrap(<ItemsPage/>);
 row=await screen.findByRole('row',{name:/Cement Bag/});cells=within(row).getAllByRole('cell');
 expect(cells[3]).toHaveTextContent('40');expect(cells[4]).toHaveTextContent('5');expect(cells[5]).toHaveTextContent('35');
 expect(cells[3]).not.toHaveTextContent('50');
});
