import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SearchableSelect } from "@/components/app/searchable-select";
import { NativeSelect } from "@/components/app/form-bits";
import { SearchHighlight } from "@/components/app/SearchHighlight";
import { NAV } from "@/lib/nav";
import { canAccess } from "@/lib/session";
afterEach(cleanup);
const options = [{ value: "1", label: "Raj Traders" }, { value: "2", label: "Ravi Stores" }, { value: "3", label: "Blocked Party", disabled: true }];
describe("two-letter autocomplete", () => {
 it("highlights names ignoring case and selects only on Enter", () => {
  const pick=vi.fn();render(<SearchableSelect label="Customer" searchLabel="Search customers" placeholder="Choose customer" value="" options={options} onChange={pick}/>);
  const input=screen.getByLabelText('Search customers');fireEvent.change(input,{target:{value:'r'}});expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.change(input,{target:{value:'RA'}});const list=screen.getByRole('listbox');
  expect(within(list).getAllByRole('option')[0]).toHaveAttribute('aria-selected','true');expect(list.querySelector('mark')?.textContent).toBe('Ra');expect(pick).not.toHaveBeenCalled();
  fireEvent.keyDown(input,{key:'Enter'});expect(pick).toHaveBeenCalledWith('1');expect(screen.queryByRole('listbox')).toBeNull();
 });
 it("supports arrows, Escape, no match, disabled entries and touch selection",()=>{
  const pick=vi.fn();render(<SearchableSelect label="Customer" searchLabel="Search customers" placeholder="Choose customer" value="" options={options} onChange={pick}/>);
  const input=screen.getByLabelText('Search customers');fireEvent.change(input,{target:{value:'ra'}});fireEvent.keyDown(input,{key:'ArrowDown'});fireEvent.keyDown(input,{key:'Enter'});expect(pick).toHaveBeenCalledWith('2');
  fireEvent.change(input,{target:{value:'bl'}});expect(screen.queryByRole('listbox')).toBeNull();fireEvent.keyDown(input,{key:'Enter'});expect(pick).toHaveBeenCalledTimes(1);
  fireEvent.change(input,{target:{value:'zz'}});expect(screen.getByRole('status')).toHaveTextContent('No matching');
  fireEvent.change(input,{target:{value:'ra'}});fireEvent.keyDown(input,{key:'Escape'});expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.focus(input);const option=within(screen.getByRole('listbox')).getAllByRole('option')[0]!;fireEvent.pointerDown(option,{pointerType:'touch'});fireEvent.click(option);expect(pick).toHaveBeenCalledWith('1');
 });
 it("upgrades customer/item/supplier NativeSelect without changing its callback value",()=>{
  const change=vi.fn();render(<NativeSelect aria-label="Item 1" value="" onChange={change}><option value="">Choose item</option><option value="i1">Cement Bag</option></NativeSelect>);
  fireEvent.change(screen.getByLabelText('Search item 1'),{target:{value:'CE'}});fireEvent.keyDown(screen.getByLabelText('Search item 1'),{key:'Enter'});expect(change.mock.calls[0]![0].target.value).toBe('i1');
 });
 it("selecting a suggestion does not trigger a document confirmation shortcut",()=>{
  const confirm=vi.fn(),pick=vi.fn();render(<div onKeyDown={confirm}><SearchableSelect label="Customer" searchLabel="Search customers" placeholder="Choose customer" value="" options={options} onChange={pick}/></div>);
  const input=screen.getByLabelText('Search customers');fireEvent.change(input,{target:{value:'ra'}});fireEvent.keyDown(input,{key:'Enter',ctrlKey:true});expect(pick).toHaveBeenCalledWith('1');expect(confirm).not.toHaveBeenCalled();
 });
 it("renders text safely and highlights literal punctuation",()=>{
  const {container}=render(<SearchHighlight text={'<script>RA.* Traders</script>'} query='RA.*'/>);expect(container.querySelector('script')).toBeNull();expect(container.querySelector('mark')).toHaveTextContent('RA.*');
 });
 it("adds Find Items beside Find Documents and keeps role restrictions",()=>{
  const links=NAV[0]!.items;const documents=links.findIndex(i=>i.label==='Find Documents');expect(links[documents+1]?.label).toBe('Find Items');
  expect(canAccess('Storekeeper','/find-items')).toBe(true);expect(canAccess('Driver','/find-items')).toBe(false);expect(canAccess('Chartered Accountant','/find-items')).toBe(false);
 });
});
