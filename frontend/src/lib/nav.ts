import {
  LayoutDashboard, Search, FileText, Truck, Receipt, Wallet, BookOpen, Bell, ArrowLeftRight,
  SlidersHorizontal, Package, Users, Warehouse, Upload, BarChart3, Printer, Settings, ShoppingCart,
  ShieldCheck, Hash, Tags,
} from "lucide-react";

export const NAV = [
  {
    section: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/search", label: "Find a document", icon: Search },
    ],
  },
  {
    section: "Sales",
    items: [
      { to: "/sales-orders", label: "Sales orders", icon: FileText },
      { to: "/challans", label: "Delivery challans", icon: Truck },
      { to: "/invoices", label: "Tax invoices", icon: Receipt },
      { to: "/receipts", label: "Receipts & advances", icon: Wallet },
    ],
  },
  {
    section: "Purchases",
    items: [{ to: "/purchases", label: "Purchases / GRN", icon: ShoppingCart }],
  },
  {
    section: "Inventory",
    items: [
      { to: "/stock-ledger", label: "Stock ledger", icon: BookOpen },
      { to: "/alerts", label: "Alerts", icon: Bell },
      { to: "/transfers", label: "Transfers", icon: ArrowLeftRight },
      { to: "/adjustments", label: "Adjustments", icon: SlidersHorizontal },
    ],
  },
  {
    section: "Masters",
    items: [
      { to: "/items", label: "Items", icon: Package },
      { to: "/parties", label: "Parties", icon: Users },
      { to: "/masters", label: "Units, categories & HSN", icon: Tags },
      { to: "/warehouses", label: "Warehouses", icon: Warehouse },
    ],
  },
  {
    section: "Operations",
    items: [
      { to: "/import", label: "Bulk import", icon: Upload },
      { to: "/reports", label: "Reports & GSTR-1", icon: BarChart3 },
      { to: "/print-profiles", label: "Print profiles", icon: Printer },
      { to: "/users", label: "Users & roles", icon: ShieldCheck },
      { to: "/numbering", label: "Numbering series", icon: Hash },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const;
