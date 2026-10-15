import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useQuotationAutosave } from "@/lib/use-quotation-autosave";
import { QuotationsPage } from "@/routes/_authenticated/quotations";
const mock = vi.hoisted(() => ({ role: "Owner", quote: null as any, navigate: vi.fn(), print: vi.fn(), api: { getQuotationDraft: vi.fn(), saveQuotationDraft: vi.fn(), getQuotationDefaults: vi.fn(), saveParty: vi.fn(), createItem: vi.fn(), listQuotations: vi.fn(), getQuotation: vi.fn(), listParties: vi.fn(), listGodowns: vi.fn(), listItems: vi.fn(), saveQuotation: vi.fn(), quotationAction: vi.fn(), convertQuotation: vi.fn(), recordReceipt: vi.fn() } }));
vi.mock("@/api/client", () => ({ api: mock.api }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ orgId: "org1", godownId: "g1", user: { id: "u1", role: mock.role }, orgs: [{ id: "org1", name: "Test Business", gstin: "", stateCode: "36" }] }) }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options, useNavigate: () => mock.navigate, Link: ({ children }: any) => <a>{children}</a> }));
function setup() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><QuotationsPage /></QueryClientProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); mock.role = "Owner";
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0,10);
  mock.quote = { id: "q1", number: "QT/26-27/00001", date, validUntil: "2099-12-31", customerId: "c1", customerName: "Test Customer", godownId: "g1", placeOfSupplyCode: "36", placeOfSupplyName: "Telangana", status: "issued", lines: [{ id: "l1", itemId: "i1", itemName: "Item", hsn: "1234", uom: "PCS", qty: 1, deliveredQty: 0, rate: 100, discountPct: 0, gstRate: 18 }], grandTotal: 118, supply: "intra", notes: "", terms: "Valid prices", linked: [], payments: [], createdAt: date, createdBy: "Owner" };
  mock.api.getQuotationDraft.mockResolvedValue({ version: 0, input: null });
  mock.api.saveQuotationDraft.mockImplementation(async (_key, version, input) => ({ version: version + 1, input }));
  mock.api.getQuotationDefaults.mockResolvedValue({ terms: "Default quote terms", notes: "Default quote notes" });
  mock.api.listQuotations.mockImplementation(async () => [mock.quote]);
  mock.api.getQuotation.mockImplementation(async () => mock.quote);
  mock.api.listParties.mockResolvedValue([{ id: "c1", name: "Test Customer", stateCode: "36" }]);
  mock.api.listGodowns.mockResolvedValue([{ id: "g1", name: "Warehouse One", code: "W1", active: true }]);
  mock.api.listItems.mockResolvedValue([{ id: "i1", name: "Item", sku: "I1", hsn: "1234", baseUom: "PCS", gstRate: 18, salePrice: 100, active: true }]);
  mock.api.quotationAction.mockImplementation(async (_id, action) => ({ ...mock.quote, status: action === "accept" ? "accepted" : action }));
  mock.api.convertQuotation.mockResolvedValue({ id: "so1" });
  vi.spyOn(window, "print").mockImplementation(mock.print);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("quotations UI", () => {
  it("converts directly without separate issue, acceptance or mandatory payment", async () => {
    setup(); fireEvent.click(await screen.findByRole("button", { name: "QT/26-27/00001" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await screen.findByRole("button", { name: "Convert to Sales Order" });
    expect(screen.queryByRole("button", {name:"Record acceptance"})).toBeNull();
    expect(screen.queryByRole("button", {name:"Issue quotation"})).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Convert to Sales Order" }));
    await waitFor(() => expect(mock.navigate).toHaveBeenCalledWith({ to: "/sales-orders/$id", params: { id: "so1" } }));
    expect(mock.api.recordReceipt).not.toHaveBeenCalled();
    expect(mock.api.quotationAction).not.toHaveBeenCalled();
  });
  it("requires a dispatch warehouse only when converting a warehouse-free quote", async () => {
    mock.quote.status = "accepted"; mock.quote.godownId = ""; setup();
    fireEvent.click(await screen.findByRole("button", { name: "QT/26-27/00001" }));
    const convert = await screen.findByRole("button", { name: "Convert to Sales Order" });
    expect((convert as HTMLButtonElement).disabled).toBe(true);
    await screen.findByRole("option", { name: "Warehouse One (W1)" });
    fireEvent.change(screen.getByLabelText("Sales Order dispatch warehouse"), { target: { value: "g1" } });
    fireEvent.click(convert);
    await waitFor(() => expect(mock.api.convertQuotation).toHaveBeenCalledWith("q1", "g1"));
  });
  it("allows Accountant to view/print and record payments but hides acceptance and conversion", async () => {
    mock.role = "Accountant"; mock.quote.status = "accepted"; setup();
    fireEvent.click(await screen.findByRole("button", { name: "QT/26-27/00001" }));
    expect(await screen.findByRole("button", { name: "Record advance" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Convert to Sales Order" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Print / Save PDF" })); expect(mock.print).toHaveBeenCalledOnce();
    expect(document.getElementById("quotation-print")?.textContent).toContain("This quotation is not a tax invoice");
  });
  it("shows free stock after held quantities and searches by SKU", async () => {
    mock.api.listItems.mockResolvedValue([{ id: "i1", name: "Item", sku: "I1", hsn: "1234", baseUom: "PCS", gstRate: 18, salePrice: 100, active: true, stock: [{ godownId: "g1", onHand: 8, held: 3 }, { godownId: "g2", onHand: 50, held: 0 }] }]);
    setup(); fireEvent.click(await screen.findByRole("button", { name: "New quotation" }));
    fireEvent.change(await screen.findByLabelText("Search items 1"), { target: { value: "I1" } });
    await screen.findByRole("option", { name: /Item · I1/ });
    fireEvent.keyDown(screen.getByLabelText("Search items 1"), { key: "Enter" });
    expect(screen.getByText("Available: 5 PCS")).toBeTruthy();
  });
  it("updates draft tax split on customer change and keeps the selection while searching", async () => {
    mock.quote.status = "draft";
    mock.api.listParties.mockResolvedValue([{ id: "c1", name: "Test Customer", stateCode: "36" }, { id: "c2", name: "Interstate Customer", stateCode: "29" }]);
    setup(); fireEvent.click(await screen.findByRole("button", { name: "QT/26-27/00001" }));
    fireEvent.change(await screen.findByLabelText("Search customers"), { target: { value: "Inter" } });
    await screen.findByRole("option", { name: "Interstate Customer" });
    fireEvent.keyDown(screen.getByLabelText("Search customers"), { key: "Enter" });
    expect(screen.getByText("IGST").parentElement?.textContent).toContain("18");
    expect(screen.getByText("CGST").parentElement?.textContent).toContain("0");
    fireEvent.change(await screen.findByLabelText("Search customers"), { target: { value: "missing" } });
    expect(screen.getByText("IGST").parentElement?.textContent).toContain("18");
    expect(screen.getByRole("status").textContent).toContain("No matching");
    expect(screen.getByText("Out of stock")).toBeTruthy();
  });
  it("creates a customer and an item inline and immediately includes them in the draft", async () => {
    mock.api.saveParty.mockResolvedValue({ id: "new-c", name: "New Buyer", kind: "customer", stateCode: "36", stateName: "Telangana", blocked: false });
    mock.api.createItem.mockResolvedValue({ id: "new-i", name: "New Product", sku: "NEW01", hsn: "1234", baseUom: "PCS", gstRate: 18, salePrice: 200, active: true, stock: [] });
    mock.api.saveQuotation.mockResolvedValue({ ...mock.quote, status: "draft" }); setup();
    fireEvent.click(await screen.findByRole("button", { name: "New quotation" }));
    await waitFor(() => expect(screen.getByLabelText("Terms and conditions")).toHaveValue("Default quote terms"));
    expect(screen.queryByRole("combobox", { name: "Quotation customer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create customer" }));
    fireEvent.change(screen.getByLabelText("New customer name"), { target: { value: "New Buyer" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and select customer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Search customers")).toHaveValue("New Buyer");
    expect(mock.api.saveParty.mock.calls[0]![0].gstin).toBeUndefined(); expect(mock.api.saveParty.mock.calls[0]![0].pan).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Create item 1" }));
    for (const [label,value] of [["New item name","New Product"],["New item SKU","NEW01"],["New item HSN","1234"],["New item sale price","200"],["New item GST rate","18"]]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Create and select item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((screen.getByLabelText("Search items 1") as HTMLInputElement).value).toContain("New Product");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mock.api.saveQuotation).toHaveBeenCalled());
    expect(mock.api.saveQuotation.mock.calls[0]![0]).toMatchObject({ customerId: "new-c", terms: "Default quote terms", notes: "Default quote notes", lines: [{ itemId: "new-i", rate: 200, gstRate: 18 }] });
  });
  it("preserves manual terms typed before defaults load", async () => {
    let finish!: (value: { terms: string; notes: string }) => void;
    mock.api.getQuotationDefaults.mockImplementation(() => new Promise(resolve => { finish = resolve; })); setup();
    fireEvent.click(await screen.findByRole("button", { name: "New quotation" }));
    fireEvent.change(await screen.findByLabelText("Terms and conditions"), { target: { value: "My manual terms" } });
    finish({ terms: "Late default", notes: "Default note" });
    await waitFor(() => expect(screen.getByLabelText("Notes")).toHaveValue("Default note"));
    expect(screen.getByLabelText("Terms and conditions")).toHaveValue("My manual terms");
  });
  it("submits a new quotation without a warehouse, with search and item master tax data", async () => {
    mock.api.saveQuotation.mockResolvedValue({ ...mock.quote, status: "draft" }); setup();
    fireEvent.click(await screen.findByRole("button", { name: "New quotation" }));
    fireEvent.change(await screen.findByLabelText("Search customers"), { target: { value: "Test" } });
    await screen.findByRole("option", { name: "Test Customer" });
    fireEvent.keyDown(screen.getByLabelText("Search customers"), { key: "Enter" });
    expect(screen.queryByLabelText("Quotation warehouse")).toBeNull();
    fireEvent.change(await screen.findByLabelText("Search items 1"), { target: { value: "I1" } });
    await screen.findByRole("option", { name: /Item · I1/ });
    fireEvent.keyDown(screen.getByLabelText("Search items 1"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mock.api.saveQuotation).toHaveBeenCalled());
    const input = mock.api.saveQuotation.mock.calls[0]![0]; expect(input.customerId).toBe("c1"); expect(input.godownId).toBe(""); expect(input.lines[0]).toMatchObject({ itemId: "i1", hsn: "1234", gstRate: 18, rate: 100 });
  });
});

it("restores an incomplete database draft without substituting Settings defaults", async () => {
  mock.api.getQuotationDraft.mockResolvedValue({version: 4, input: {customerId:"", godownId:"", date:mock.quote.date,validUntil:mock.quote.validUntil,notes:"Recovered notes",terms:"",lines:[]}});
  setup(); fireEvent.click(await screen.findByRole("button",{name:"New quotation"}));
  expect(await screen.findByLabelText("Notes")).toHaveValue("Recovered notes");
  expect(screen.getByLabelText("Terms and conditions")).toHaveValue("");
  expect(screen.getByText("Recovered your unfinished quotation.")).toBeTruthy();
  expect(mock.api.saveQuotation).not.toHaveBeenCalled();
});
it("saves before opening print and prints the persisted quotation", async () => {
  mock.quote.status="draft";
  mock.api.saveQuotation.mockImplementation(async input=>({...mock.quote, ...input, notes:"Persisted text"}));
  setup(); fireEvent.click(await screen.findByRole("button",{name:"QT/26-27/00001"}));
  fireEvent.change(await screen.findByLabelText("Notes"),{target:{value:"Persisted text"}});
  fireEvent.click(screen.getByRole("button",{name:"Save & print quotation"}));
  await waitFor(()=>expect(mock.print).toHaveBeenCalledOnce());
  expect(mock.api.saveQuotation).toHaveBeenCalledWith(expect.objectContaining({id:"q1",notes:"Persisted text"}),0);
  expect(document.getElementById("quotation-print")?.textContent).toContain("Persisted text");
});

describe("quotation autosave",()=>{
  const input = {customerId:"",godownId:"",date:"",validUntil:"",notes:"",terms:"",lines:[]};
  it("debounces incomplete input, serializes slow writes and keeps newer edits",async()=>{
    vi.useFakeTimers();
    let finish!: (value:any)=>void;
    mock.api.saveQuotationDraft.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {result,rerender}=renderHook(({value})=>useQuotationAutosave("new",value,{version:0,input:null},true),{initialProps:{value:input}});
    rerender({value:{...input,notes:"first"}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
    expect(mock.api.saveQuotationDraft).not.toHaveBeenCalled();
    rerender({value:{...input,notes:"second"}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
    expect(mock.api.saveQuotationDraft).toHaveBeenCalledTimes(1);
    rerender({value:{...input,notes:"latest"}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
    expect(mock.api.saveQuotationDraft).toHaveBeenCalledTimes(1);
    await act(async()=>{finish({version:1,input:{...input,notes:"second"}});});
    expect(result.current.pending).toBe(true);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
    expect(mock.api.saveQuotationDraft).toHaveBeenLastCalledWith("new",1,{...input,notes:"latest"});
    expect(result.current.pending).toBe(false);
  });
  it("retains failed input, exposes retry, and never claims a failed write was saved",async()=>{
    vi.useFakeTimers();
    mock.api.saveQuotationDraft.mockRejectedValueOnce(new Error("Database unavailable"));
    const {result,rerender}=renderHook(({value})=>useQuotationAutosave("new",value,{version:0,input:null},true),{initialProps:{value:input}});
    rerender({value:{...input,notes:"keep me"}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
    expect(result.current.error?.message).toBe("Database unavailable"); expect(result.current.pending).toBe(true);expect(result.current.hasSaved).toBe(false);
    await act(async()=>{result.current.retry();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
    expect(result.current.error).toBeNull();expect(result.current.pending).toBe(false);
  });
});

it("does not print or discard edits when explicit Save fails", async () => {
  mock.quote.status="draft";
  mock.api.saveQuotation.mockRejectedValueOnce(new Error("Database unavailable"));
  setup(); fireEvent.click(await screen.findByRole("button",{name:"QT/26-27/00001"}));
  fireEvent.change(await screen.findByLabelText("Notes"),{target:{value:"Keep these edits"}});
  fireEvent.click(screen.getByRole("button",{name:"Save & print quotation"}));
  await waitFor(()=>expect(mock.api.saveQuotation).toHaveBeenCalled());
  await waitFor(()=>expect(screen.getByRole("button",{name:"Save & print quotation"})).not.toBeDisabled());
  expect(mock.print).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Notes")).toHaveValue("Keep these edits");
});
