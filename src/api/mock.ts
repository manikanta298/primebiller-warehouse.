/**
 * In-memory mock backend. Mirrors the REST API signatures in client.ts so the
 * UI can be built before the Express + MySQL service exists.
 */
import type { Adjustment, AdjustmentInput, AppUser, AppUserInput, NumberSeries, NumberSeriesInput, DocType, OrgSettings, OrgSettingsInput, PrintProfile, DocHit, SearchFilter, Gstr1, SalesRegisterRow, ReceivableRow, ItemSalesRow, Role,
  Dashboard,
  Godown,
  WarehouseActivity,
  Item,
  LoginResponse,
  Notification,
  Org,
  Party,
  SalesOrder,
  SalesOrderInput,
  User,
  MasterKind,
  MasterRows,
  GodownInput,
  PartyInput,
  Uom, Category, Brand, HsnRate,
  LedgerEntry, LedgerFilter, StockAlert,
  Challan, ChallanLine, DispatchInput, EwbAction, Invoice, Advance, IssueInvoiceInput, Receipt, ReceiptInput, PurchaseOrder, PurchaseOrderInput, Grn, GrnInput, GrnLine, Transfer, TransferInput, ReceiveTransferInput,
} from "./types";
import { buildLedger, computeAlerts } from "@/lib/stock-rules";
import { warehouseActivityFromLedger, warehouseActivityPeriod } from "@/lib/warehouse-dashboard-rules";
import { dashboardInventory, dashboardPipeline } from "@/lib/dashboard-rules";
import { computeTotals, creditCheck, supplyType, canOverrideCredit, gstinCheckChar, isValidGstin, stateFromGstin } from "@/lib/gst";
import { getSession } from "@/lib/session";
import { itemEditProblems, normaliseItemDraft, type ItemEditPatch } from "@/lib/item-detail-rules";
import { masterProblems, normaliseMaster } from "@/lib/master-rules";
import { normaliseGodown, godownProblems, canDeactivateWarehouse, warehouseStockSummary } from "@/lib/godown-rules";
import { normaliseParty, partyProblems, duplicatePartyGstin, filterParties, partyStateName, partiesForOrg } from "@/lib/party-rules";
import { orderCustomerEligible, orderDraftProblems, stockHoldProblems, salesOrdersForOrg } from "@/lib/sales-order-rules";
import { can } from "@/lib/permissions";
import { docNumber, seriesProblems } from "@/lib/numbering";
import { usersForOrg, userProblems, normaliseUserInput, settingsProblems } from "@/lib/admin-rules";
import { buildGstr1, salesRegister as buildSalesRegister, receivables as buildReceivables, itemSales as buildItemSales, validReportMonth, validReportRange } from "@/lib/reports";
import { filterDocs } from "@/lib/search-rules";
import { PRINT_DEFAULTS, printProfileProblems, normalisePrintProfile } from "@/lib/print-rules";
import { applyAdvancesOldestFirst, dueDateFor, invoiceStatus, invoiceNumber, invoiceIssueProblems, invoiceCancelProblems, invoicesForOrg } from "@/lib/invoice-rules";
import { receiptAllocation, receiptProblems, receiptPaise, receiptsForOrg } from "@/lib/receipt-rules";
import { apportionFreight, weightedAverageCost, poStatus, poDraftProblems, poWorkflowProblems, purchaseOrdersForOrg } from "@/lib/purchase-rules";
import { grnDraftProblems, grnsForOrg } from "@/lib/grn-rules";
import { adjustmentDraftProblems, adjustmentValue, needsApproval, canApproveAdjustment, reasonLabel, adjustmentsForOrg } from "@/lib/adjustment-rules";
import { transferDraftProblems, receiveProblems, receivedStatus, transfersForOrg } from "@/lib/transfer-rules";
import { canCancelTestEwb, challansForOrg, dispatchPlanProblems, dispatchTransportProblems, ewbValidUntil, normaliseVehicle, ewbValidityDays } from "@/lib/challan-rules";
import { ewayBillRequired } from "@/lib/gst";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface Store {
  users: (AppUser & { password: string })[];
  seriesByOrg: Record<string, Record<DocType, { prefix: string; padding: number; resetPerFy: boolean }>>;
  userOrgIds: Record<string, string[]>;
  /** Demo-only issued counters for organisations other than the seeded first organisation. */
  issuedByOrg: Record<string, Partial<Record<DocType, number>>>;
  settingsByOrg: Record<string, OrgSettings>;
  printProfilesByOrg: Record<string, PrintProfile[]>;
  orgs: Org[];
  godowns: Godown[];
  items: Item[];
  /** Mock-only ownership metadata; Item DTO intentionally has no orgId. */
  itemOrgIds: Record<string, string>;
  parties: Party[];
  /** Mock-only ownership; Party DTO does not include orgId. */
  partyOrgIds: Record<string, string>;
  salesOrders: SalesOrder[];
  /** Mock-only organisation ownership for documents. */
  salesOrderOrgIds: Record<string, string>;
  soSeq: number;
  notifications: Notification[];
  masters: { [K in MasterKind]: MasterRows[K][] };
  /** Mock-only ownership: the public Master DTO deliberately omits orgId. */
  masterOrgIds: Record<string, string>;
  challans: Challan[];
  challanOrgIds: Record<string, string>;
  dcSeq: number;
  posted: LedgerEntry[];
  invoices: Invoice[];
  /** Mock-only invoice ownership, matching the real API's org-scoped document rows. */
  invoiceOrgIds: Record<string, string>;
  invSeq: number;
  advances: Advance[];
  advanceOrgIds: Record<string, string>;
  receipts: Receipt[];
  receiptOrgIds: Record<string, string>;
  rctSeq: number;
  pos: PurchaseOrder[];
  poOrgIds: Record<string, string>;
  poSeq: number;
  grns: Grn[];
  grnOrgIds: Record<string, string>;
  grnSeq: number;
  transfers: Transfer[];
  transferOrgIds: Record<string, string>;
  trfSeq: number;
  adjustments: Adjustment[];
  adjustmentOrgIds: Record<string, string>;
  adjSeq: number;
}

let store: Store | null = null;

