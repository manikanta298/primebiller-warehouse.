import { useSyncExternalStore } from "react";
import type { Org, Role, User } from "@/api/types";

export interface Session {
  token: string;
  user: User;
  orgs: Org[];
  orgId: string | null;
  godownId: string | "all";
}

const KEY = "girder.session";
const listeners = new Set<() => void>();
let cache: Session | null | undefined;

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  if (cache === undefined) {
    try {
      cache = JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      cache = null;
    }
  }
  return cache ?? null;
}

export function setSession(s: Session | null) {
  cache = s;
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export function updateSession(patch: Partial<Session>) {
  const s = getSession();
  if (s) setSession({ ...s, ...patch });
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSession,
    () => null,
  );
}

/** Route prefix → roles allowed. Paths not listed are open to every signed-in role. */
export const ROUTE_ROLES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/users", roles: ["Owner"] },
  { prefix: "/settings", roles: ["Owner"] },
  { prefix: "/numbering", roles: ["Owner"] },
  { prefix: "/print-profiles", roles: ["Owner", "Manager"] },
  { prefix: "/reports", roles: ["Owner", "Manager", "Accountant"] },
  { prefix: "/import", roles: ["Owner", "Manager"] },
  { prefix: "/invoices", roles: ["Owner", "Manager", "Accountant"] },
  { prefix: "/receipts", roles: ["Owner", "Manager", "Accountant"] },
  { prefix: "/sales-orders", roles: ["Owner", "Manager", "Sales"] },
  { prefix: "/search", roles: ["Owner", "Manager", "Sales", "Accountant"] },
  { prefix: "/parties", roles: ["Owner", "Manager", "Sales", "Accountant"] },
  { prefix: "/masters", roles: ["Owner", "Manager"] },
  { prefix: "/purchases", roles: ["Owner", "Manager", "Storekeeper"] },
  { prefix: "/items", roles: ["Owner", "Manager", "Storekeeper", "Sales", "Accountant"] },
  { prefix: "/stock-ledger", roles: ["Owner", "Manager", "Storekeeper", "Accountant"] },
  { prefix: "/alerts", roles: ["Owner", "Manager", "Storekeeper"] },
  { prefix: "/transfers", roles: ["Owner", "Manager", "Storekeeper"] },
  { prefix: "/adjustments", roles: ["Owner", "Manager", "Storekeeper"] },
  { prefix: "/warehouses", roles: ["Owner", "Manager", "Storekeeper"] },
  { prefix: "/challans", roles: ["Owner", "Manager", "Storekeeper", "Driver"] },
];

export function canAccess(role: Role, pathname: string): boolean {
  const rule = ROUTE_ROLES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  return !rule || rule.roles.includes(role);
}
