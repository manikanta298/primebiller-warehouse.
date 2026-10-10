/**
 * Typed REST client. When VITE_API_URL is set, every call hits the real
 * Express API with a JWT bearer token. Otherwise it falls back to the
 * in-memory mock with identical signatures.
 */
import * as mock from "./mock";
import { ApiError } from "./mock";
import type { AppUser, AppUserInput, NumberSeries, NumberSeriesInput, OrgSettings, OrgSettingsInput, PrintProfile, DocHit, SearchFilter, Gstr1, SalesRegisterRow, ReceivableRow, ItemSalesRow, Adjustment, AdjustmentInput, Transfer, TransferInput, ReceiveTransferInput, PurchaseOrder, PurchaseOrderInput, Grn, GrnInput, Receipt, ReceiptInput, Invoice, Advance, IssueInvoiceInput, Challan, DispatchInput, EwbAction,
  Dashboard,
  Godown,
  WarehouseActivity,
  Item,
  LoginResponse,
  Notification,
  Party,
  SalesOrder,
  SalesOrderInput,
  MasterKind,
  MasterRows,
  GodownInput,
  PartyInput,
  LedgerEntry,
  LedgerFilter,
  StockAlert,
} from "./types";
import { getSession, setSession } from "@/lib/session";
import type { ItemEditPatch } from "@/lib/item-detail-rules";

export { ApiError };

export interface FirstAdminRegistrationInput {
  orgName: string;
  orgGstin: string;
  name: string;
  email: string;
  password: string;
  mobile?: string;
  setupCode: string;
}

const BASE_URL = (import.meta.env["VITE_API_URL"] as string | undefined)?.replace(/\/$/, "");
export const usingMock = !BASE_URL;

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const session = getSession();
  const token = session?.token;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(session?.orgId ? { "X-Org-Id": session.orgId } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (res.status === 401 && token) setSession(null);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.code ?? "http_error", err.message ?? res.statusText, err.details);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

