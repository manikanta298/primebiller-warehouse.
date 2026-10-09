import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, HelpCircle, LogOut, Search, Building2, Warehouse, Package, FileText, User } from "lucide-react";
import { NAV } from "@/lib/nav";
import { canAccess, setSession, updateSession, type Session } from "@/lib/session";
import { api, usingMock } from "@/api/client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n" && canAccess(session.user.role, "/sales-orders")) {
        e.preventDefault();
        navigate({ to: "/sales-orders/$id", params: { id: "new" } });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, session.user.role]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar session={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar session={session} onHelp={() => setHelpOpen(true)} />
        <main className="flex-1 px-6 py-6 lg:px-8">{children}</main>
      </div>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

function Sidebar({ session }: { session: Session }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary font-mono text-sm font-bold text-sidebar-primary-foreground">
          G
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight text-sidebar-accent-foreground">Girder</div>
          <div className="text-[10px] uppercase tracking-widest opacity-60">Stock · GST</div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 px-3 pb-6">
        {NAV.map((sec) => {
          const items = sec.items.filter((i) => canAccess(session.user.role, i.to));
          if (!items.length) return null;
          return (
            <div key={sec.section}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest opacity-50">{sec.section}</div>
              <ul className="space-y-0.5">
                {items.map((i) => {
                  const active = pathname === i.to || pathname.startsWith(i.to + "/");
                  const Icon = i.icon;
                  return (
                    <li key={i.to}>
                      <Link
                        to={i.to}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--sidebar-primary)]",
                        )}
                      >
                        <Icon className="size-4 opacity-80" />
                        {i.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      {usingMock && (
        <div className="mx-3 mb-4 rounded-md border border-sidebar-border px-3 py-2 text-[11px] opacity-70">
          Demo data · set VITE_API_URL to connect your API
        </div>
      )}
    </aside>
  );
}

function TopBar({ session, onHelp }: { session: Session; onHelp: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const org = session.orgs.find((o) => o.id === session.orgId);
  const { data: godowns = [] } = useQuery({
    queryKey: ["godowns", session.orgId],
    queryFn: () => api.listGodowns(session.orgId!),
    enabled: !!session.orgId,
  });
  const { data: notes = [] } = useQuery({ queryKey: ["notifications"], queryFn: api.listNotifications });
  const { data: alerts = [] } = useQuery({ queryKey: ["alerts", session.godownId ?? "all"], queryFn: () => api.getAlerts(session.godownId ?? "all") });
  const openAlerts = alerts.filter((a) => !a.acknowledged).length;
  const unread = notes.filter((n) => !n.read).length + openAlerts;
  const godownName = session.godownId === "all" ? "All godowns" : godowns.find((g) => g.id === session.godownId)?.name ?? "…";

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    setSession(null);
    navigate({ to: "/login", replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur lg:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-56 justify-start">
            <Building2 />
            <span className="truncate">{org?.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Switch organisation</DropdownMenuLabel>
          {session.orgs.map((o) => (
            <DropdownMenuItem
              key={o.id}
              onClick={() => {
                updateSession({ orgId: o.id, godownId: "all" });
                qc.invalidateQueries();
              }}
            >
              <div>
                <div className="font-medium">{o.name}</div>
                <div className="num text-xs text-muted-foreground">{o.gstin}</div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Warehouse />
            {godownName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Godown</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => updateSession({ godownId: "all" })}>All godowns</DropdownMenuItem>
          {godowns.map((g) => (
            <DropdownMenuItem key={g.id} onClick={() => updateSession({ godownId: g.id })}>
              <span className="num mr-2 text-xs text-muted-foreground">{g.code}</span>
              {g.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
              <Bell />
              {unread > 0 && (
                <span className="num absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-ember text-[9px] text-ember-foreground">
                  {unread}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            {openAlerts > 0 && (
              <DropdownMenuItem onClick={() => navigate({ to: "/alerts" })} className="font-medium">
                {openAlerts} stock alert{openAlerts === 1 ? "" : "s"} need attention
              </DropdownMenuItem>
            )}
            {notes.map((n) => (
              <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-0.5">
                <span className={cn("text-sm", !n.read && "font-medium")}>{n.title}</span>
                <span className="text-xs text-muted-foreground">{n.time}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" aria-label="Help" onClick={onHelp}>
          <HelpCircle />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <User />
              <span className="hidden sm:inline">{session.user.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div>{session.user.email}</div>
              <div className="text-xs font-normal text-muted-foreground">{session.user.role}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function GlobalSearch() {
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: items = [] } = useQuery({ queryKey: ["items", q], queryFn: () => api.listItems(q), enabled: q.length > 1 });
  const { data: orders = [] } = useQuery({ queryKey: ["sales-orders", "all"], queryFn: () => api.listSalesOrders("all"), enabled: q.length > 1 });
  const ql = q.toLowerCase();
  const soHits = orders.filter((o) => `${o.number ?? "draft"} ${o.customerName}`.toLowerCase().includes(ql)).slice(0, 5);

  return (
    <div className="relative ml-2 hidden w-full max-w-sm lg:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && ref.current?.blur()}
        placeholder="Search items, orders, customers"
        className="h-9 w-full rounded-md border bg-card pl-8 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      <span className="kbd absolute right-2 top-1/2 -translate-y-1/2">/</span>
      {open && q.length > 1 && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-md border bg-popover shadow-lg">
          {items.length === 0 && soHits.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">No matches for “{q}”</div>}
          {items.slice(0, 5).map((i) => (
            <button
              key={i.id}
              onMouseDown={() => navigate({ to: "/items/$id", params: { id: i.id } })}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <Package className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{i.name}</span>
              <span className="num text-xs text-muted-foreground">{i.sku}</span>
            </button>
          ))}
          {soHits.map((o) => (
            <button
              key={o.id}
              onMouseDown={() => navigate({ to: "/sales-orders/$id", params: { id: o.id } })}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <FileText className="size-4 text-muted-foreground" />
              <span className="num text-xs">{o.number ?? "Draft"}</span>
              <span className="flex-1 truncate text-muted-foreground">{o.customerName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const rows = [
    ["/", "Focus global search"],
    ["Ctrl + N", "New sales order"],
    ["Ctrl + S", "Save draft (in editors)"],
    ["Ctrl + Enter", "Confirm document"],
    ["Esc", "Close menus and dialogs"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="divide-y">
          {rows.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between py-2 text-sm">
              <span>{d}</span>
              <span className="kbd">{k}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