function db(): Store {
  if (store) return store;
  const orgs: Org[] = [
    { id: "org1", name: "Sri Venkateswara Traders", gstin: "36AAXFS1234K1ZP", stateCode: "36", stateName: "Telangana" },
    { id: "org2", name: "SVT Steel & Ply (Vijayawada)", gstin: "37AAXFS1234K1ZN", stateCode: "37", stateName: "Andhra Pradesh" },
  ];
  const godowns: Godown[] = [
    { id: "g1", orgId: "org1", name: "Balanagar", code: "BLN", type: "godown", address: "Plot 14, IDA Balanagar, Hyderabad 500037", stateCode: "36", manager: "Ramesh P", allowNegative: false, defaultForSales: true, active: true },
    { id: "g2", orgId: "org1", name: "Jeedimetla", code: "JDM", type: "yard", address: "Phase IV, IDA Jeedimetla, Hyderabad 500055", stateCode: "36", manager: "Ramesh P", allowNegative: false, defaultForSales: false, active: true },
    { id: "g3", orgId: "org1", name: "Shop Counter", code: "SHP", type: "shop_counter", address: "1-8-21, Balanagar Main Rd, Hyderabad 500042", stateCode: "36", manager: "Srinivas K", allowNegative: false, defaultForSales: false, active: true },
    { id: "g4", orgId: "org2", name: "Auto Nagar", code: "ATN", type: "godown", address: "Auto Nagar, Vijayawada 520007", stateCode: "37", manager: "Srinivas K", allowNegative: false, defaultForSales: true, active: true },
  ];
  const st = (g: string, onHand: number, held: number, reorder: number, max: number) => ({
    godownId: g, onHand, held, reorderLevel: reorder, maxLevel: max,
  });
  const items: Item[] = [
    {
      id: "i1", sku: "CEM-UT-PPC50", name: "UltraTech PPC 50kg bag", category: "Cement", brand: "UltraTech",
      hsn: "2523", gstRate: 28, baseUom: "BAG", conversions: [{ uom: "BAG", factor: 1 }, { uom: "MT", factor: 20 }],
      salePrice: 385, costPrice: 342, allowNegative: false, trackBatches: true, active: true,
      stock: [st("g1", 1840, 320, 500, 3000), st("g2", 260, 0, 400, 2000), st("g3", 45, 10, 60, 200)],
      batches: [
        { id: "b1", batchNo: "UT-2608-A", godownId: "g1", qty: 640, mfgDate: "2026-08-04", expiryDate: "2026-11-04", receivedDate: "2026-08-10" },
        { id: "b2", batchNo: "UT-2609-C", godownId: "g1", qty: 1200, mfgDate: "2026-09-12", expiryDate: "2026-12-12", receivedDate: "2026-09-18" },
        { id: "b3", batchNo: "UT-2607-B", godownId: "g2", qty: 260, mfgDate: "2026-07-20", expiryDate: "2026-10-20", receivedDate: "2026-07-26" },
        { id: "b4", batchNo: "UT-2609-D", godownId: "g3", qty: 45, mfgDate: "2026-09-15", expiryDate: "2026-12-15", receivedDate: "2026-09-22" },
      ],
    },
    {
      id: "i2", sku: "STL-TMT-12", name: "TMT Fe500D 12mm", category: "Steel", brand: "JSW Neosteel",
      hsn: "7214", gstRate: 18, baseUom: "KG", conversions: [{ uom: "KG", factor: 1 }, { uom: "ROD", factor: 10.66 }, { uom: "BDL", factor: 106.6 }, { uom: "MT", factor: 1000 }],
      salePrice: 62.5, costPrice: 56.8, allowNegative: false, trackBatches: true, active: true,
      stock: [st("g1", 18400, 2400, 5000, 40000), st("g2", 9600, 0, 4000, 25000), st("g3", 0, 0, 200, 1000)],
      batches: [
        { id: "b5", batchNo: "JSW-H4471", heatNo: "H4471", godownId: "g1", qty: 10400, mfgDate: "2026-06-02", receivedDate: "2026-06-09" },
        { id: "b6", batchNo: "JSW-H4519", heatNo: "H4519", godownId: "g1", qty: 8000, mfgDate: "2026-09-01", receivedDate: "2026-09-05" },
        { id: "b7", batchNo: "JSW-H4502", heatNo: "H4502", godownId: "g2", qty: 9600, mfgDate: "2026-08-14", receivedDate: "2026-08-20" },
      ],
    },
    {
      id: "i3", sku: "PLY-CEN-BWP19", name: "Century BWP 19mm 8x4", category: "Plywood", brand: "Century Ply",
      hsn: "4412", gstRate: 18, baseUom: "SHT", conversions: [{ uom: "SHT", factor: 1 }, { uom: "SQFT", factor: 1 / 32 }],
      salePrice: 4850, costPrice: 4210, allowNegative: false, trackBatches: false, active: true,
      stock: [st("g1", 0, 0, 40, 300), st("g2", 210, 24, 40, 300), st("g3", 18, 0, 10, 40)],
      batches: [],
    },
    {
      id: "i4", sku: "CEM-BA1-OPC53", name: "Birla A1 OPC 53 50kg bag", category: "Cement", brand: "Birla A1",
      hsn: "2523", gstRate: 28, baseUom: "BAG", conversions: [{ uom: "BAG", factor: 1 }, { uom: "MT", factor: 20 }],
      salePrice: 405, costPrice: 360, allowNegative: false, trackBatches: true, active: true,
      stock: [st("g1", 620, 0, 300, 2000), st("g2", 90, 0, 200, 1500), st("g3", 30, 0, 40, 150)],
      batches: [{ id: "b8", batchNo: "BA-2606-K", godownId: "g1", qty: 620, mfgDate: "2026-06-10", expiryDate: "2026-09-10", receivedDate: "2026-06-15" }],
    },
    {
      id: "i5", sku: "STL-TMT-8", name: "TMT Fe500D 8mm", category: "Steel", brand: "JSW Neosteel",
      hsn: "7214", gstRate: 18, baseUom: "KG", conversions: [{ uom: "KG", factor: 1 }, { uom: "ROD", factor: 4.74 }, { uom: "MT", factor: 1000 }],
      salePrice: 64, costPrice: 58.2, allowNegative: false, trackBatches: true, active: true,
      stock: [st("g1", 7200, 0, 3000, 20000), st("g2", 2100, 0, 2500, 15000), st("g3", 120, 0, 100, 500)],
      batches: [
        { id: "b9", batchNo: "JSW-H4120", heatNo: "H4120", godownId: "g1", qty: 2200, mfgDate: "2026-02-20", receivedDate: "2026-03-02" },
        { id: "b10", batchNo: "JSW-H4488", heatNo: "H4488", godownId: "g1", qty: 5000, mfgDate: "2026-07-01", receivedDate: "2026-07-08" },
      ],
    },
    {
      id: "i6", sku: "PNT-AP-APEX20", name: "Asian Paints Apex Ultima 20L", category: "Paint", brand: "Asian Paints",
      hsn: "3208", gstRate: 18, baseUom: "BKT", conversions: [{ uom: "BKT", factor: 1 }],
      salePrice: 7420, costPrice: 6480, allowNegative: true, trackBatches: true, active: true,
      stock: [st("g1", 12, 0, 10, 60), st("g2", 0, 0, 5, 30), st("g3", 6, 0, 4, 20)],
      batches: [
        { id: "b11", batchNo: "AP-2511-X", godownId: "g1", qty: 12, mfgDate: "2025-11-01", expiryDate: "2026-11-01", receivedDate: "2025-12-05" },
      ],
    },
  ];
  const parties: Party[] = [
    { id: "p1", kind: "customer", name: "Rajesh Constructions", gstin: "36AAJFR5521M1Z8", stateCode: "36", stateName: "Telangana", city: "Kukatpally, Hyderabad", phone: "98490 11223", creditLimit: 1500000, outstanding: 1185000 },
    { id: "p2", kind: "customer", name: "Rajeshwari Hardware", gstin: "37ABCPR7781Q1Z2", stateCode: "37", stateName: "Andhra Pradesh", city: "Vijayawada", phone: "94401 55678", creditLimit: 800000, outstanding: 212400 },
    { id: "p3", kind: "customer", name: "Lakshmi Narasimha Builders", gstin: "36AAFCL3310H1Z1", stateCode: "36", stateName: "Telangana", city: "Medchal", phone: "90000 44120", creditLimit: 2500000, outstanding: 640000 },
    { id: "p4", kind: "customer", name: "Sai Krishna Infra Projects", gstin: "29AAKCS9087P1Z6", stateCode: "29", stateName: "Karnataka", city: "Bengaluru", phone: "98860 22331", creditLimit: 3000000, outstanding: 0 },
    { id: "p5", kind: "customer", name: "Walk-in Customer", stateCode: "36", stateName: "Telangana", city: "Balanagar", phone: "-", creditLimit: 0, outstanding: 0 },
    { id: "p6", kind: "supplier", name: "UltraTech Cement Ltd", gstin: "36AAACL6442L1ZK", stateCode: "36", stateName: "Telangana", city: "Tandur", phone: "040 2335 0000", creditLimit: 0, outstanding: 942000 },
    { id: "p7", kind: "supplier", name: "JSW Steel Ltd", gstin: "29AAACJ4323N1ZC", stateCode: "29", stateName: "Karnataka", city: "Ballari", phone: "080 2342 1000", creditLimit: 0, outstanding: 1880000 },
  ];
  parties.forEach((p) => {
    if (p.gstin) p.gstin = p.gstin.slice(0, 14) + gstinCheckChar(p.gstin.slice(0, 14));
    p.creditDays = p.kind === "customer" ? 30 : 45;
  });
  parties.push({ id: "p8", kind: "transporter", name: "Sri Durga Roadlines", gstin: "36AAPFD4410R1Z" + gstinCheckChar("36AAPFD4410R1Z"), stateCode: "36", stateName: "Telangana", city: "Kukatpally", phone: "98481 77001", creditLimit: 0, outstanding: 0 });
  // All original trading partners belong to org1; org2 has separate sample data.
  const partyOrgIds: Record<string, string> = Object.fromEntries(parties.map((p) => [p.id, "org1"]));
  parties.push({ id: "p9", kind: "customer", name: "Vijayawada Trade Customer", stateCode: "37", stateName: "Andhra Pradesh", city: "Vijayawada", phone: "", creditLimit: 100000, outstanding: 0, blocked: false, creditDays: 30 });
  partyOrgIds["p9"] = "org2";
  const P = (i: number) => parties[i]!;
  const I = (i: number) => items[i]!;
  const so = (
    id: string, num: string | null, date: string, cust: Party, status: SalesOrder["status"],
    lines: SalesOrder["lines"], linked: SalesOrder["linked"] = [],
  ): SalesOrder => {
    const t = computeTotals(lines, supplyType("36", cust.stateCode));
    return {
      id, number: num, date, customerId: cust.id, customerName: cust.name, placeOfSupplyCode: cust.stateCode,
      placeOfSupplyName: cust.stateName, godownId: "g1", status, lines, notes: "", grandTotal: t.grandTotal, linked,
    };
  };
  const L = (id: string, it: Item, qty: number, delivered = 0, disc = 0) => ({
    id, itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, qty, deliveredQty: delivered,
    rate: it.salePrice, discountPct: disc, gstRate: it.gstRate,
  });
  const salesOrders: SalesOrder[] = [
    so("so41", "SO/26-27/0041", "2026-10-07", P(0), "confirmed", [L("l1", I(0), 320), L("l2", I(1), 2400, 0, 2)]),
    so("so42", null, "2026-10-08", P(1), "draft", [L("l3", I(2), 24), L("l4", I(0), 150)]),
    so("so38", "SO/26-27/0038", "2026-10-01", P(2), "partially_delivered", [L("l5", I(0), 600, 400), L("l6", I(4), 3000, 3000)], [
      { type: "delivery_challan", number: "DC/26-27/0112", date: "2026-10-03", status: "Delivered", amount: 386400 },
      { type: "tax_invoice", number: "SVT/26-27/0287", date: "2026-10-04", status: "Awaiting payment", amount: 386400 },
    ]),
    so("so35", "SO/26-27/0035", "2026-09-22", P(3), "delivered", [L("l7", I(1), 8000, 8000)], [
      { type: "delivery_challan", number: "DC/26-27/0104", date: "2026-09-23", status: "Delivered", amount: 590000 },
      { type: "tax_invoice", number: "SVT/26-27/0271", date: "2026-09-24", status: "Paid", amount: 590000 },
      { type: "receipt", number: "RCT/26-27/0198", date: "2026-10-02", status: "Cleared", amount: 590000 },
    ]),
    so("so40", "SO/26-27/0040", "2026-10-06", P(2), "confirmed", [L("l8", I(3), 200)]),
  ];
  const users = [
    { id: "u1", name: "Venkat Rao", email: "owner@svt.in", role: "Owner" as const, password: "girder", mobile: "98490 10001", godownIds: ["g1", "g2", "g3"], active: true, lastLogin: "2026-10-08" },
    { id: "u2", name: "Srinivas K", email: "manager@svt.in", role: "Manager" as const, password: "girder", mobile: "98490 10002", godownIds: ["g1", "g2", "g3"], active: true, lastLogin: "2026-10-08" },
    { id: "u3", name: "Ramesh P", email: "store@svt.in", role: "Storekeeper" as const, password: "girder", mobile: "98490 10003", godownIds: ["g1"], active: true, lastLogin: "2026-10-08" },
    { id: "u5", name: "Anitha R", email: "sales@svt.in", role: "Sales" as const, password: "girder", mobile: "98490 10005", godownIds: ["g1", "g2", "g3"], active: true, lastLogin: "2026-10-07" },
    { id: "u6", name: "Prasad M", email: "accounts@svt.in", role: "Accountant" as const, password: "girder", mobile: "98490 10006", godownIds: ["g1", "g2", "g3"], active: true, lastLogin: "2026-10-06" },
    { id: "u4", name: "Yadagiri", email: "driver@svt.in", role: "Driver" as const, password: "girder", mobile: "98490 10004", godownIds: ["g1"], active: true, lastLogin: "2026-10-08" },
    { id: "u7", name: "Vijayawada Owner", email: "owner@vijayawada.example", role: "Owner" as const, password: "girder", mobile: "9849010007", godownIds: ["g4"], active: true },
  ];
  const notifications: Notification[] = [
    { id: "n1", title: "Century BWP 19mm out of stock at Balanagar", time: "10 min ago", read: false },
    { id: "n2", title: "E-way bill for DC/26-27/0112 expires tomorrow", time: "1 h ago", read: false },
    { id: "n3", title: "Invoice SVT/26-27/0263 is 12 days overdue", time: "Yesterday", read: true },
  ];
  const uoms: Uom[] = [
    ["BAG", "Bag (50 kg)", "count", 0], ["MT", "Metric tonne", "weight", 3], ["KG", "Kilogram", "weight", 2],
    ["SHT", "Sheet", "count", 0], ["SQFT", "Square foot", "area", 2], ["CFT", "Cubic foot", "volume", 2],
    ["NOS", "Numbers", "count", 0], ["ROD", "Rod", "count", 0], ["BDL", "Bundle", "count", 0],
    ["BKT", "Bucket", "count", 0], ["TRUCK", "Truck load", "count", 0],
  ].map(([code, name, category, decimals], i) => ({ id: `u${i + 1}`, code, name, category, decimals, active: true }) as Uom);
  const categories: Category[] = [
    { id: "c1", name: "Cement", parentId: null, defaultHsn: "2523", defaultGst: 28, active: true },
    { id: "c2", name: "Steel", parentId: null, defaultHsn: "7214", defaultGst: 18, active: true },
    { id: "c3", name: "TMT bars", parentId: "c2", defaultHsn: "7214", defaultGst: 18, active: true },
    { id: "c4", name: "Binding wire", parentId: "c2", defaultHsn: "7217", defaultGst: 18, active: true },
    { id: "c5", name: "Plywood", parentId: null, defaultHsn: "4412", defaultGst: 18, active: true },
    { id: "c6", name: "Paint", parentId: null, defaultHsn: "3208", defaultGst: 18, active: true },
  ];
  const brands: Brand[] = ["UltraTech", "Birla A1", "JSW Neosteel", "Century Ply", "Asian Paints", "Tata Tiscon"].map(
    (name, i) => ({ id: `br${i + 1}`, name, active: i !== 5 }),
  );
  const hsn: HsnRate[] = [
    { id: "h1", code: "2523", description: "Portland cement", gstRate: 28, cessPct: 0, effectiveFrom: "2017-07-01", active: true },
    { id: "h2", code: "7214", description: "Bars and rods of iron or non-alloy steel", gstRate: 18, cessPct: 0, effectiveFrom: "2017-07-01", active: true },
    { id: "h3", code: "7217", description: "Wire of iron or non-alloy steel", gstRate: 18, cessPct: 0, effectiveFrom: "2017-07-01", active: true },
    { id: "h4", code: "4412", description: "Plywood, veneered panels", gstRate: 18, cessPct: 0, effectiveFrom: "2017-11-15", active: true },
    { id: "h5", code: "3208", description: "Paints and varnishes", gstRate: 18, cessPct: 0, effectiveFrom: "2017-11-15", active: true },
  ];
  const seedDc = (id: string, number: string, date: string, o: SalesOrder, lineIdx: number, qty: number, invoiceNo: string, vehicleNo: string, driverName: string): Challan => {
    const l = o.lines[lineIdx]!;
    const lines: ChallanLine[] = [{ soLineId: l.id, itemId: l.itemId, itemName: l.itemName, hsn: l.hsn, uom: l.uom, qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate, allocations: [{ qty }] }];
    const t = computeTotals(lines, supplyType("36", o.placeOfSupplyCode));
    const at = `${date}T10:30:00.000Z`;
    return {
      id, number, date, soId: o.id, soNumber: o.number!, customerId: o.customerId, customerName: o.customerName,
      placeOfSupplyCode: o.placeOfSupplyCode, placeOfSupplyName: o.placeOfSupplyName, godownId: "g1", godownName: "Balanagar",
      status: "delivered", lines, taxable: t.taxable, tax: t.grandTotal - t.taxable - t.roundOff, value: t.grandTotal,
      vehicleNo, driverName, driverPhone: "9849000000", transporter: "Own vehicle", distanceKm: 18,
      ewb: { number: `TEST${id.replace(/\D/g, "").padStart(8, "0")}`, generatedAt: at, validUntil: ewbValidUntil(at, 18), vehicleNo, distanceKm: 18, status: "active", history: [{ at, action: "Generated", by: "Ramesh P" }] },
      pod: { at: `${date}T15:10:00.000Z`, receivedBy: "Site supervisor", remarks: "Received in good condition", by: driverName },
      events: [
        { at, label: "Stock posted", by: "Ramesh P" }, { at, label: "E-way bill generated", by: "Ramesh P" },
        { at, label: "Vehicle departed", by: "Ramesh P" }, { at: `${date}T15:10:00.000Z`, label: "POD received", by: driverName },
      ],
      invoiceNo,
    };
  };
  const challans: Challan[] = [
    seedDc("dc112", "DC/26-27/0112", "2026-10-03", salesOrders[2]!, 0, 400, "SVT/26-27/0287", "TS09EA4521", "Yadagiri"),
    seedDc("dc104", "DC/26-27/0104", "2026-09-23", salesOrders[3]!, 0, 8000, "SVT/26-27/0271", "TS08UB9087", "Mallesh"),
  ];
  const P4 = { padding: 4, resetPerFy: true };
  const series: Store["series"] = { SO: { prefix: "SO", ...P4 }, DC: { prefix: "DC", ...P4 }, INV: { prefix: "SVT", ...P4 }, RCT: { prefix: "RCT", ...P4 }, PO: { prefix: "PO", ...P4 }, GRN: { prefix: "GRN", ...P4 }, TRF: { prefix: "TRF", ...P4 }, ADJ: { prefix: "ADJ", ...P4 } };
  const settings: OrgSettings = {
    legalName: "Sri Venkateswara Traders", tradeName: "SVT Building Materials", gstin: orgs[0]!.gstin, pan: orgs[0]!.gstin.slice(2, 12),
    address: "Plot 14, IDA Balanagar, Hyderabad 500037", stateCode: orgs[0]!.stateCode, phone: "040 2377 4411", email: "accounts@svt.in",
    bankName: "HDFC Bank, Balanagar", bankAccount: "50200012345678", ifsc: "HDFC0001234", invoiceTerms: "Goods once sold will not be taken back. Interest @18% p.a. on overdue bills.",
    jurisdiction: "Hyderabad", fyName: "FY 2026-27", fyStart: "2026-04-01", fyEnd: "2027-03-31", fyStatus: "open",
    composition: false, ewbThreshold: 50000, einvoiceThreshold: 50000000, roundOff: "nearest_rupee", adjApprovalLimit: 25000,
    reasonCodes: [
      { id: "rc1", type: "adjustment", code: "DMG", label: "Damage", active: true },
      { id: "rc2", type: "adjustment", code: "THF", label: "Theft", active: true },
      { id: "rc3", type: "override", code: "CRD", label: "Credit limit override", active: true },
      { id: "rc4", type: "cancellation", code: "ERR", label: "Entered in error", active: true },
      { id: "rc5", type: "return", code: "QLT", label: "Quality complaint", active: true },
    ],
    gsp: { provider: "", username: "", clientId: "", sandbox: true, secretSet: false },
  };
  const printProfilesByOrg = Object.fromEntries(orgs.map((org) => [org.id, [clone(PRINT_DEFAULTS.A), clone(PRINT_DEFAULTS.B)]]));
  const itemOrgIds = Object.fromEntries(items.map((i) => [i.id, godowns.find((g) => g.id === i.stock[0]?.godownId)?.orgId ?? "org1"]));
  const masterOrgIds = Object.fromEntries([...uoms, ...categories, ...brands, ...hsn].map((r) => [r.id, "org1"]));
  const salesOrderOrgIds = Object.fromEntries(salesOrders.map((o) => [o.id, partyOrgIds[o.customerId] ?? "org1"]));
  const challanOrgIds = Object.fromEntries(challans.map((c) => [c.id, salesOrderOrgIds[c.soId] ?? "org1"]));
  const settingsByOrg: Record<string, OrgSettings> = {
    org1: settings,
    org2: { ...settings, legalName: orgs[1]!.name, tradeName: orgs[1]!.name, gstin: orgs[1]!.gstin,
      pan: orgs[1]!.gstin.slice(2, 12), stateCode: orgs[1]!.stateCode, address: "Auto Nagar, Vijayawada 520007",
      phone: "", email: "", bankName: "", bankAccount: "", ifsc: "", invoiceTerms: "" },
  };
  store = { seriesByOrg: Object.fromEntries(orgs.map((org) => [org.id, clone(series)])),
    userOrgIds: Object.fromEntries(users.map((u) => [u.id, u.id === "u7" ? ["org2"] : ["org1"]])),
    issuedByOrg: { org2: {} },
    settingsByOrg, printProfilesByOrg, users, orgs, godowns, items, itemOrgIds, parties, partyOrgIds, salesOrders, salesOrderOrgIds, soSeq: 42, notifications, masters: { uoms, categories, brands, hsn }, masterOrgIds, challans, challanOrgIds, dcSeq: 112, posted: [], invoices: [], invoiceOrgIds: {}, invSeq: 287, receipts: [], receiptOrgIds: {}, advanceOrgIds: { adv1: "org1", adv2: "org1" }, rctSeq: 0, pos: [], poOrgIds: {}, poSeq: 18, grns: [], grnOrgIds: {}, grnSeq: 45, transfers: [], transferOrgIds: {}, trfSeq: 31, adjustments: [], adjustmentOrgIds: {}, adjSeq: 10, advances: [
    { id: "adv1", receiptNo: "RCT/26-27/0201", date: "2026-09-28", customerId: "p1", amount: 50000, remaining: 50000 },
    { id: "adv2", receiptNo: "RCT/26-27/0209", date: "2026-10-05", customerId: "p1", amount: 100000, remaining: 100000 },
  ] };
  store.receipts = [
    { id: "r198", number: "RCT/26-27/0198", date: "2026-10-02", customerId: "p4", customerName: "Sai Krishna Infra Projects", amount: 590000, mode: "neft", reference: "UTR HDFC26100211", allocations: [{ invoiceId: "inv271", invoiceNo: "SVT/26-27/0271", amount: 590000 }], advance: 0, createdBy: "Srinivas K" },
    { id: "r201", number: "RCT/26-27/0201", date: "2026-09-28", customerId: "p1", customerName: "Rajesh Constructions", amount: 50000, mode: "upi", reference: "UPI 426812345678", allocations: [], advance: 50000, createdBy: "Srinivas K" },
    { id: "r209", number: "RCT/26-27/0209", date: "2026-10-05", customerId: "p1", customerName: "Rajesh Constructions", amount: 100000, mode: "cheque", reference: "Chq 004512 SBI", allocations: [], advance: 100000, createdBy: "Venkat Rao" },
  ];
  store.receiptOrgIds = Object.fromEntries(store.receipts.map((r) => [r.id, partyOrgIds[r.customerId] ?? "org1"]));
  store.rctSeq = 209;
  store.transfers = [{
    id: "trf31", number: "TRF/26-27/0031", date: "2026-10-05", fromId: "g1", fromName: "Balanagar", toId: "g2", toName: "Jeedimetla",
    status: "in_transit", vehicleNo: "TS08UB9087", reason: "Restock Jeedimetla for weekend orders",
    lines: [{ itemId: I(0).id, itemName: I(0).name, uom: I(0).baseUom, batchNo: "UT-2608-A", qty: 120, unitCost: I(0).costPrice }],
    value: 120 * I(0).costPrice, events: [{ at: "2026-10-05T09:40:00.000Z", label: "Dispatched", by: "Ramesh P" }],
  }];
  store.transferOrgIds["trf31"] = "org1";
  // Seeded in-transit inventory has already left the source: keep balances, batches and ledger consistent.
  moveStock(I(0), "g1", -120, "UT-2608-A");
  store.posted.push({ id: "posted-transfer-31", at: "2026-10-05T09:40", docNo: "TRF/26-27/0031", docType: "transfer", type: "TRANSFER_OUT",
    itemId: I(0).id, itemName: I(0).name, godownId: "g1", godownName: "Balanagar", batchNo: "UT-2608-A", qty: -120,
    unitCost: I(0).costPrice, user: "Ramesh P" });
  {
    const mk = (id: string, num: string, date: string, sup: Party, lines: [Item, number, number, number][]): PurchaseOrder => {
      const ls = lines.map(([it, qty, rate, rec], n) => ({ id: `${id}l${n}`, itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, gstRate: it.gstRate, qty, receivedQty: rec, rate }));
      return { id, number: num, date, supplierId: sup.id, supplierName: sup.name, godownId: "g1", godownName: "Balanagar", status: poStatus(ls), lines: ls,
        grandTotal: computeTotals(ls.map((l) => ({ ...l, discountPct: 0 })), supplyType("36", sup.stateCode)).grandTotal, notes: "", grns: [], createdBy: "Venkat Rao" };
    };
    store.pos = [
      mk("po18", "PO/26-27/0018", "2026-10-06", P(5), [[I(0), 1000, 330, 0]]),
      mk("po17", "PO/26-27/0017", "2026-10-02", P(6), [[I(1), 6000, 58, 0], [I(4), 2000, 61, 0]]),
    ];
    store.poOrgIds = Object.fromEntries(store.pos.map((po) => [po.id, partyOrgIds[po.supplierId] ?? "org1"]));
  }
  {
    const it = items.find((x) => x.name.startsWith("UltraTech"))!;
    store.adjustments.push({ id: "adj10", number: "ADJ/26-27/0010", date: "2026-10-07", godownId: "g1", godownName: "Balanagar", reason: "damage",
      notes: "Rain leak in bay 3, bags set hard", status: "pending_approval", lines: [{ itemId: it.id, itemName: it.name, uom: it.baseUom, batchNo: "UT-2608-A", direction: "down", qty: 90, unitCost: it.costPrice }],
      valueUp: 0, valueDown: 90 * it.costPrice, createdBy: "Ramesh (Storekeeper)", createdByRole: "Storekeeper",
      events: [{ at: "2026-10-07T17:10:00Z", label: "Submitted for approval", by: "Ramesh (Storekeeper)" }] });
    store.adjustmentOrgIds["adj10"] = "org1";
  }
  store.invoices = [seedInv(store, "inv287", "SVT/26-27/0287", "dc112", 0), seedInv(store, "inv271", "SVT/26-27/0271", "dc104", 590000)];
  for (const inv of store.invoices) store.invoiceOrgIds[inv.id] = store.challanOrgIds[inv.challans[0]!.id]!;
  return store;
}