async function fileToBase64(f: File): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export const api = {
  firstAdminStatus: (): Promise<{ available: boolean }> =>
    usingMock ? Promise.resolve({ available: false }) : http("GET", "/auth/setup-status"),
  registerFirstAdmin: (input: FirstAdminRegistrationInput): Promise<LoginResponse> =>
    usingMock
      ? Promise.reject(new ApiError(503, "demo_mode", "Registration requires the connected Express API."))
      : http("POST", "/auth/register", input),
  /** Bulk import: read an Excel / JSON / CSV file or a Google Sheets link into rows (first row = headings). */
  parseImport: async (src: File | { url: string }): Promise<string[][]> =>
    usingMock
      ? mock.parseImport(src)
      : (await http<{ rows: string[][] }>("POST", "/import/parse", src instanceof File ? { fileName: src.name, contentBase64: await fileToBase64(src) } : { url: src.url })).rows,

  acceptInvite: (token: string, password: string): Promise<LoginResponse> =>
    usingMock
      ? Promise.reject(new ApiError(400, "demo_mode", "Invites work once the server is connected. In demo mode, use the demo accounts."))
      : http("POST", "/auth/accept-invite", { token, password }),
  login: (email: string, password: string): Promise<LoginResponse> =>
    usingMock ? mock.login(email, password) : http("POST", "/auth/login", { email, password }),
  forgotPassword: (email: string): Promise<{ message: string }> =>
    usingMock
      ? Promise.reject(new ApiError(503, "demo_mode", "Password recovery requires the connected Express API."))
      : http("POST", "/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string): Promise<{ message: string }> =>
    usingMock
      ? Promise.reject(new ApiError(503, "demo_mode", "Password recovery requires the connected Express API."))
      : http("POST", "/auth/reset-password", { token, password }),

  listGodowns: (orgId: string): Promise<Godown[]> =>
    usingMock ? mock.listGodowns(orgId) : http("GET", `/orgs/${orgId}/godowns`),

  listNotifications: (): Promise<Notification[]> =>
    usingMock ? mock.listNotifications() : http("GET", "/notifications"),

  getDashboard: (godownId: string): Promise<Dashboard> =>
    usingMock ? mock.getDashboard(godownId) : http("GET", `/dashboard${qs({ godownId })}`),

  listItems: (q = ""): Promise<Item[]> =>
    usingMock ? mock.listItems(q) : http("GET", `/items${qs({ q })}`),
  getItem: (id: string): Promise<Item> => (usingMock ? mock.getItem(id) : http("GET", `/items/${id}`)),
  updateItem: (id: string, patch: ItemEditPatch): Promise<Item> =>
    usingMock ? mock.updateItem(id, patch) : http("PATCH", `/items/${id}`, patch),

  createItem: (input: Omit<Item, "id" | "stock" | "batches">): Promise<Item> =>
    usingMock ? mock.createItem(input) : http("POST", "/items", input),

  listParties: (kind?: Party["kind"], q = ""): Promise<Party[]> =>
    usingMock ? mock.listParties(kind, q) : http("GET", `/parties${qs({ kind, q })}`),

  getParty: (id: string): Promise<Party> => (usingMock ? mock.getParty(id) : http("GET", `/parties/${id}`)),
  saveParty: (input: PartyInput): Promise<Party> =>
    usingMock ? mock.saveParty(input) : input.id ? http("PUT", `/parties/${input.id}`, input) : http("POST", "/parties", input),

  getWarehouseActivity: (orgId: string, id: string): Promise<WarehouseActivity> =>
    usingMock ? mock.getWarehouseActivity(orgId, id) : http("GET", `/orgs/${orgId}/godowns/${encodeURIComponent(id)}/activity`),

  listGodownsDetailed: (orgId: string): Promise<Godown[]> =>
    usingMock ? mock.listGodownsDetailed(orgId) : http("GET", `/orgs/${orgId}/godowns?detail=1`),
  saveGodown: (orgId: string, input: GodownInput): Promise<Godown> =>
    usingMock
      ? mock.saveGodown(orgId, input)
      : input.id
        ? http("PUT", `/orgs/${orgId}/godowns/${input.id}`, input)
        : http("POST", `/orgs/${orgId}/godowns`, input),

  /** uoms | categories | brands | hsn → /masters/:kind */
  listMaster: <K extends MasterKind>(kind: K): Promise<MasterRows[K][]> =>
    usingMock ? mock.listMaster(kind) : http("GET", `/masters/${kind}`),
  saveMaster: <K extends MasterKind>(kind: K, row: Omit<MasterRows[K], "id"> & { id?: string }): Promise<MasterRows[K]> =>
    usingMock
      ? mock.saveMaster(kind, row)
      : row.id
        ? http("PUT", `/masters/${kind}/${row.id}`, row)
        : http("POST", `/masters/${kind}`, row),

  listSalesOrders: (status?: string): Promise<SalesOrder[]> =>
    usingMock ? mock.listSalesOrders(status) : http("GET", `/sales-orders${qs({ status })}`),
  getSalesOrder: (id: string): Promise<SalesOrder> =>
    usingMock ? mock.getSalesOrder(id) : http("GET", `/sales-orders/${id}`),
  saveSalesOrder: (input: SalesOrderInput): Promise<SalesOrder> =>
    usingMock
      ? mock.saveSalesOrder(input)
      : input.id
        ? http("PUT", `/sales-orders/${input.id}`, input)
        : http("POST", "/sales-orders", input),
  confirmSalesOrder: (id: string, override?: { reason: string }): Promise<SalesOrder> =>
    usingMock ? mock.confirmSalesOrder(id, override) : http("POST", `/sales-orders/${id}/confirm`, { override }),
  listChallans: (status?: string): Promise<Challan[]> =>
    usingMock ? mock.listChallans(status) : http("GET", `/challans${qs({ status })}`),
  getChallan: (id: string): Promise<Challan> => (usingMock ? mock.getChallan(id) : http("GET", `/challans/${id}`)),
  dispatchChallan: (input: DispatchInput): Promise<Challan> =>
    usingMock ? mock.dispatchChallan(input) : http("POST", "/challans", input),
  deliverChallan: (id: string, pod: { receivedBy: string; remarks: string }): Promise<Challan> =>
    usingMock ? mock.deliverChallan(id, pod) : http("POST", `/challans/${id}/deliver`, pod),
  cancelChallan: (id: string, reason: string): Promise<Challan> =>
    usingMock ? mock.cancelChallan(id, reason) : http("POST", `/challans/${id}/cancel`, { reason }),
  ewbAction: (id: string, a: EwbAction): Promise<Challan> =>
    usingMock ? mock.ewbAction(id, a) : http("POST", `/challans/${id}/eway/${a.action}`, a),
  listInvoices: (status?: string): Promise<Invoice[]> =>
    usingMock ? mock.listInvoices(status) : http("GET", `/invoices${qs({ status })}`),
  getInvoice: (id: string): Promise<Invoice> => (usingMock ? mock.getInvoice(id) : http("GET", `/invoices/${id}`)),
  listAdvances: (customerId: string): Promise<Advance[]> =>
    usingMock ? mock.listAdvances(customerId) : http("GET", `/receipts/advances${qs({ customerId })}`),
  issueInvoice: (input: IssueInvoiceInput): Promise<Invoice> =>
    usingMock ? mock.issueInvoice(input) : http("POST", "/invoices", input),
  cancelInvoice: (id: string, reason: string): Promise<Invoice> =>
    usingMock ? mock.cancelInvoice(id, reason) : http("POST", `/invoices/${encodeURIComponent(id)}/cancel`, { reason }),
  listReceipts: (): Promise<Receipt[]> => (usingMock ? mock.listReceipts() : http("GET", "/receipts")),
  listOpenInvoices: (customerId: string): Promise<Invoice[]> =>
    usingMock ? mock.listOpenInvoices(customerId) : http("GET", `/invoices${qs({ customerId, open: "1" })}`),
  listAllAdvances: (): Promise<(Advance & { customerName: string })[]> =>
    usingMock ? mock.listAllAdvances() : http("GET", "/receipts/advances"),
  recordReceipt: (input: ReceiptInput): Promise<Receipt> =>
    usingMock ? mock.recordReceipt(input) : http("POST", "/receipts", input),
  listPurchaseOrders: (): Promise<PurchaseOrder[]> => (usingMock ? mock.listPurchaseOrders() : http("GET", "/purchase-orders")),
  getPurchaseOrder: (id: string): Promise<PurchaseOrder> => (usingMock ? mock.getPurchaseOrder(id) : http("GET", `/purchase-orders/${id}`)),
  createPurchaseOrder: (input: PurchaseOrderInput): Promise<PurchaseOrder> =>
    usingMock ? mock.createPurchaseOrder(input) : http("POST", "/purchase-orders", input),
  approvePurchaseOrder: (id: string): Promise<PurchaseOrder> =>
    usingMock ? mock.approvePurchaseOrder(id) : http("POST", `/purchase-orders/${encodeURIComponent(id)}/approve`, {}),
  cancelPurchaseOrder: (id: string, reason: string): Promise<PurchaseOrder> =>
    usingMock ? mock.cancelPurchaseOrder(id, reason) : http("POST", `/purchase-orders/${encodeURIComponent(id)}/cancel`, { reason }),
  listGrns: (): Promise<Grn[]> => (usingMock ? mock.listGrns() : http("GET", "/grns")),
  getGrn: (id: string): Promise<Grn> => (usingMock ? mock.getGrn(id) : http("GET", `/grns/${id}`)),
  postGrn: (input: GrnInput): Promise<Grn> => (usingMock ? mock.postGrn(input) : http("POST", "/grns", input)),
  listTransfers: (status?: string): Promise<Transfer[]> => (usingMock ? mock.listTransfers(status) : http("GET", `/transfers${qs({ status })}`)),
  getTransfer: (id: string): Promise<Transfer> => (usingMock ? mock.getTransfer(id) : http("GET", `/transfers/${id}`)),
  dispatchTransfer: (input: TransferInput): Promise<Transfer> => (usingMock ? mock.dispatchTransfer(input) : http("POST", "/transfers", input)),
  receiveTransfer: (id: string, input: ReceiveTransferInput): Promise<Transfer> =>
    usingMock ? mock.receiveTransfer(id, input) : http("POST", `/transfers/${id}/receive`, input),
  cancelTransfer: (id: string, reason: string): Promise<Transfer> =>
    usingMock ? mock.cancelTransfer(id, reason) : http("POST", `/transfers/${id}/cancel`, { reason }),
  listAdjustments: (status?: string): Promise<Adjustment[]> => (usingMock ? mock.listAdjustments(status) : http("GET", `/adjustments${qs({ status })}`)),
  getAdjustment: (id: string): Promise<Adjustment> => (usingMock ? mock.getAdjustment(id) : http("GET", `/adjustments/${id}`)),
  createAdjustment: (input: AdjustmentInput): Promise<Adjustment> => (usingMock ? mock.createAdjustment(input) : http("POST", "/adjustments", input)),
  decideAdjustment: (id: string, approve: boolean, note?: string): Promise<Adjustment> =>
    usingMock ? mock.decideAdjustment(id, approve, note) : http("POST", `/adjustments/${id}/${approve ? "approve" : "reject"}`, { note }),
  getStockLedger: (f: LedgerFilter): Promise<LedgerEntry[]> =>
    usingMock
      ? mock.getStockLedger(f)
      : http("GET", `/stock/ledger${qs({ itemId: f.itemId, godownId: f.godownId === "all" ? undefined : f.godownId, batchNo: f.batchNo })}`),
  getAlerts: (godownId = "all"): Promise<StockAlert[]> =>
    usingMock ? mock.getAlerts(godownId) : http("GET", `/alerts${qs({ godownId })}`),
  acknowledgeAlerts: (ids: string[]): Promise<void> =>
    usingMock
      ? mock.acknowledgeAlerts(ids)
      : ids.length === 1
        ? http("POST", `/alerts/${ids[0]}/acknowledge`)
        : http("POST", "/alerts/acknowledge-all", { ids }),

  cancelSalesOrder: (id: string): Promise<SalesOrder> =>
    usingMock ? mock.cancelSalesOrder(id) : http("POST", `/sales-orders/${id}/cancel`),

  listUsers: (): Promise<AppUser[]> => (usingMock ? mock.listUsers() : http("GET", "/users")),
  saveUser: (input: AppUserInput): Promise<AppUser> =>
    usingMock ? mock.saveUser(input) : input.id ? http("PUT", `/users/${input.id}`, input) : http("POST", "/users", input),
  listSeries: (): Promise<NumberSeries[]> => (usingMock ? mock.listSeries() : http("GET", "/settings/numbering")),
  saveSeries: (input: NumberSeriesInput): Promise<NumberSeries> =>
    usingMock ? mock.saveSeries(input) : http("PUT", `/settings/numbering/${input.docType}`, input),
  getSettings: (): Promise<OrgSettings> => (usingMock ? mock.getSettings() : http("GET", "/settings")),
  saveSettings: (input: OrgSettingsInput): Promise<OrgSettings> => (usingMock ? mock.saveSettings(input) : http("PUT", "/settings", input)),
  listPrintProfiles: (): Promise<PrintProfile[]> => (usingMock ? mock.listPrintProfiles() : http("GET", "/print-profiles")),
  savePrintProfile: (p: PrintProfile): Promise<PrintProfile> =>
    usingMock ? mock.savePrintProfile(p) : http("PUT", `/print-profiles/${p.id}`, p),
  searchDocs: (f: SearchFilter): Promise<DocHit[]> =>
    usingMock
      ? mock.searchDocs(f)
      : http("GET", `/search${qs({ q: f.q, docTypes: f.types?.join(","), status: f.status, datePreset: f.period, min: f.min?.toString(), max: f.max?.toString() })}`),
  getSalesRegister: (from: string, to: string): Promise<SalesRegisterRow[]> =>
    usingMock ? mock.getSalesRegister(from, to) : http("GET", `/reports/sales-register${qs({ from, to })}`),
  getReceivables: (): Promise<ReceivableRow[]> => (usingMock ? mock.getReceivables() : http("GET", "/reports/receivables")),
  getItemSales: (from: string, to: string): Promise<ItemSalesRow[]> =>
    usingMock ? mock.getItemSales(from, to) : http("GET", `/reports/item-sales${qs({ from, to })}`),
  getGstr1: (period: string): Promise<Gstr1> => (usingMock ? mock.getGstr1(period) : http("GET", `/reports/gstr1${qs({ period })}`)),
};
