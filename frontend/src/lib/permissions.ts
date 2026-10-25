import { CA_ROLE, type Role } from "../api/types.ts";

/** Single source of truth for what each role may do (spec 0.1). The UI hides buttons; the server enforces the same table. */
export const PERMISSIONS = {
  editItems: ["Owner", "Manager"],
  editMasters: ["Owner", "Manager"],
  editParties: ["Owner", "Manager", "Sales"],
  salesOrders: ["Owner", "Manager", "Sales"],
  approveQuotationRevision: ["Owner", "Manager"],
  customerHistory: ["Owner", "Manager", "Accountant"],
  overrideCredit: ["Owner"],
  dispatch: ["Owner", "Manager", "Storekeeper"],
  issueInvoice: ["Owner", "Manager", "Accountant"],
  recordReceipt: ["Owner", "Manager", "Accountant"],
  raisePO: ["Owner", "Manager"],
  postGrn: ["Owner", "Manager", "Storekeeper"],
  transfer: ["Owner", "Manager", "Storekeeper"],
  cancelTransfer: ["Owner", "Manager"],
  adjust: ["Owner", "Manager", "Storekeeper"],
  approveAdjustment: ["Owner", "Manager"],
  caAudit: ["Owner", "Manager", "Accountant", CA_ROLE],
  reports: ["Owner", "Manager", "Accountant"],
  printProfiles: ["Owner", "Manager"],
  manageUsers: ["Owner"],
  settings: ["Owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_LABELS: Record<Permission, string> = {
  editItems: "Edit items",
  editMasters: "Edit units, categories, HSN, godowns",
  editParties: "Add and edit parties",
  salesOrders: "Create and confirm sales orders",
  approveQuotationRevision: "Approve quotation revisions",
  customerHistory: "View customer purchase history",
  overrideCredit: "Override credit limit",
  dispatch: "Dispatch challans and e-way bills",
  issueInvoice: "Issue tax invoices",
  recordReceipt: "Record receipts",
  raisePO: "Raise purchase orders",
  postGrn: "Receive goods (GRN)",
  transfer: "Send and receive transfers",
  cancelTransfer: "Cancel transfers",
  adjust: "Create stock adjustments",
  approveAdjustment: "Approve adjustments",
  caAudit: "Read-only CA audit workspace",
  reports: "Reports and GSTR-1",
  printProfiles: "Print profiles",
  manageUsers: "Manage users",
  settings: "Organisation settings and numbering",
};

export function can(role: Role | string | undefined, p: Permission): boolean {
  return !!role && (PERMISSIONS[p] as readonly string[]).includes(role);
}

export const isReadOnlyRole = (role: Role | string | undefined): boolean => role === CA_ROLE;