function role() {
  return getSession()?.user.role ?? "Driver";
}

// ---------- Auth ----------
export async function login(email: string, password: string): Promise<LoginResponse> {
  await delay(400);
  const u = db().users.find((x) => x.email === email.trim().toLowerCase());
  if (!u || u.password !== password) throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
  if (!u.active) throw new ApiError(403, "user_inactive", "This user has been deactivated. Ask the owner.");
  const user: User = { id: u.id, name: u.name, email: u.email, role: u.role };
  u.lastLogin = nowIso().slice(0, 10);
  return { token: `mock.${u.id}`, user, orgs: clone(db().orgs) };
}

export async function listGodowns(orgId: string): Promise<Godown[]> {
  await delay(100);
  return clone(db().godowns.filter((g) => g.orgId === orgId));
}

export async function listNotifications(): Promise<Notification[]> {
  await delay(150);
  return clone(db().notifications);
}

// ---------- Dashboard ----------
export async function getDashboard(godownId: string | "all"): Promise<Dashboard> {
  await delay();
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  const godowns = s.godowns.filter((g) => g.orgId === orgId);
  if (godownId !== "all" && !godowns.some((g) => g.id === godownId)) {
    throw new ApiError(404, "godown_not_found", "Godown not found in this organisation");
  }
  const selected = godowns.filter((g) => godownId === "all" || g.id === godownId);
  const ids = new Set(selected.map((g) => g.id));
  const alerts = computeAlerts(s.items.filter((it) => s.itemOrgIds[it.id] === orgId), selected, MOCK_TODAY,
    new Set([...acked].filter((key) => key.startsWith(`${orgId}:`)).map((key) => key.slice(orgId.length + 1))));
  const inventory = dashboardInventory(s.items, godowns, godownId, alerts);
  const earliest = new Date(Date.parse(`${MOCK_TODAY}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const ledger = [...generateLedger(s), ...s.posted].filter(
    (row) => ids.has(row.godownId) && row.type !== "OPENING" && row.at.slice(0, 10) >= earliest && row.at.slice(0, 10) <= MOCK_TODAY,
  );
  const types = { grn: "Purchase", challan: "Sale", transfer: "Transfer", adjustment: "Adjustment", opening: "Adjustment" } as const;
  const relatedChallans = new Set(s.challans.filter((c) => ids.has(c.godownId)).map((c) => c.id));
  const overdue = s.invoices.filter((invoice) => invoice.balance > 0 && invoice.dueDate < MOCK_TODAY && invoice.status !== "cancelled"
    && (godownId === "all" || invoice.challans.some((c) => relatedChallans.has(c.id))));
  const attention: Dashboard["attention"] = [
    ...alerts.filter((a) => a.kind === "out_of_stock" || a.kind === "below_reorder" || a.kind === "near_expiry" || a.kind === "over_aged")
      .slice(0, 4).map((a) => ({
        id: a.id,
        kind: (a.kind === "below_reorder" ? "low_stock" : a.kind) as Dashboard["attention"][number]["kind"],
        title: a.itemName + (a.batchNo ? ` · ${a.batchNo}` : ""),
        detail: `${a.qty} ${a.uom} at ${a.godownName}`,
      })),
    ...overdue.slice(0, 3).map((invoice) => ({
      id: invoice.id, kind: "overdue" as const, title: `Invoice ${invoice.number}`,
      detail: `${invoice.customerName} · ₹${invoice.balance.toLocaleString("en-IN")} overdue`,
    })),
  ];

  return {
    asOfDate: MOCK_TODAY, // Demo fixture date; real API uses the current India business date.
    ...inventory,
    movementsToday: ledger.filter((m) => m.at.slice(0, 10) === MOCK_TODAY).length,
    highValueMovements: ledger
      .sort((a, b) => Math.abs(b.qty * b.unitCost) - Math.abs(a.qty * a.unitCost) || b.at.localeCompare(a.at))
      .slice(0, 5)
      .map((m) => ({
        id: m.id, date: m.at.slice(0, 10), docNo: m.docNo,
        type: types[m.docType], itemName: m.itemName, godownName: m.godownName,
        qty: m.qty, value: Math.round(Math.abs(m.qty * m.unitCost)),
      })),
    attention,
    pipeline: dashboardPipeline(s.salesOrders.filter((o) => godowns.some((g) => g.id === o.godownId)), godownId),
  };
}

// ---------- Items ----------
export async function listItems(q = ""): Promise<Item[]> {
  await delay();
  const s = db();
  const orgId = getSession()?.orgId;
  return clone(s.items.filter((i) => (!orgId || s.itemOrgIds[i.id] === orgId) && matches(`${i.name} ${i.sku} ${i.hsn} ${i.brand}`, q)));
}

export async function getItem(id: string): Promise<Item> {
  await delay();
  const s = db();
  const it = s.items.find((i) => i.id === id && (!getSession()?.orgId || s.itemOrgIds[i.id] === getSession()?.orgId));
  if (!it) throw new ApiError(404, "not_found", "Item not found");
  return clone(it);
}

export async function updateItem(id: string, patch: ItemEditPatch): Promise<Item> {
  await delay(300);
  if (!can(role(), "editItems")) throw new ApiError(403, "forbidden", "Your role cannot edit items");
  const s = db();
  const it = s.items.find((i) => i.id === id && (!getSession()?.orgId || s.itemOrgIds[i.id] === getSession()?.orgId));
  if (!it) throw new ApiError(404, "not_found", "Item not found");
  // Mirror Express: the item editor may change only master fields and reorder
  // thresholds, never quantities, reservations, ids or recorded batches.
  const allowed = ["sku", "name", "category", "brand", "hsn", "gstRate", "baseUom", "conversions", "salePrice", "costPrice", "allowNegative", "trackBatches", "active"] as const;
  if (Object.keys(patch).some((key) => key !== "stock" && !allowed.includes(key as (typeof allowed)[number]))) {
    throw new ApiError(422, "validation", "Stock quantities and batches cannot be edited here");
  }
  if (patch.stock?.some((x) => Object.keys(x).some((k) => !["godownId", "reorderLevel", "maxLevel"].includes(k)))) {
    throw new ApiError(422, "validation", "Stock quantities and reservations cannot be edited here");
  }
  const next = clone(it);
  for (const key of allowed) {
    if (patch[key] !== undefined) Object.assign(next, { [key]: patch[key] });
  }
  const orgId = getSession()?.orgId;
  const godownIds = s.godowns.filter((g) => !orgId || g.orgId === orgId).map((g) => g.id);
  for (const threshold of patch.stock ?? []) {
    if (!godownIds.includes(threshold.godownId)) throw new ApiError(422, "invalid_godown", "Godown does not belong to this organisation");
    const cur = next.stock.find((x) => x.godownId === threshold.godownId);
    if (cur) { cur.reorderLevel = threshold.reorderLevel; cur.maxLevel = threshold.maxLevel; }
    else next.stock.push({ ...threshold, onHand: 0, held: 0 });
  }
  const errors = itemEditProblems(next, it, godownIds);
  if (errors.length) throw new ApiError(422, "validation", errors.join(" "));
  if (next.sku.trim() !== it.sku && s.items.some((other) => other.id !== id && s.itemOrgIds[other.id] === orgId && other.sku === next.sku.trim())) {
    throw new ApiError(409, "duplicate_sku", "SKU already exists in this organisation");
  }
  Object.assign(it, normaliseItemDraft(next));
  return clone(it);
}

/** Token match: every word in q must appear (cheap stand-in for server trigram search). */
function matches(text: string, q: string) {
  const t = text.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

// ---------- Parties ----------
export async function listParties(kind?: Party["kind"], q = ""): Promise<Party[]> {
  await delay(150);
  const orgId = getSession()?.orgId;
  if (!orgId) throw new ApiError(403, "forbidden", "Select an organisation");
  const s = db();
  return clone(filterParties(partiesForOrg(s.parties, s.partyOrgIds, orgId), kind ?? "all", q, "all"));
}

export async function getParty(id: string): Promise<Party> {
  await delay(150);
  const s = db();
  const p = partiesForOrg(s.parties, s.partyOrgIds, getSession()?.orgId ?? "").find((x) => x.id === id);
  if (!p) throw new ApiError(404, "not_found", "Party not found");
  return clone(p);
}

function requireMastersRole() {
  if (!can(role(), "editMasters")) throw new ApiError(403, "forbidden", "Only Owner or Manager can edit masters");
}

export async function saveParty(input: PartyInput): Promise<Party> {
  await delay(150);
  if (!can(role(), "editParties")) throw new ApiError(403, "forbidden", "Your role cannot edit parties");
  const s = db();
  const orgId = getSession()?.orgId;
  if (!orgId) throw new ApiError(403, "forbidden", "Select an organisation");
  // The demo cannot change or create financial balances through a master form.
  if ("outstanding" in input || "stateName" in input || "orgId" in input) throw new ApiError(422, "validation", "Protected party fields cannot be edited");
  const existing = input.id ? partiesForOrg(s.parties, s.partyOrgIds, orgId).find((p) => p.id === input.id) : undefined;
  if (input.id && !existing) throw new ApiError(404, "not_found", "Party not found in this organisation");
  const normal = normaliseParty(input);
  const problems = partyProblems(normal);
  if (problems.length) throw new ApiError(422, "validation", problems.join(". "));
  const dup = duplicatePartyGstin(partiesForOrg(s.parties, s.partyOrgIds, orgId), normal);
  if (dup) throw new ApiError(409, "duplicate_gstin", `GSTIN already used by ${dup.name}`);
  const id = existing?.id ?? `p${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
  const row: Party = { ...normal, id, stateName: partyStateName(normal.stateCode), outstanding: existing?.outstanding ?? 0 };
  if (existing) Object.assign(existing, row);
  else { s.parties.push(row); s.partyOrgIds[id] = orgId; }
  return clone(row);
}

// ---------- Godowns ----------
function requireGodownOrg(orgId: string): void {
  if (!getSession() || getSession()?.orgId !== orgId) throw new ApiError(403, "forbidden", "Wrong organisation");
}

export async function getWarehouseActivity(orgId: string, warehouseId: string): Promise<WarehouseActivity> {
  await delay(120);
  requireGodownOrg(orgId);
  const s = db();
  if (!s.godowns.some((g) => g.id === warehouseId && g.orgId === orgId))
    throw new ApiError(404, "not_found", "Warehouse not found in this organisation");
  if (!["Owner", "Manager", "Storekeeper"].includes(role()))
    throw new ApiError(403, "forbidden", "Your role cannot view warehouse activity");
  const entries = [...generateLedger(s), ...s.posted].filter((entry) =>
    entry.godownId === warehouseId && s.itemOrgIds[entry.itemId] === orgId);
  const date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return clone(warehouseActivityFromLedger(entries, warehouseId, warehouseActivityPeriod(date), date));
}

export async function listGodownsDetailed(orgId: string): Promise<Godown[]> {
  await delay(150);
  requireGodownOrg(orgId);
  const store = db();
  const items = store.items.filter((it) => store.itemOrgIds[it.id] === orgId);
  return clone(store.godowns.filter((g) => g.orgId === orgId).map((g) => {
    const stock = warehouseStockSummary(items, g.id);
    return { ...g, stockValue: stock.stockValue, stockQty: stock.onHand, heldQty: stock.held, itemCount: stock.itemCount };
  }));
}

export async function saveGodown(orgId: string, input: GodownInput): Promise<Godown> {
  await delay(300);
  requireMastersRole();
  requireGodownOrg(orgId);
  const d = db();
  const existing = input.id ? d.godowns.find((g) => g.id === input.id && g.orgId === orgId) : undefined;
  if (input.id && !existing) throw new ApiError(404, "not_found", "Warehouse not found in this organisation");
  const normal = normaliseGodown(input);
  const problems = godownProblems(normal);
  if (problems.length) throw new ApiError(422, "validation", problems.join(". "));
  if (d.godowns.some((g) => g.orgId === orgId && g.code.toUpperCase() === normal.code && g.id !== input.id)) {
    throw new ApiError(409, "duplicate_code", `Code ${normal.code} is already used`);
  }
  if (existing?.active && !normal.active) {
    const stockRows = d.items.filter((i) => d.itemOrgIds[i.id] === orgId)
      .flatMap((i) => i.stock.filter((s) => s.godownId === existing.id));
    if (!canDeactivateWarehouse(stockRows)) {
      throw new ApiError(409, "has_stock", `${existing.name} has stock or held reservations. Clear both before deactivating.`);
    }
  }
  if (normal.defaultForSales) d.godowns.forEach((g) => { if (g.orgId === orgId) g.defaultForSales = false; });
  const row: Godown = { ...(existing ?? {}), ...normal, orgId, id: existing?.id ?? `g${Date.now()}` };
  delete row.stockValue;
  delete row.stockQty;
  delete row.heldQty;
  delete row.itemCount;
  if (existing) Object.assign(existing, row);
  else d.godowns.push(row);
  return clone(row);
}

// ---------- Simple masters ----------
export async function listMaster<K extends MasterKind>(kind: K): Promise<MasterRows[K][]> {
  await delay(150);
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  return clone(s.masters[kind].filter((r) => s.masterOrgIds[r.id] === orgId)) as MasterRows[K][];
}

export async function saveMaster<K extends MasterKind>(kind: K, row: Omit<MasterRows[K], "id"> & { id?: string }): Promise<MasterRows[K]> {
  await delay(250);
  requireMastersRole();
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  const list = s.masters[kind] as unknown as (MasterRows[K] & { id: string })[];
  const previous = row.id ? list.find((r) => r.id === row.id && s.masterOrgIds[r.id] === orgId) : undefined;
  if (row.id && !previous) throw new ApiError(404, "not_found", "Master record was not found in this organisation");
  const input = normaliseMaster(kind, row) as Record<string, unknown>;
  const categories = s.masters.categories.filter((c) => s.masterOrgIds[c.id] === orgId);
  const issues = masterProblems(kind, input, categories, previous as Record<string, unknown> | undefined);
  if (issues.length) throw new ApiError(422, "validation", issues.join(" "));
  const key = kind === "brands" || kind === "categories" ? "name" : "code";
  const val = String(input[key]);
  const dup = list.find((r) => s.masterOrgIds[r.id] === orgId && r.id !== row.id
    && String((r as unknown as Record<string, unknown>)[key]).toLocaleLowerCase() === val.toLocaleLowerCase()
    && (kind !== "hsn" || (r as unknown as HsnRate).effectiveFrom === input["effectiveFrom"]));
  if (dup) throw new ApiError(409, "duplicate", `${val} already exists in this organisation`);
  const saved = { ...input, id: previous?.id ?? `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } as MasterRows[K] & { id: string };
  if (previous) Object.assign(previous, saved);
  else { list.push(saved); s.masterOrgIds[saved.id] = orgId; }
  return clone(saved);
}

// ---------- Sales orders ----------
export async function listSalesOrders(status?: string): Promise<SalesOrder[]> {
  await delay();
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  return clone(
    salesOrdersForOrg(s.salesOrders, s.salesOrderOrgIds, orgId)
      .filter((o) => !status || status === "all" || o.status === status)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
  );
}

export async function getSalesOrder(id: string): Promise<SalesOrder> {
  await delay();
  const s = db();
  const o = salesOrdersForOrg(s.salesOrders, s.salesOrderOrgIds, getSession()?.orgId ?? "org1").find((x) => x.id === id);
  if (!o) throw new ApiError(404, "not_found", "Sales order not found");
  return clone(o);
}

export async function saveSalesOrder(input: SalesOrderInput): Promise<SalesOrder> {
  if (!can(role(), "salesOrders")) throw new ApiError(403, "forbidden", "Your role cannot change sales orders");
  await delay(300);
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  const problems = orderDraftProblems(input);
  if (problems.length) throw new ApiError(422, "validation", problems[0]!, problems);
  const cust = s.parties.find((p) => p.id === input.customerId && s.partyOrgIds[p.id] === orgId);
  if (!cust || !orderCustomerEligible(cust.kind, !!cust.blocked)) throw new ApiError(422, "validation", "Select an active customer");
  const godown = s.godowns.find((g) => g.id === input.godownId && g.orgId === orgId && g.active);
  if (!godown) throw new ApiError(422, "validation", "Select an active godown");
  const existing = input.id ? s.salesOrders.find((o) => o.id === input.id && s.salesOrderOrgIds[o.id] === orgId) : undefined;
  if (input.id && !existing) throw new ApiError(404, "not_found", "Sales order not found");
  if (existing && existing.status !== "draft") throw new ApiError(409, "invalid_status", "Only draft orders can be edited");
  const lines = input.lines.map((l, i) => {
    const it = s.items.find((item) => item.id === l.itemId && s.itemOrgIds[item.id] === orgId);
    if (!it) throw new ApiError(404, "not_found", "Item not found in this organisation");
    if (!it.active) throw new ApiError(422, "validation", `${it.name} is inactive`);
    if (it.baseUom !== l.uom) throw new ApiError(422, "validation", `${it.name}: use the base unit ${it.baseUom}`);
    return { ...l, itemName: it.name, hsn: it.hsn, gstRate: it.gstRate, uom: it.baseUom, id: `sol${Date.now()}${i}`, deliveredQty: 0 };
  });
  const org = s.orgs.find((o) => o.id === orgId)!;
  const t = computeTotals(lines, supplyType(org.stateCode, cust.stateCode));
  const base: SalesOrder = {
    id: existing?.id ?? `so${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    number: null,
    date: input.date,
    customerId: cust.id,
    customerName: cust.name,
    placeOfSupplyCode: cust.stateCode,
    placeOfSupplyName: cust.stateName,
    godownId: input.godownId,
    status: "draft",
    notes: input.notes,
    lines,
    grandTotal: t.grandTotal,
    linked: existing?.linked ?? [],
  };
  if (existing) Object.assign(existing, base);
  else { s.salesOrders.push(base); s.salesOrderOrgIds[base.id] = orgId; }
  return clone(base);
}

export async function confirmSalesOrder(id: string, override?: { reason: string }): Promise<SalesOrder> {
  if (!can(role(), "salesOrders")) throw new ApiError(403, "forbidden", "Your role cannot change sales orders");
  await delay(400);
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  const o = s.salesOrders.find((x) => x.id === id && s.salesOrderOrgIds[x.id] === orgId);
  if (!o) throw new ApiError(404, "not_found", "Sales order not found");
  if (o.status !== "draft") throw new ApiError(409, "invalid_status", "Only draft orders can be confirmed");
  const cust = s.parties.find((p) => p.id === o.customerId && s.partyOrgIds[p.id] === orgId);
  if (!cust || !orderCustomerEligible(cust.kind, !!cust.blocked)) throw new ApiError(422, "blocked", "Customer is unavailable or blocked");
  if (!s.godowns.some((g) => g.id === o.godownId && g.orgId === orgId && g.active)) throw new ApiError(422, "validation", "The dispatch godown is inactive");
  const errors = orderDraftProblems(o);
  if (errors.length) throw new ApiError(422, "validation", errors[0]!, errors);
  const items = s.items.filter((it) => s.itemOrgIds[it.id] === orgId);
  const shortages = stockHoldProblems(o.lines, o.godownId, items);
  if (shortages.length) throw new ApiError(409, "insufficient_stock", "Not enough free stock", shortages);
  if (o.lines.some((l) => l.uom !== items.find((it) => it.id === l.itemId)?.baseUom)) throw new ApiError(422, "validation", "An item unit has changed; reopen the draft");
  const cc = creditCheck(cust.creditLimit, cust.outstanding, o.grandTotal);
  if (cc.exceeds) {
    if (!override) throw new ApiError(409, "credit_limit", "Credit limit exceeded", cc);
    if (!canOverrideCredit(role())) throw new ApiError(403, "forbidden", "Only an Owner can override the credit limit");
    if (override.reason.trim().length < 3 || override.reason.length > 500) throw new ApiError(422, "validation", "Give an override reason (3–500 characters)");
    o.creditOverride = { by: getSession()?.user.name ?? "Owner", reason: override.reason.trim(), at: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) };
  }
  for (const l of o.lines) {
    const it = items.find((i) => i.id === l.itemId)!;
    let g = it.stock.find((x) => x.godownId === o.godownId);
    if (!g) { g = { godownId: o.godownId, onHand: 0, held: 0, reorderLevel: 0, maxLevel: 0 }; it.stock.push(g); }
    g.held += l.qty;
  }
  s.soSeq += 1;
  o.number = fmtNo("SO", s.soSeq);
  o.status = "confirmed";
  return clone(o);
}

export async function cancelSalesOrder(id: string): Promise<SalesOrder> {
  if (!can(role(), "salesOrders")) throw new ApiError(403, "forbidden", "Your role cannot cancel sales orders");
  await delay(300);
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  const o = s.salesOrders.find((x) => x.id === id && s.salesOrderOrgIds[x.id] === orgId);
  if (!o) throw new ApiError(404, "not_found", "Sales order not found");
  if (o.status !== "draft" && o.status !== "confirmed") throw new ApiError(409, "invalid_status", "This order can no longer be cancelled");
  if (o.status === "confirmed") {
    for (const l of o.lines) {
      const g = s.items.find((i) => i.id === l.itemId)?.stock.find((x) => x.godownId === o.godownId);
      if (g) g.held = Math.max(0, g.held - l.qty);
    }
  }
  o.status = "cancelled";
  return clone(o);
}

// ---------- Stock ledger & alerts ----------
export const MOCK_TODAY = "2026-10-08";
const acked = new Set<string>();

function generateLedger(s: Store): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let n = 0;
  const users = ["Ramesh P", "Srinivas K", "Anil M"];
  for (const it of s.items) {
    for (const row of it.stock) {
      const g = s.godowns.find((x) => x.id === row.godownId);
      if (!g) continue;
      const x = Math.max(row.onHand, row.reorderLevel, 10);
      const r = (f: number) => Math.round(x * f);
      const batch = it.batches.find((b) => b.godownId === g.id)?.batchNo;
      const moves: [string, LedgerEntry["type"], LedgerEntry["docType"], number, string?][] = [
        ["2026-09-03T10:15", "PURCHASE_IN", "grn", r(0.6)],
        ["2026-09-17T15:40", "DC_ISSUE", "challan", -r(0.25)],
        ["2026-09-24T11:05", g.id === "g1" ? "TRANSFER_OUT" : "TRANSFER_IN", "transfer", g.id === "g1" ? -r(0.05) : r(0.05)],
        ["2026-10-02T09:30", "ADJ_OUT", "adjustment", -r(0.02), "Damage in handling"],
        ["2026-10-06T16:20", "DC_ISSUE", "challan", -r(0.15)],
      ];
      const net = moves.reduce((a, m) => a + m[3], 0);
      const postedNet = s.posted.filter((p) => p.itemId === it.id && p.godownId === g.id).reduce((a, p) => a + p.qty, 0);
      const opening = row.onHand - postedNet - net;
      const seq = (p: string) => `${p}/26-27/${String(100 + (++n % 900)).padStart(5, "0")}`;
      const base = { itemId: it.id, itemName: it.name, godownId: g.id, godownName: g.name, unitCost: it.costPrice, ...(batch ? { batchNo: batch } : {}) };
      out.push({ ...base, id: `l${++n}`, at: "2026-04-01T00:00", docNo: "Opening stock", docType: "opening", type: "OPENING", qty: opening, user: "System" });
      for (const [at, type, docType, qty, reason] of moves) {
        if (!qty) continue;
        const prefix = { grn: "GRN", challan: "DC", transfer: "TRF", adjustment: "ADJ", opening: "OPN" }[docType];
        out.push({ ...base, id: `l${++n}`, at, docNo: seq(prefix), docType, type, qty, user: users[n % 3]!, ...(reason ? { reason } : {}) });
      }
    }
  }
  return out;
}

export async function getStockLedger(f: LedgerFilter): Promise<LedgerEntry[]> {
  await delay();
  if (!["Owner", "Manager", "Storekeeper", "Accountant"].includes(getSession()?.user.role ?? ""))
    throw new ApiError(403, "forbidden", "Your role cannot view stock ledger");
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  const godowns = s.godowns.filter((g) => g.orgId === orgId);
  if (f.godownId && f.godownId !== "all" && !godowns.some((g) => g.id === f.godownId))
    throw new ApiError(404, "godown_not_found", "Godown not found in this organisation");
  if (f.itemId && s.itemOrgIds[f.itemId] !== orgId)
    throw new ApiError(404, "item_not_found", "Item not found in this organisation");
  const allowedGodowns = new Set(godowns.map((g) => g.id));
  const all = [...generateLedger(s), ...s.posted].filter((e) =>
    allowedGodowns.has(e.godownId) && s.itemOrgIds[e.itemId] === orgId &&
    (!f.itemId || e.itemId === f.itemId) &&
    (!f.godownId || f.godownId === "all" || e.godownId === f.godownId) &&
    (!f.batchNo || e.batchNo === f.batchNo));
  if (all.length > 5000) throw new ApiError(422, "ledger_too_large", "Choose an item, godown or batch to narrow the ledger below 5,000 movements");
  return clone(all);
}

export async function getAlerts(godownId = "all"): Promise<StockAlert[]> {
  await delay();
  if (!["Owner", "Manager", "Storekeeper"].includes(getSession()?.user.role ?? ""))
    throw new ApiError(403, "forbidden", "Your role cannot view stock alerts");
  const s = db();
  const orgId = getSession()?.orgId ?? "org1";
  const godowns = s.godowns.filter((g) => g.orgId === orgId);
  if (godownId !== "all" && !godowns.some((g) => g.id === godownId))
    throw new ApiError(404, "godown_not_found", "Godown not found in this organisation");
  const gs = godowns.filter((g) => godownId === "all" || g.id === godownId);
  const ownAcked = new Set([...acked].filter((key) => key.startsWith(`${orgId}:`)).map((key) => key.slice(orgId.length + 1)));
  return computeAlerts(s.items.filter((i) => s.itemOrgIds[i.id] === orgId), gs, MOCK_TODAY, ownAcked);
}

export async function acknowledgeAlerts(ids: string[]): Promise<void> {
  await delay(150);
  const orgId = getSession()?.orgId ?? "org1";
  const current = await getAlerts("all");
  const valid = new Set(current.map((a) => a.id));
  if (!ids.length || ids.length > 500 || ids.some((id) => !valid.has(id)))
    throw new ApiError(422, "invalid_alert", "A selected alert is no longer active. Refresh the list.");
  ids.forEach((id) => acked.add(`${orgId}:${id}`));
}

export function __resetMock() {
  acked.clear();
  store = null;
}

// ---------- Bulk import ----------
export async function createItem(input: Omit<Item, "id" | "stock" | "batches">): Promise<Item> {
  await delay(20);
  requireMastersRole();
  const d = db();
  const orgId = getSession()?.orgId ?? "org1";
  if (d.items.some((i) => d.itemOrgIds[i.id] === orgId && i.sku === input.sku)) throw new ApiError(409, "duplicate_sku", `SKU ${input.sku} already exists`);
  const row: Item = { ...input, id: `i${Date.now()}${Math.random().toString(36).slice(2, 6)}`, stock: [], batches: [] };
  d.items.push(row);
  d.itemOrgIds[row.id] = orgId;
  return clone(row);
}

// ---------- Delivery challans ----------
const nowIso = () => new Date().toISOString();
const userName = () => getSession()?.user.name ?? "System";

export async function listChallans(status?: string): Promise<Challan[]> {
  await delay();
  const s = db();
  return clone(challansForOrg(s.challans, s.challanOrgIds, getSession()?.orgId ?? "")
    .filter((c) => (!status || status === "all" || c.status === status) && (role() !== "Driver" || c.driverName.toLowerCase() === userName().toLowerCase()))
    .sort((a, b) => b.number.localeCompare(a.number)));
}

export async function getChallan(id: string): Promise<Challan> {
  await delay();
  const s = db();
  const c = challansForOrg(s.challans, s.challanOrgIds, getSession()?.orgId ?? "").find((x) => x.id === id);
  if (!c || (role() === "Driver" && c.driverName.toLowerCase() !== userName().toLowerCase())) throw new ApiError(404, "not_found", "Challan not found");
  return clone(c);
}

function soStatusAfterDelivery(o: SalesOrder) {
  const sent = o.lines.reduce((a, l) => a + l.deliveredQty, 0);
  o.status = sent === 0 ? "confirmed" : o.lines.every((l) => l.deliveredQty >= l.qty) ? "delivered" : "partially_delivered";
}

function post(s: Store, c: Challan, sign: 1 | -1) {
  const o = s.salesOrders.find((x) => x.id === c.soId)!;
  for (const l of c.lines) {
    const it = s.items.find((i) => i.id === l.itemId)!;
    const g = it.stock.find((x) => x.godownId === c.godownId);
    if (g) {
      g.onHand -= sign * l.qty;
      g.held = Math.max(0, g.held - sign * l.qty);
    }
    for (const a of l.allocations) {
      const b = a.batchNo ? it.batches.find((x) => x.batchNo === a.batchNo && x.godownId === c.godownId) : undefined;
      if (b) b.qty -= sign * a.qty;
      s.posted.push({
        id: `p${s.posted.length + 1}`, at: nowIso().slice(0, 16), docNo: c.number, docType: "challan", soId: c.soId,
        type: sign === 1 ? "DC_ISSUE" : "DC_REVERSE", itemId: it.id, itemName: it.name, godownId: c.godownId, godownName: c.godownName,
        ...(a.batchNo ? { batchNo: a.batchNo } : {}), qty: -sign * a.qty, unitCost: it.costPrice, user: userName(),
      });
    }
    const sl = o.lines.find((x) => x.id === l.soLineId);
    if (sl) sl.deliveredQty += sign * l.qty;
  }
  soStatusAfterDelivery(o);
}

function syncSoLink(s: Store, c: Challan) {
  const o = s.salesOrders.find((x) => x.id === c.soId);
  if (!o) return;
  const label = { in_transit: "In transit", delivered: "Delivered", cancelled: "Cancelled" }[c.status];
  const ex = o.linked.find((d) => d.number === c.number);
  if (ex) ex.status = label;
  else o.linked.push({ type: "delivery_challan", number: c.number, date: c.date, status: label, amount: c.value });
}

export async function dispatchChallan(input: DispatchInput): Promise<Challan> {
  await delay(500);
  if (!can(role(), "dispatch")) throw new ApiError(403, "forbidden", "Your role cannot dispatch challans");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const o = s.salesOrders.find((x) => x.id === input.soId && s.salesOrderOrgIds[x.id] === orgId);
  if (!o) throw new ApiError(404, "not_found", "Sales order not found");
  if (o.status !== "confirmed" && o.status !== "partially_delivered") throw new ApiError(409, "invalid_status", "Only confirmed or partly delivered orders can be dispatched");
  if (!s.godowns.some((g) => g.id === o.godownId && g.orgId === orgId && g.active)) throw new ApiError(422, "validation", "Dispatch godown is inactive or belongs to another organisation");
  const dispatchItems = o.lines.map((l) => s.items.find((i) => i.id === l.itemId && s.itemOrgIds[i.id] === orgId)).filter((i): i is Item => !!i);
  const problems = dispatchPlanProblems(input.lines, o.lines, dispatchItems, o.godownId, input.overrideReason);
  if (problems.length) throw new ApiError(422, "dispatch_validation", problems[0]!, problems);
  const lines: ChallanLine[] = [];
  for (const il of input.lines.filter((l) => l.qty > 0)) {
    const sl = o.lines.find((x) => x.id === il.soLineId);
    if (!sl) throw new ApiError(422, "validation", "Unknown order line");
    const pending = sl.qty - sl.deliveredQty;
    if (il.qty > pending) throw new ApiError(422, "over_delivery", `${sl.itemName}: only ${pending} pending`);
    const allocated = il.allocations.reduce((a, x) => a + x.qty, 0);
    if (allocated !== il.qty) throw new ApiError(422, "allocation", `${sl.itemName}: batches add up to ${allocated}, need ${il.qty}`);
    const it = s.items.find((i) => i.id === sl.itemId)!;
    for (const a of il.allocations) {
      if (!a.batchNo) continue;
      const b = it.batches.find((x) => x.batchNo === a.batchNo && x.godownId === o.godownId);
      if (!b || b.qty < a.qty) throw new ApiError(409, "insufficient_batch", `Batch ${a.batchNo} has only ${b?.qty ?? 0} left`);
    }
    const onHand = it.stock.find((x) => x.godownId === o.godownId)?.onHand ?? 0;
    if (!it.allowNegative && il.qty > onHand) throw new ApiError(409, "insufficient_stock", `${sl.itemName}: only ${onHand} on hand`);
    lines.push({ soLineId: sl.id, itemId: sl.itemId, itemName: sl.itemName, hsn: sl.hsn, uom: sl.uom, qty: il.qty, rate: sl.rate, discountPct: sl.discountPct, gstRate: sl.gstRate, allocations: il.allocations.filter((a) => a.qty > 0) });
  }
  if (!lines.length) throw new ApiError(422, "validation", "Send at least one line");
  const org = s.orgs.find((x) => x.id === getSession()?.orgId) ?? s.orgs[0]!;
  const t = computeTotals(lines, supplyType(org.stateCode, o.placeOfSupplyCode));
  const vehicleNo = normaliseVehicle(input.vehicleNo);
  const transportIssues = dispatchTransportProblems(input, t.grandTotal);
  if (transportIssues.length) throw new ApiError(422, "transport_validation", transportIssues[0]!, transportIssues);
  s.dcSeq += 1;
  const at = nowIso();
  const by = userName();
  const id = `dc${Date.now()}`;
  const c: Challan = {
    id, number: fmtNo("DC", s.dcSeq), date: at.slice(0, 10), soId: o.id, soNumber: o.number ?? "",
    customerId: o.customerId, customerName: o.customerName, placeOfSupplyCode: o.placeOfSupplyCode, placeOfSupplyName: o.placeOfSupplyName,
    godownId: o.godownId, godownName: s.godowns.find((g) => g.id === o.godownId)?.name ?? "", status: "in_transit", lines,
    taxable: t.taxable, tax: t.cgst + t.sgst + t.igst, value: t.grandTotal, vehicleNo, driverName: input.driverName.trim(),
    driverPhone: input.driverPhone, transporter: input.transporter, distanceKm: input.distanceKm, overrideReason: input.overrideReason || undefined,
    events: [{ at, label: "Stock posted", by, note: input.overrideReason ? `FIFO override: ${input.overrideReason}` : undefined }],
  };
  if (ewayBillRequired(t.grandTotal)) {
    // Idempotency key dc-{id}-ewb: one EWB per challan.
    c.ewb = { number: `TEST${String(Date.now()).slice(-8)}`, generatedAt: at, validUntil: ewbValidUntil(at, input.distanceKm), vehicleNo, distanceKm: input.distanceKm, status: "active", history: [{ at, action: "Generated", by }] };
    c.events.push({ at, label: "E-way bill generated", by });
  }
  c.events.push({ at, label: "Vehicle departed", by, note: vehicleNo });
  post(s, c, 1);
  s.challans.push(c);
  s.challanOrgIds[c.id] = orgId;
  syncSoLink(s, c);
  return clone(c);
}

export async function deliverChallan(id: string, pod: { receivedBy: string; remarks: string }): Promise<Challan> {
  await delay(300);
  const s = db();
  const c = challansForOrg(s.challans, s.challanOrgIds, getSession()?.orgId ?? "").find((x) => x.id === id);
  if (!c) throw new ApiError(404, "not_found", "Challan not found");
  if (role() === "Driver" && c.driverName.toLowerCase() !== userName().toLowerCase()) throw new ApiError(403, "forbidden", "This challan is not assigned to you");
  if (role() !== "Driver" && !can(role(), "dispatch")) throw new ApiError(403, "forbidden", "Your role cannot mark a challan delivered");
  if (c.status !== "in_transit") throw new ApiError(409, "invalid_status", "Only challans in transit can be marked delivered");
  if (!pod.receivedBy.trim()) throw new ApiError(422, "validation", "Enter who received the goods");
  const at = nowIso();
  c.pod = { at, receivedBy: pod.receivedBy.trim(), remarks: pod.remarks.trim(), by: userName() };
  c.status = "delivered";
  c.events.push({ at, label: "POD received", by: userName(), note: `Received by ${c.pod.receivedBy}` });
  syncSoLink(s, c);
  return clone(c);
}

export async function cancelChallan(id: string, reason: string): Promise<Challan> {
  await delay(400);
  if (!can(role(), "dispatch")) throw new ApiError(403, "forbidden", "Your role cannot cancel challans");
  const s = db();
  const c = challansForOrg(s.challans, s.challanOrgIds, getSession()?.orgId ?? "").find((x) => x.id === id);
  if (!c) throw new ApiError(404, "not_found", "Challan not found");
  if (c.status !== "in_transit") throw new ApiError(409, "invalid_status", "Only challans not yet delivered can be cancelled");
  if (reason.trim().length < 5 || reason.trim().length > 500) throw new ApiError(422, "validation", "Give a cancellation reason (5–500 characters)");
  const at = nowIso();
  if (c.ewb?.status === "active" && !canCancelTestEwb(c.ewb.generatedAt, at)) throw new ApiError(409, "ewb_window", "The cancellation window has passed; reconcile the e-way bill before reversing");
  post(s, c, -1);
  if (c.ewb && c.ewb.status === "active") {
    c.ewb.status = "cancelled";
    c.ewb.history.push({ at, action: "Cancelled with challan", by: userName() });
  }
  c.status = "cancelled";
  c.events.push({ at, label: "Cancelled · stock reversed", by: userName(), note: reason.trim() });
  syncSoLink(s, c);
  return clone(c);
}

export async function ewbAction(id: string, a: EwbAction): Promise<Challan> {
  await delay(400);
  if (!can(role(), "dispatch")) throw new ApiError(403, "forbidden", "Your role cannot change e-way bills");
  const s = db();
  const c = challansForOrg(s.challans, s.challanOrgIds, getSession()?.orgId ?? "").find((x) => x.id === id);
  if (!c?.ewb) throw new ApiError(404, "not_found", "No e-way bill on this challan");
  const e = c.ewb;
  if (e.status !== "active") throw new ApiError(409, "invalid_status", "This e-way bill is cancelled");
  if (c.status !== "in_transit") throw new ApiError(409, "invalid_status", "E-way bill can only be changed while goods are in transit");
  if (a.reason.trim().length < 3) throw new ApiError(422, "validation", "Give a reason");
  const at = nowIso();
  const by = userName();
  if (a.action === "extend") {
    if (!(a.extraKm > 0)) throw new ApiError(422, "validation", "Enter remaining distance");
    const d = new Date(e.validUntil);
    d.setDate(d.getDate() + ewbValidityDays(a.extraKm));
    e.validUntil = d.toISOString();
    e.history.push({ at, action: `Extended ${ewbValidityDays(a.extraKm)} day(s) · ${a.reason}`, by });
  } else if (a.action === "part-b") {
    const v = normaliseVehicle(a.vehicleNo);
    if (dispatchTransportProblems({ vehicleNo: v, driverName: c.driverName, driverPhone: c.driverPhone, transporter: c.transporter, distanceKm: c.distanceKm }, c.value).some((p) => p.includes("vehicle"))) throw new ApiError(422, "validation", "Enter a valid vehicle number");
    e.vehicleNo = v;
    c.vehicleNo = v;
    e.history.push({ at, action: `Part-B updated to ${v} · ${a.reason}`, by });
  } else {
    if (!canCancelTestEwb(e.generatedAt, at)) throw new ApiError(409, "ewb_window", "E-way bills can only be cancelled within 24 hours of generation");
    e.status = "cancelled";
    e.history.push({ at, action: `Cancelled · ${a.reason}`, by });
  }
  return clone(c);
}

// ---------- Tax invoices ----------
function buildInvoice(s: Store, id: string, number: string, date: string, cs: Challan[]): Invoice {
  const c0 = cs[0]!;
  const org = s.orgs.find((o) => o.id === s.challanOrgIds[c0.id])!;
  const cust = s.parties.find((p) => p.id === c0.customerId)!;
  const lines = cs.flatMap((c) => c.lines);
  const supply = supplyType(org.stateCode, c0.placeOfSupplyCode);
  const t = computeTotals(lines, supply);
  return {
    id, number, date, dueDate: dueDateFor(date, cust.creditDays ?? 30), customerId: cust.id, customerName: cust.name, gstin: cust.gstin,
    placeOfSupplyCode: c0.placeOfSupplyCode, placeOfSupplyName: c0.placeOfSupplyName, supply,
    challans: cs.map((c) => ({ id: c.id, number: c.number, soId: c.soId, soNumber: c.soNumber })), lines,
    taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, grandTotal: t.grandTotal, byRate: t.byRate,
    advances: [], paid: 0, balance: t.grandTotal, status: "awaiting_payment", createdBy: userName(),
  };
}
function refresh(inv: Invoice) {
  const settled = inv.paid + inv.advances.reduce((a, b) => a + b.amount, 0);
  inv.balance = Math.max(0, inv.grandTotal - settled);
  if (inv.status === "cancelled") inv.balance = 0;
  else inv.status = invoiceStatus(inv.grandTotal, settled, inv.dueDate, new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  return inv;
}
function seedInv(s: Store, id: string, number: string, dcId: string, paid: number): Invoice {
  const c = s.challans.find((x) => x.id === dcId)!;
  const d = new Date(`${c.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  const inv = buildInvoice(s, id, number, d.toISOString().slice(0, 10), [c]);
  inv.createdBy = "Srinivas K"; inv.paid = paid;
  return refresh(inv);
}

export async function listInvoices(status?: string): Promise<Invoice[]> {
  await delay();
  if (!can(role(), "issueInvoice")) throw new ApiError(403, "forbidden", "Your role cannot view tax invoices");
  const s = db();
  return clone(invoicesForOrg(s.invoices, s.invoiceOrgIds, getSession()?.orgId ?? "")
    .map(refresh).filter((i) => !status || status === "all" || i.status === status).sort((a, b) => b.number.localeCompare(a.number)));
}
export async function getInvoice(id: string): Promise<Invoice> {
  await delay(150);
  if (!can(role(), "issueInvoice")) throw new ApiError(403, "forbidden", "Your role cannot view tax invoices");
  const s = db();
  const i = invoicesForOrg(s.invoices, s.invoiceOrgIds, getSession()?.orgId ?? "").find((x) => x.id === id);
  if (!i) throw new ApiError(404, "not_found", "Invoice not found");
  return clone(refresh(i));
}
export async function listAdvances(customerId: string): Promise<Advance[]> {
  await delay(100);
  if (!can(role(), "recordReceipt")) throw new ApiError(403, "forbidden", "Your role cannot view advances");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  if (!orgId || s.partyOrgIds[customerId] !== orgId) return [];
  return clone(receiptsForOrg(s.advances, s.advanceOrgIds, orgId).filter((a) => a.customerId === customerId && a.remaining > 0));
}
export async function issueInvoice(input: IssueInvoiceInput): Promise<Invoice> {
  await delay(400);
  if (!can(role(), "issueInvoice")) throw new ApiError(403, "forbidden", "Only Owner, Manager or Accountant can issue invoices");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const cs = input.challanIds.map((id) => s.challans.find((c) => c.id === id && s.challanOrgIds[c.id] === orgId)).filter((c): c is Challan => !!c);
  const businessToday = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const problems = invoiceIssueProblems(cs, input.challanIds, input.date, businessToday);
  if (problems.length) throw new ApiError(409, "invalid_challans", problems[0]!);
  // Gapless: sequence only advances inside the same (server-side) transaction that saves the invoice.
  const seq = s.invSeq + 1;
  const inv = buildInvoice(s, `inv${seq}`, fmtNo("INV", seq), input.date, cs);
  if (input.applyAdvances) {
    const advs = s.advances.filter((a) => a.customerId === inv.customerId && a.remaining > 0);
    for (const al of applyAdvancesOldestFirst(advs, inv.grandTotal)) {
      const a = advs.find((x) => x.id === al.advanceId)!;
      a.remaining -= al.amount;
      inv.advances.push({ advanceId: a.id, receiptNo: a.receiptNo, amount: al.amount });
    }
  }
  refresh(inv);
  s.invSeq = seq;
  s.invoices.push(inv);
  s.invoiceOrgIds[inv.id] = orgId;
  const party = s.parties.find((p) => p.id === inv.customerId);
  if (party) party.outstanding += inv.balance;
  const at = nowIso();
  for (const c of cs) {
    c.invoiceNo = inv.number;
    c.events.push({ at, label: `Invoiced on ${inv.number}`, by: userName() });
    const o = s.salesOrders.find((x) => x.id === c.soId);
    if (o && !o.linked.some((l) => l.number === inv.number)) o.linked.push({ type: "tax_invoice", number: inv.number, date: inv.date, status: "Awaiting payment", amount: inv.grandTotal });
  }
  return clone(inv);
}

export async function cancelInvoice(id: string, reason: string): Promise<Invoice> {
  await delay(250);
  if (!can(role(), "issueInvoice")) throw new ApiError(403, "forbidden", "Your role cannot cancel invoices");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const inv = invoicesForOrg(s.invoices, s.invoiceOrgIds, orgId).find((x) => x.id === id);
  if (!inv) throw new ApiError(404, "not_found", "Invoice not found");
  const businessToday = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const problems = invoiceCancelProblems(inv, reason, businessToday);
  if (problems.length) throw new ApiError(409, "cannot_cancel", problems[0]!);
  const party = s.parties.find((p) => p.id === inv.customerId && s.partyOrgIds[p.id] === orgId);
  const challans = inv.challans.map((ref) => s.challans.find((c) => c.id === ref.id && s.challanOrgIds[c.id] === orgId));
  const advances = inv.advances.map((a) => s.advances.find((x) => x.id === a.advanceId && x.customerId === inv.customerId));
  if (!party || challans.some((c, j) => !c || c.invoiceNo !== inv.number) || advances.some((a, j) => !a || a.remaining + inv.advances[j]!.amount > a.amount + 0.01))
    throw new ApiError(409, "invalid_links", "The linked records have changed; invoice was not cancelled");
  // Validate everything before mutating; the real API does this in one database transaction.
  for (const [index, advance] of advances.entries()) advance!.remaining = Math.round((advance!.remaining + inv.advances[index]!.amount) * 100) / 100;
  const at = nowIso();
  for (const c of challans) {
    c!.invoiceNo = "";
    c!.events.push({ at, label: `Invoice ${inv.number} cancelled`, by: userName() });
    const so = s.salesOrders.find((o) => o.id === c!.soId && s.salesOrderOrgIds[o.id] === orgId);
    const link = so?.linked.find((d) => d.number === inv.number);
    if (link) link.status = "Cancelled";
  }
  party!.outstanding = Math.max(0, Math.round((party!.outstanding - inv.balance) * 100) / 100);
  inv.status = "cancelled";
  inv.balance = 0;
  inv.cancelled = { at, by: userName(), reason: reason.trim() };
  return clone(inv);
}

// ---------- Receipts & advances ----------
export async function listReceipts(): Promise<Receipt[]> {
  await delay();
  if (!can(role(), "recordReceipt")) throw new ApiError(403, "forbidden", "Your role cannot view receipts");
  const s = db();
  return clone(receiptsForOrg(s.receipts, s.receiptOrgIds, getSession()?.orgId ?? "")
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)));
}
export async function listOpenInvoices(customerId: string): Promise<Invoice[]> {
  await delay(100);
  if (!can(role(), "recordReceipt")) throw new ApiError(403, "forbidden", "Your role cannot view invoices");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  if (!orgId || s.partyOrgIds[customerId] !== orgId) return [];
  return clone(invoicesForOrg(s.invoices, s.invoiceOrgIds, orgId)
    .map(refresh).filter((i) => i.customerId === customerId && i.balance > 0 && i.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
}
export async function listAllAdvances(): Promise<(Advance & { customerName: string })[]> {
  await delay(100);
  if (!can(role(), "recordReceipt")) throw new ApiError(403, "forbidden", "Your role cannot view advances");
  const s = db();
  return clone(receiptsForOrg(s.advances, s.advanceOrgIds, getSession()?.orgId ?? "")
    .map((a) => ({ ...a, customerName: s.parties.find((p) => p.id === a.customerId)?.name ?? "" })));
}
export async function recordReceipt(input: ReceiptInput): Promise<Receipt> {
  await delay(350);
  if (!can(role(), "recordReceipt")) throw new ApiError(403, "forbidden", "Only Owner, Manager or Accountant can record receipts");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const cust = s.parties.find((p) => p.id === input.customerId && s.partyOrgIds[p.id] === orgId);
  if (!cust) throw new ApiError(404, "not_found", "Customer not found");
  if (cust.kind !== "customer" && cust.kind !== "both") throw new ApiError(422, "invalid_customer", "Select a customer, not a supplier or transporter");
  const open = invoicesForOrg(s.invoices, s.invoiceOrgIds, orgId)
    .map(refresh).filter((i) => i.customerId === cust.id && i.balance > 0 && i.status !== "cancelled");
  const errors = receiptProblems(input, open, new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  if (errors.length) throw new ApiError(422, "invalid_receipt", errors[0]!);
  const result = input.allocations == null ? receiptAllocation(open, input.amount) : {
    allocations: input.allocations.filter((a) => a.amount > 0),
    advance: ((receiptPaise(input.amount) ?? 0) - input.allocations.reduce((total, a) => total + (receiptPaise(a.amount) ?? 0), 0)) / 100,
  };
  const { allocations, advance } = result;
  const allocationProblems = receiptProblems({ ...input, allocations }, open, new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  if (allocationProblems.length) throw new ApiError(422, "invalid_receipt", allocationProblems[0]!);
  const seq = s.rctSeq + 1;
  const number = fmtNo("RCT", seq);
  const rc: Receipt = {
    id: `r${seq}`, number, date: input.date, customerId: cust.id, customerName: cust.name, amount: input.amount, mode: input.mode,
    reference: input.reference.trim(), advance, createdBy: userName(),
    allocations: allocations.map((a) => {
      const inv = open.find((i) => i.id === a.invoiceId)!;
      inv.paid = Math.round((inv.paid + a.amount) * 100) / 100;
      refresh(inv);
      for (const c of inv.challans) {
        const o = s.salesOrders.find((x) => x.id === c.soId && s.salesOrderOrgIds[x.id] === orgId);
        const l = o?.linked.find((d) => d.number === inv.number);
        if (l) l.status = inv.status === "paid" ? "Paid" : "Partially paid";
        if (o && !o.linked.some((d) => d.number === number)) o.linked.push({ type: "receipt", number, date: input.date, status: "Cleared", amount: a.amount });
      }
      return { invoiceId: inv.id, invoiceNo: inv.number, amount: a.amount };
    }),
  };
  s.rctSeq = seq;
  s.receipts.push(rc);
  s.receiptOrgIds[rc.id] = orgId;
  if (advance > 0) {
    const adv: Advance = { id: `adv-${rc.id}`, receiptNo: number, date: input.date, customerId: cust.id, amount: advance, remaining: advance };
    s.advances.push(adv);
    s.advanceOrgIds[adv.id] = orgId;
  }
  cust.outstanding = Math.max(0, Math.round((cust.outstanding - (input.amount - advance)) * 100) / 100);
  return clone(rc);
}

// ---------- Purchases / GRN ----------
export async function listPurchaseOrders(): Promise<PurchaseOrder[]> {
  await delay();
  if (!can(role(), "postGrn")) throw new ApiError(403, "forbidden", "Your role cannot view purchase orders");
  const s = db();
  return clone(purchaseOrdersForOrg(s.pos, s.poOrgIds, getSession()?.orgId ?? "").sort((a, b) => b.number.localeCompare(a.number)));
}
export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  await delay(120);
  if (!can(role(), "postGrn")) throw new ApiError(403, "forbidden", "Your role cannot view purchase orders");
  const s = db();
  const po = purchaseOrdersForOrg(s.pos, s.poOrgIds, getSession()?.orgId ?? "").find((p) => p.id === id);
  if (!po) throw new ApiError(404, "not_found", "Purchase order not found");
  return clone(po);
}
export async function createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrder> {
  await delay(300);
  if (!can(role(), "raisePO")) throw new ApiError(403, "forbidden", "Only Owner or Manager can raise purchase orders");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const org = s.orgs.find((o) => o.id === orgId);
  const sup = s.parties.find((p) => p.id === input.supplierId && s.partyOrgIds[p.id] === orgId);
  const g = s.godowns.find((x) => x.id === input.godownId && x.orgId === orgId);
  const catalog = s.items.filter((it) => s.itemOrgIds[it.id] === orgId);
  const problems = poDraftProblems(input, sup, g, catalog, new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  if (!org || problems.length) throw new ApiError(422, "invalid_po", problems[0] ?? "Select an organisation");
  const lines = input.lines.map((l, n) => {
    const it = catalog.find((i) => i.id === l.itemId)!;
    return { id: `l${Date.now()}${n}`, itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, gstRate: it.gstRate, qty: l.qty, receivedQty: 0, rate: l.rate };
  });
  const seq = ++s.poSeq;
  const po: PurchaseOrder = {
    id: `po${seq}`, number: fmtNo("PO", seq), date: input.date, supplierId: sup!.id, supplierName: sup!.name,
    godownId: g!.id, godownName: g!.name, status: input.draft ? "draft" : "open", lines, notes: input.notes, grns: [], createdBy: userName(),
    ...(input.draft ? {} : { approvedBy: userName() }),
    grandTotal: computeTotals(lines.map((l) => ({ ...l, discountPct: 0 })), supplyType(org.stateCode, sup!.stateCode)).grandTotal,
  };
  s.pos.push(po);
  s.poOrgIds[po.id] = orgId;
  return clone(po);
}
export async function approvePurchaseOrder(id: string): Promise<PurchaseOrder> {
  await delay(180);
  if (!can(role(), "raisePO")) throw new ApiError(403, "forbidden", "Only Owner or Manager can approve purchase orders");
  const s = db();
  const po = purchaseOrdersForOrg(s.pos, s.poOrgIds, getSession()?.orgId ?? "").find((p) => p.id === id);
  if (!po) throw new ApiError(404, "not_found", "Purchase order not found");
  const errors = poWorkflowProblems(po, "approve");
  if (errors.length) throw new ApiError(409, "invalid_status", errors[0]!);
  po.status = "open";
  po.approvedBy = userName();
  return clone(po);
}
export async function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrder> {
  await delay(180);
  if (!can(role(), "raisePO")) throw new ApiError(403, "forbidden", "Only Owner or Manager can cancel purchase orders");
  const s = db();
  const po = purchaseOrdersForOrg(s.pos, s.poOrgIds, getSession()?.orgId ?? "").find((p) => p.id === id);
  if (!po) throw new ApiError(404, "not_found", "Purchase order not found");
  const errors = poWorkflowProblems(po, "cancel", reason);
  if (errors.length) throw new ApiError(409, "invalid_status", errors[0]!);
  po.status = "cancelled";
  po.cancelledBy = userName();
  po.cancellationReason = reason.trim();
  return clone(po);
}
export async function listGrns(): Promise<Grn[]> {
  await delay();
  const s = db();
  return clone(grnsForOrg(s.grns, s.grnOrgIds, getSession()?.orgId ?? "").sort((a, b) => b.number.localeCompare(a.number)));
}
export async function getGrn(id: string): Promise<Grn> {
  await delay(120);
  const s = db();
  const g = s.grns.find((x) => x.id === id && s.grnOrgIds[x.id] === getSession()?.orgId);
  if (!g) throw new ApiError(404, "not_found", "GRN not found");
  return clone(g);
}
export async function postGrn(input: GrnInput): Promise<Grn> {
  await delay(400);
  if (!can(role(), "postGrn")) throw new ApiError(403, "forbidden", "Your role cannot post GRNs");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const sup = s.parties.find((p) => p.id === input.supplierId && s.partyOrgIds[p.id] === orgId);
  const g = s.godowns.find((x) => x.id === input.godownId && x.orgId === orgId);
  const po = input.poId ? purchaseOrdersForOrg(s.pos, s.poOrgIds, orgId).find((p) => p.id === input.poId) : undefined;
  if (input.poId && !po) throw new ApiError(404, "not_found", "Purchase order not found");
  const catalog = s.items.filter((it) => s.itemOrgIds[it.id] === orgId);
  const earlier = grnsForOrg(s.grns, s.grnOrgIds, orgId);
  const problems = grnDraftProblems(input, sup, g, catalog, po, new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10), earlier);
  if (problems.length) throw new ApiError(422, "invalid_grn", problems[0]!);
  const lines = input.lines;
  const values = lines.map((l) => (l.received - l.rejected) * l.rate);
  const shares = apportionFreight(values, input.freight);
  const seq = ++s.grnSeq;
  const number = fmtNo("GRN", seq);
  const at = nowIso().slice(0, 16);
  const gl: GrnLine[] = lines.map((l, n) => {
    const it = s.items.find((i) => i.id === l.itemId)!;
    const accepted = l.received - l.rejected;
    const landed = accepted > 0 ? Math.round((l.rate + shares[n]! / accepted) * 100) / 100 : l.rate;
    if (accepted > 0) {
      const totalQty = it.stock.reduce((a, x) => a + x.onHand, 0);
      it.costPrice = weightedAverageCost(totalQty, it.costPrice, accepted, landed);
      let st = it.stock.find((x) => x.godownId === g.id);
      if (!st) { st = { godownId: g.id, onHand: 0, held: 0, reorderLevel: 0, maxLevel: 0 }; it.stock.push(st); }
      st.onHand += accepted;
      const bn = l.batchNo?.trim();
      if (bn) {
        const ex = it.batches.find((b) => b.batchNo === bn && b.godownId === g.id);
        if (ex) ex.qty += accepted;
        else it.batches.push({ id: `b${Date.now()}${n}`, batchNo: bn, godownId: g.id, qty: accepted, mfgDate: l.mfgDate || input.date, receivedDate: input.date, ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}) });
      }
      s.posted.push({ id: `p${s.posted.length + 1}`, at, docNo: number, docType: "grn", type: "PURCHASE_IN", itemId: it.id, itemName: it.name,
        godownId: g.id, godownName: g.name, ...(bn ? { batchNo: bn } : {}), qty: accepted, unitCost: landed, user: userName() });
    }
    const pl = po?.lines.find((x) => x.id === l.poLineId);
    if (pl) pl.receivedQty += l.received;
    return { poLineId: l.poLineId, itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, gstRate: it.gstRate, ordered: pl?.qty,
      received: l.received, accepted, rejected: l.rejected, rate: l.rate, batchNo: l.batchNo?.trim() || undefined, mfgDate: l.mfgDate || undefined,
      expiryDate: l.expiryDate || undefined, rejectionReason: l.rejectionReason || undefined, freightShare: shares[n]!, landedCost: landed };
  });
  const t = computeTotals(gl.map((l) => ({ qty: l.accepted, rate: l.rate, discountPct: 0, gstRate: l.gstRate })), supplyType(s.orgs.find((o) => o.id === orgId)!.stateCode, sup.stateCode));
  const grn: Grn = {
    id: `grn${seq}`, number, date: input.date, supplierId: sup.id, supplierName: sup.name, poId: po?.id, poNumber: po?.number,
    supplierInvoiceNo: input.supplierInvoiceNo.trim(), supplierInvoiceDate: input.supplierInvoiceDate, godownId: g.id, godownName: g.name,
    vehicleNo: input.vehicleNo.trim().toUpperCase(), freight: input.freight, lines: gl, taxable: t.taxable, tax: t.cgst + t.sgst + t.igst,
    grandTotal: Math.round(t.taxable + t.cgst + t.sgst + t.igst + input.freight), createdBy: userName(),
  };
  if (po) { po.status = poStatus(po.lines); po.grns.push({ id: grn.id, number, date: input.date }); }
  sup.outstanding += grn.grandTotal;
  s.grns.push(grn);
  s.grnOrgIds[grn.id] = orgId;
  return clone(grn);
}

// ---------- Transfers ----------
const gname = (s: Store, id: string) => s.godowns.find((g) => g.id === id)?.name ?? id;
function trfLedger(s: Store, t: Transfer, it: Item, godownId: string, type: LedgerEntry["type"], qty: number, batchNo?: string, reason?: string) {
  s.posted.push({ id: `p${s.posted.length + 1}`, at: nowIso().slice(0, 16), docNo: t.number, docType: type.startsWith("ADJ") ? "adjustment" : "transfer", type,
    itemId: it.id, itemName: it.name, godownId, godownName: gname(s, godownId), ...(batchNo ? { batchNo } : {}), qty, unitCost: it.costPrice, user: userName(), ...(reason ? { reason } : {}) });
}
function moveStock(it: Item, godownId: string, qty: number, batchNo?: string, receivedDate?: string) {
  let st = it.stock.find((x) => x.godownId === godownId);
  if (!st) { st = { godownId, onHand: 0, held: 0, reorderLevel: 0, maxLevel: 0 }; it.stock.push(st); }
  st.onHand += qty;
  if (!batchNo) return;
  const b = it.batches.find((x) => x.batchNo === batchNo && x.godownId === godownId);
  if (b) b.qty += qty;
  else if (qty > 0) {
    const src = it.batches.find((x) => x.batchNo === batchNo);
    it.batches.push({ id: `b${Date.now()}`, batchNo, godownId, qty, mfgDate: src?.mfgDate ?? receivedDate ?? MOCK_TODAY, receivedDate: src?.receivedDate ?? receivedDate ?? MOCK_TODAY, ...(src?.expiryDate ? { expiryDate: src.expiryDate } : {}) });
  }
}
export async function listTransfers(status?: string): Promise<Transfer[]> {
  await delay();
  if (!can(role(), "transfer")) throw new ApiError(403, "forbidden", "Your role cannot view transfers");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  return clone(transfersForOrg(s.transfers, s.transferOrgIds, orgId)
    .filter((t) => !status || status === "all" || t.status === status)
    .sort((a, b) => b.number.localeCompare(a.number)));
}
export async function getTransfer(id: string): Promise<Transfer> {
  await delay(120);
  if (!can(role(), "transfer")) throw new ApiError(403, "forbidden", "Your role cannot view transfers");
  const s = db();
  const t = s.transfers.find((x) => x.id === id && s.transferOrgIds[x.id] === getSession()?.orgId);
  if (!t) throw new ApiError(404, "not_found", "Transfer not found");
  return clone(t);
}
export async function dispatchTransfer(input: TransferInput): Promise<Transfer> {
  await delay(350);
  if (!can(role(), "transfer")) throw new ApiError(403, "forbidden", "Your role cannot create transfers");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const from = s.godowns.find((g) => g.id === input.fromId && g.orgId === orgId);
  const to = s.godowns.find((g) => g.id === input.toId && g.orgId === orgId);
  const catalog = input.lines.map((l) => s.items.find((it) => it.id === l.itemId && s.itemOrgIds[it.id] === orgId));
  if (catalog.some((it) => !it)) throw new ApiError(404, "not_found", "Item not found in this organisation");
  const checks = input.lines.map((l, n) => {
    const it = catalog[n]!;
    const st = it.stock.find((x) => x.godownId === input.fromId);
    const b = l.batchNo ? it.batches.find((x) => x.batchNo === l.batchNo && x.godownId === input.fromId) : undefined;
    return { itemId: it.id, itemName: it.name, active: it.active, qty: l.qty, free: st ? st.onHand - st.held : 0,
      trackBatches: it.trackBatches, batchNo: l.batchNo, batchQty: b?.qty };
  });
  const problems = transferDraftProblems(input, from, to, new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), checks);
  if (problems.length) throw new ApiError(422, "invalid_transfer", problems[0]!);
  const seq = ++s.trfSeq;
  const lines = input.lines.map((l, n) => {
    const it = catalog[n]!;
    return { itemId: it.id, itemName: it.name, uom: it.baseUom, batchNo: l.batchNo?.trim() || undefined, qty: l.qty, unitCost: it.costPrice };
  });
  const t: Transfer = {
    id: `trf${seq}`, number: fmtNo("TRF", seq), date: input.date, fromId: from!.id, fromName: from!.name,
    toId: to!.id, toName: to!.name, status: "in_transit", vehicleNo: input.vehicleNo.trim().toUpperCase(), reason: input.reason.trim(),
    lines, value: lines.reduce((a, l) => a + l.qty * l.unitCost, 0), events: [{ at: nowIso(), label: "Dispatched", by: userName() }],
  };
  for (const l of lines) {
    const it = s.items.find((i) => i.id === l.itemId)!;
    moveStock(it, t.fromId, -l.qty, l.batchNo);
    trfLedger(s, t, it, t.fromId, "TRANSFER_OUT", -l.qty, l.batchNo);
  }
  s.transfers.push(t);
  s.transferOrgIds[t.id] = orgId;
  return clone(t);
}
export async function receiveTransfer(id: string, input: ReceiveTransferInput): Promise<Transfer> {
  await delay(350);
  if (!can(role(), "transfer")) throw new ApiError(403, "forbidden", "Your role cannot receive transfers");
  const s = db();
  const t = s.transfers.find((x) => x.id === id && s.transferOrgIds[x.id] === getSession()?.orgId);
  if (!t) throw new ApiError(404, "not_found", "Transfer not found");
  if (t.status !== "in_transit") throw new ApiError(409, "invalid_status", "Only transfers in transit can be received");
  const rows = input.lines.map((r, n) => ({ itemName: t.lines[n]?.itemName ?? `Line ${n + 1}`, sent: t.lines[n]?.qty ?? 0, received: r.received, reason: r.reason }));
  const problems = receiveProblems(rows, t.lines.length);
  if (problems.length) throw new ApiError(422, "invalid_receive", problems[0]!);
  t.lines.forEach((l, n) => {
    const r = rows[n]!;
    const it = s.items.find((i) => i.id === l.itemId)!;
    l.receivedQty = r.received;
    moveStock(it, t.toId, l.qty, l.batchNo, t.date);
    trfLedger(s, t, it, t.toId, "TRANSFER_IN", l.qty, l.batchNo);
    if (r.received < l.qty) {
      l.shortReason = r.reason?.trim();
      moveStock(it, t.toId, -(l.qty - r.received), l.batchNo);
      trfLedger(s, t, it, t.toId, "ADJ_OUT", -(l.qty - r.received), l.batchNo, `TRANSIT_LOSS: ${l.shortReason}`);
    }
  });
  t.status = receivedStatus(rows);
  const short = rows.reduce((a, r) => a + (r.sent - r.received), 0);
  t.events.push({ at: nowIso(), label: short ? "Received with shortage" : "Received in full", by: userName(), note: short ? `${short} written off as transit loss` : undefined });
  return clone(t);
}
export async function cancelTransfer(id: string, reason: string): Promise<Transfer> {
  await delay(300);
  if (!can(role(), "cancelTransfer")) throw new ApiError(403, "forbidden", "Only Owner or Manager can cancel transfers");
  const s = db();
  const t = s.transfers.find((x) => x.id === id && s.transferOrgIds[x.id] === getSession()?.orgId);
  if (!t) throw new ApiError(404, "not_found", "Transfer not found");
  if (t.status !== "in_transit") throw new ApiError(409, "invalid_status", "Only transfers in transit can be cancelled");
  if (!reason.trim() || reason.length > 500) throw new ApiError(422, "invalid_reason", "Enter a cancellation reason (max 500 characters)");
  for (const l of t.lines) {
    const it = s.items.find((i) => i.id === l.itemId)!;
    moveStock(it, t.fromId, l.qty, l.batchNo);
    trfLedger(s, t, it, t.fromId, "TRANSFER_IN", l.qty, l.batchNo, "Transfer cancelled");
  }
  t.status = "cancelled";
  t.events.push({ at: nowIso(), label: "Cancelled · stock returned to source", by: userName(), note: reason.trim() });
  return clone(t);
}

// ---------- Adjustments ----------
function postAdjustment(s: Store, a: Adjustment) {
  for (const l of a.lines) {
    const it = s.items.find((i) => i.id === l.itemId)!;
    if (l.direction === "down") l.unitCost = it.costPrice;
    if (l.direction === "up") {
      const total = it.stock.reduce((x, y) => x + y.onHand, 0);
      it.costPrice = weightedAverageCost(total, it.costPrice, l.qty, l.unitCost);
    }
    const q = l.direction === "up" ? l.qty : -l.qty;
    moveStock(it, a.godownId, q, l.batchNo, a.date);
    s.posted.push({ id: `p${s.posted.length + 1}`, at: nowIso().slice(0, 16), docNo: a.number, docType: "adjustment", type: l.direction === "up" ? "ADJ_IN" : "ADJ_OUT",
      itemId: it.id, itemName: it.name, godownId: a.godownId, godownName: a.godownName, ...(l.batchNo ? { batchNo: l.batchNo } : {}), qty: q, unitCost: l.unitCost,
      user: userName(), reason: reasonLabel(a.reason) + (a.notes ? `: ${a.notes}` : "") });
  }
  const totals = adjustmentValue(a.lines);
  a.valueUp = totals.up; a.valueDown = totals.down;
  a.status = "posted";
}
function adjChecks(s: Store, godownId: string, lines: AdjustmentInput["lines"]) {
  const orgId = getSession()?.orgId;
  return lines.map((l) => {
    const it = s.items.find((i) => i.id === l.itemId && s.itemOrgIds[i.id] === orgId);
    if (!it) throw new ApiError(404, "not_found", "Item not found");
    const b = l.batchNo ? it.batches.find((x) => x.batchNo === l.batchNo.trim() && x.godownId === godownId) : undefined;
    const stock = it.stock.find((x) => x.godownId === godownId);
    return { itemId: it.id, itemName: it.name, active: it.active, direction: l.direction, qty: l.qty, onHand: stock?.onHand ?? 0, held: stock?.held ?? 0,
      unitCost: l.direction === "up" ? l.unitCost : it.costPrice, trackBatches: it.trackBatches, batchNo: l.batchNo, batchQty: b?.qty };
  });
}
export async function listAdjustments(status?: string): Promise<Adjustment[]> {
  await delay();
  if (!can(role(), "adjust")) throw new ApiError(403, "forbidden", "Your role cannot view adjustments");
  const s = db();
  return clone(adjustmentsForOrg(s.adjustments, s.adjustmentOrgIds, getSession()?.orgId ?? "")
    .filter((a) => !status || status === "all" || a.status === status).sort((a, b) => b.number.localeCompare(a.number)));
}
export async function getAdjustment(id: string): Promise<Adjustment> {
  await delay(120);
  if (!can(role(), "adjust")) throw new ApiError(403, "forbidden", "Your role cannot view adjustments");
  const s = db();
  const a = s.adjustments.find((x) => x.id === id && s.adjustmentOrgIds[x.id] === getSession()?.orgId);
  if (!a) throw new ApiError(404, "not_found", "Adjustment not found");
  return clone(a);
}
export async function createAdjustment(input: AdjustmentInput): Promise<Adjustment> {
  await delay(350);
  const r = role();
  if (!can(r, "adjust")) throw new ApiError(403, "forbidden", "Your role cannot adjust stock");
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const godown = s.godowns.find((g) => g.id === input.godownId && g.orgId === orgId);
  const problems = adjustmentDraftProblems(input, godown, new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10), adjChecks(s, input.godownId, input.lines));
  if (problems.length) throw new ApiError(422, "invalid_adjustment", problems[0]!);
  const seq = ++s.adjSeq;
  const lines = input.lines.map((l) => {
    const it = s.items.find((i) => i.id === l.itemId)!;
    const unitCost = l.direction === "down" ? it.costPrice : l.unitCost;
    return { itemId: it.id, itemName: it.name, uom: it.baseUom, batchNo: l.batchNo?.trim() || undefined, direction: l.direction, qty: l.qty, unitCost };
  });
  const v = adjustmentValue(lines);
  const pending = needsApproval(r, v.gross, s.settingsByOrg[getSession()?.orgId ?? ""]?.adjApprovalLimit ?? 25000);
  const a: Adjustment = {
    id: `adj${seq}`, number: fmtNo("ADJ", seq), date: input.date, godownId: input.godownId, godownName: godown!.name,
    reason: input.reason, notes: input.notes.trim(), status: "pending_approval", lines, valueUp: v.up, valueDown: v.down, createdBy: userName(), createdByRole: r,
    events: [{ at: nowIso(), label: pending ? "Submitted for approval" : "Created", by: userName() }],
  };
  if (!pending) { postAdjustment(s, a); a.events.push({ at: nowIso(), label: "Posted to stock", by: userName() }); }
  s.adjustments.push(a);
  s.adjustmentOrgIds[a.id] = orgId;
  return clone(a);
}
export async function decideAdjustment(id: string, approve: boolean, note?: string): Promise<Adjustment> {
  await delay(300);
  if (!canApproveAdjustment(role())) throw new ApiError(403, "forbidden", "Only Owner or Manager can approve adjustments");
  const s = db();
  const a = s.adjustments.find((x) => x.id === id && s.adjustmentOrgIds[x.id] === getSession()?.orgId);
  if (!a) throw new ApiError(404, "not_found", "Adjustment not found");
  if (a.status !== "pending_approval") throw new ApiError(409, "invalid_status", "Only pending adjustments can be decided");
  if (note && note.length > 500) throw new ApiError(422, "invalid_note", "Decision note is too long");
  if (approve) {
    const godown = s.godowns.find((g) => g.id === a.godownId && g.orgId === getSession()?.orgId);
    const problems = adjustmentDraftProblems(a, godown, new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10), adjChecks(s, a.godownId, a.lines));
    if (problems.length) throw new ApiError(422, "invalid_adjustment", problems[0]!);
    postAdjustment(s, a);
    a.events.push({ at: nowIso(), label: "Approved · posted to stock", by: userName(), note: note?.trim() });
  } else {
    if (!note?.trim()) throw new ApiError(422, "invalid", "Give a reason for rejecting");
    a.status = "rejected";
    a.events.push({ at: nowIso(), label: "Rejected", by: userName(), note: note.trim() });
  }
  return clone(a);
}

// ---------- Numbering ----------
const SERIES_LABELS: Record<DocType, string> = { SO: "Sales order", DC: "Delivery challan", INV: "Tax invoice", RCT: "Receipt", PO: "Purchase order", GRN: "Goods receipt", TRF: "Stock transfer", ADJ: "Stock adjustment" };
function seqOf(s: Store, t: DocType): number {
  if (getSession()?.orgId !== "org1") return s.issuedByOrg[getSession()?.orgId ?? ""]?.[t] ?? 0;
  return { SO: s.soSeq, DC: s.dcSeq, INV: s.invSeq, RCT: s.rctSeq, PO: s.poSeq, GRN: s.grnSeq, TRF: s.trfSeq, ADJ: s.adjSeq }[t];
}
function fmtNo(t: DocType, seq: number): string {
  const orgId = getSession()?.orgId ?? "";
  const s = db();
  const c = s.seriesByOrg[orgId]?.[t];
  if (!c) throw new ApiError(403, "no_org_access", "Select an organisation");
  if (orgId !== "org1") {
    const counters = s.issuedByOrg[orgId] ?? (s.issuedByOrg[orgId] = {});
    seq = (counters[t] ?? 0) + 1;
    counters[t] = seq;
  }
  return docNumber(c.prefix, "26-27", seq, c.padding);
}
function requirePerm(p: Parameters<typeof can>[1], msg: string) {
  if (!can(role(), p)) throw new ApiError(403, "forbidden", msg);
}
export async function listSeries(): Promise<NumberSeries[]> {
  await delay(150);
  requirePerm("settings", "Only the Owner can manage numbering");
  const s = db();
  const series = s.seriesByOrg[getSession()?.orgId ?? ""];
  if (!series) throw new ApiError(403, "no_org_access", "Select an organisation");
  return (Object.keys(SERIES_LABELS) as DocType[]).map((t) => ({ docType: t, label: SERIES_LABELS[t], ...series[t], fy: "26-27", lastNumber: seqOf(s, t), locked: seqOf(s, t) > 0 }));
}
export async function saveSeries(input: NumberSeriesInput): Promise<NumberSeries> {
  await delay(200);
  requirePerm("settings", "Only the Owner can change numbering");
  const s = db();
  const series = s.seriesByOrg[getSession()?.orgId ?? ""];
  if (!series) throw new ApiError(403, "no_org_access", "Select an organisation");
  const cur = series[input.docType];
  const problems = seriesProblems(input, { ...cur, lastNumber: seqOf(s, input.docType) });
  if (problems.length) throw new ApiError(422, "invalid", problems[0]!);
  series[input.docType] = { prefix: input.prefix, padding: input.padding, resetPerFy: input.resetPerFy };
  return (await listSeries()).find((x) => x.docType === input.docType)!;
}

// ---------- Users ----------
const pubUser = ({ password: _p, ...u }: AppUser & { password: string }): AppUser => clone(u);
export async function listUsers(): Promise<AppUser[]> {
  await delay(150);
  requirePerm("manageUsers", "Only the Owner can manage users");
  return usersForOrg(db().users, db().userOrgIds, getSession()?.orgId ?? "").map(pubUser);
}
export async function saveUser(draft: AppUserInput): Promise<AppUser> {
  await delay(250);
  requirePerm("manageUsers", "Only the Owner can manage users");
  const input = normaliseUserInput(draft);
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  const orgUsers = usersForOrg(s.users, s.userOrgIds, orgId);
  const allowedGodowns = s.godowns.filter((g) => g.orgId === orgId && g.active !== false).map((g) => g.id);
  const problems = userProblems(input, allowedGodowns, orgUsers, getSession()?.user.id);
  if (problems.length) throw new ApiError(422, "invalid", problems[0]!);
  if (s.users.some((u) => u.email === input.email && u.id !== input.id))
    throw new ApiError(409, "duplicate", "A user with this email already exists");
  if (input.id) {
    const u = orgUsers.find((x) => x.id === input.id);
    if (!u) throw new ApiError(404, "not_found", "User not found in this organisation");
    if ((s.userOrgIds[u.id] ?? []).length > 1 &&
        (u.name !== input.name || u.email !== input.email || u.mobile.replace(/\D/g, "") !== input.mobile || u.active !== input.active))
      throw new ApiError(409, "shared_user", "Shared accounts can change their role and godowns here, not global identity or status");
    Object.assign(u, { name: input.name, email: input.email, mobile: input.mobile, role: input.role as Role, godownIds: [...input.godownIds], active: input.active });
    return pubUser(u);
  }
  const u = { id: `u${Date.now()}`, name: input.name, email: input.email, mobile: input.mobile, role: input.role,
    godownIds: [...input.godownIds], active: input.active, invitePending: true, password: "" };
  s.users.push(u);
  s.userOrgIds[u.id] = [orgId];
  return pubUser(u);
}

// ---------- Settings ----------
export async function getSettings(): Promise<OrgSettings> {
  await delay(150);
  const value = db().settingsByOrg[getSession()?.orgId ?? ""];
  if (!value) throw new ApiError(404, "not_found", "Organisation settings not found");
  return clone(value);
}
export async function saveSettings(input: OrgSettingsInput): Promise<OrgSettings> {
  await delay(300);
  requirePerm("settings", "Only the Owner can change settings");
  const s = db();
  const problems = settingsProblems(input);
  if (problems.length) throw new ApiError(422, "invalid", problems[0]!);
  const { secret, ...gsp } = input.gsp;
  const orgId = getSession()?.orgId;
  const old = s.settingsByOrg[orgId ?? ""];
  if (!old) throw new ApiError(404, "not_found", "Organisation settings not found");
  s.settingsByOrg[orgId!] = { ...input, stateCode: stateFromGstin(input.gstin) ?? input.stateCode, ewbThreshold: 50000, reasonCodes: input.reasonCodes.map((r) => ({ ...r, code: r.code.trim().toUpperCase() })), gsp: { ...gsp, secretSet: old.gsp.secretSet || !!secret } };
  return clone(s.settingsByOrg[orgId!]);
}

// ---------- Print profiles ----------
export async function listPrintProfiles(): Promise<PrintProfile[]> {
  await delay(120);
  const orgId = getSession()?.orgId;
  return clone(db().printProfilesByOrg[orgId ?? ""] ?? []);
}
export async function savePrintProfile(p: PrintProfile): Promise<PrintProfile> {
  await delay(200);
  requirePerm("printProfiles", "Only Owner or Manager can change print profiles");
  const problems = printProfileProblems(p);
  if (problems.length) throw new ApiError(422, "invalid", problems[0]!);
  const orgId = getSession()?.orgId;
  const profiles = db().printProfilesByOrg[orgId ?? ""];
  if (!profiles?.some((x) => x.id === p.id)) throw new ApiError(404, "not_found", "Print profile not found");
  const saved = normalisePrintProfile(p);
  db().printProfilesByOrg[orgId!] = profiles.map((x) => x.id === p.id ? clone(saved) : x);
  return clone(saved);
}

// ---------- Search ----------
export async function searchDocs(f: SearchFilter): Promise<DocHit[]> {
  await delay(200);
  const s = db();
  const docs: DocHit[] = [
    ...s.salesOrders.filter((o) => o.number).map((o) => ({ type: "SO" as const, id: o.id, number: o.number!, date: o.date, party: o.customerName, amount: o.grandTotal, status: o.status })),
    ...s.challans.map((c) => ({ type: "DC" as const, id: c.id, number: c.number, date: c.date, party: c.customerName, amount: c.value, status: c.status })),
    ...invoicesForOrg(s.invoices, s.invoiceOrgIds, getSession()?.orgId ?? "")
      .map((i) => { refreshStatus(i); return { type: "INV" as const, id: i.id, number: i.number, date: i.date, party: i.customerName, amount: i.grandTotal, status: i.status }; }),
    ...s.receipts.map((r) => ({ type: "RCT" as const, id: r.id, number: r.number, date: r.date, party: r.customerName, amount: r.amount, status: r.advance > 0 ? "advance" : "allocated" })),
  ];
  return filterDocs(docs, f, MOCK_TODAY);
}
function refreshStatus(i: Invoice) {
  refresh(i);
}

// ---------- Reports ----------
function reportInvoices(from?: string, to?: string) {
  requirePerm("reports", "Your role cannot open reports");
  if ((from || to) && !(from && to && validReportRange(from, to))) throw new ApiError(422, "bad_report_range", "Select valid From and To dates");
  const s = db();
  const scoped = invoicesForOrg(s.invoices, s.invoiceOrgIds, getSession()?.orgId ?? "");
  scoped.forEach(refreshStatus);
  return scoped.filter((i) => (!from || i.date >= from) && (!to || i.date <= to));
}
export async function getSalesRegister(from: string, to: string): Promise<SalesRegisterRow[]> {
  await delay(200);
  return buildSalesRegister(clone(reportInvoices(from, to)));
}
export async function getReceivables(): Promise<ReceivableRow[]> {
  await delay(200);
  return buildReceivables(clone(reportInvoices()), new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
}
export async function getItemSales(from: string, to: string): Promise<ItemSalesRow[]> {
  await delay(200);
  const s = db();
  const orgId = getSession()?.orgId ?? "";
  return buildItemSales(clone(reportInvoices(from, to)), (id) => s.itemOrgIds[id] === orgId ? (s.items.find((i) => i.id === id)?.costPrice ?? 0) : 0);
}
export async function getGstr1(period: string): Promise<Gstr1> {
  if (!validReportMonth(period)) throw new ApiError(422, "bad_report_month", "Select a valid reporting month");
  await delay(250);
  const s = db();
  return buildGstr1(clone(reportInvoices()), period, s.orgs.find((o) => o.id === getSession()?.orgId)?.gstin ?? "");
}

/** Used by server/scripts/export-seed.ts to give the MySQL seed the same demo data. */
export function __seedSnapshot() {
  return { ...clone(db()), acked: [...acked] };
}

// ---------- Bulk import parsing ----------
export async function parseImport(src: File | { url: string }): Promise<string[][]> {
  const { parseImportBytes, fetchGoogleSheet, googleSheetCsvUrl } = await import("@/lib/import-parse");
  if (!(src instanceof File)) {
    const u = googleSheetCsvUrl(src.url);
    if (!u) throw new ApiError(400, "bad_link", "Only Google Sheets links are supported");
    return fetchGoogleSheet(u);
  }
  try {
    const r = parseImportBytes(new Uint8Array(await src.arrayBuffer()));
    return "sheetUrl" in r ? await fetchGoogleSheet(r.sheetUrl) : r.grid;
  } catch (e) {
    throw new ApiError(422, "unreadable_file", e instanceof Error ? e.message : "File could not be read");
  }
}
