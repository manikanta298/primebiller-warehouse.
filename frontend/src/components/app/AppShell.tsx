import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, HelpCircle, LogOut, Search, Building2, Warehouse, Package, FileText, User, Menu } from "lucide-react";
import { SearchHighlight } from "./SearchHighlight";
import { matchesSearch, searchRank, searchReady } from "@/lib/search-match";
import { NAV } from "@/lib/nav";
import { canAccess, setSession, updateSession, type Session } from "@/lib/session";
import { api, usingMock } from "@/api/client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

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
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
    <div className="flex min-h-dvh bg-background">
      <Sidebar session={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar session={session} onHelp={() => setHelpOpen(true)} />
        <main id="main-content" className="app-content min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">{children}</main>
      </div>
      <SheetContent side="left" className="flex h-dvh w-[min(20rem,88vw)] max-w-none flex-col border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:max-w-none [&>button]:right-3 [&>button]:top-3 [&>button]:size-11 [&>button]:text-sidebar-foreground">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Choose a section of Girder.</SheetDescription>
        <Sidebar session={session} mobile onNavigate={() => setMenuOpen(false)} />
      </SheetContent>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
    </Sheet>
  );
}

function Sidebar({ session, mobile = false, onNavigate }: { session: Session; mobile?: boolean; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside aria-label={mobile ? "Mobile navigation" : "Desktop navigation"} className={cn(
      "flex-col bg-sidebar text-sidebar-foreground",
      mobile ? "flex min-h-0 flex-1" : "sticky top-0 hidden h-dvh w-60 shrink-0 lg:flex xl:w-64",
    )}>
      <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-5 py-5">
        <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary font-mono text-sm font-bold text-sidebar-primary-foreground">
          G
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight text-sidebar-accent-foreground">Girder</div>
          <div className="text-[10px] uppercase tracking-widest opacity-60">Stock · GST</div>
        </div>
      </div>
      <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-5 [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]">
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
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 touch-manipulation items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring lg:min-h-9",
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
  const ca = session.user.role === "Chartered Accountant";
  const org = session.orgs.find((o) => o.id === session.orgId);
  const { data: godowns = [] } = useQuery({
    queryKey: ["godowns", session.orgId],
    queryFn: () => api.listGodowns(session.orgId!),
    enabled: !!session.orgId && !ca,
  });
  const { data: notes = [] } = useQuery({ queryKey: ["notifications"], queryFn: api.listNotifications, enabled: !ca });
  const { data: alerts = [] } = useQuery({ queryKey: ["alerts", session.orgId, session.godownId ?? "all"], queryFn: () => api.getAlerts(session.godownId ?? "all"), enabled: !ca });
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
    <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur sm:flex-nowrap sm:px-4 lg:px-6">
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation menu" className="size-11 shrink-0 touch-manipulation lg:hidden">
          <Menu />
        </Button>
      </SheetTrigger>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-11 min-w-0 flex-1 justify-start px-2 sm:max-w-44 sm:flex-none">
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
                const role = o.role ?? session.user.role;
                updateSession({ orgId: o.id, godownId: "all", user: { ...session.user, role } });
                navigate({ to: role === "Chartered Accountant" ? "/ca" : "/dashboard" });
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

      {!ca && <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={`Choose warehouse: ${godownName}`} className="order-last h-11 w-full min-w-0 justify-start sm:order-none sm:w-auto sm:max-w-44">
            <Warehouse />
            <span className="truncate">{godownName}</span>
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
      </DropdownMenu>}

      {!ca && <GlobalSearch session={session} />}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="relative size-11">
              <Bell />
              {unread > 0 && (
                <span className="num absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-ember text-[9px] text-ember-foreground">
                  {unread}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
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
        <Button variant="ghost" size="icon" aria-label="Help" className="hidden size-11 sm:inline-flex" onClick={onHelp}>
          <HelpCircle />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Account menu" className="h-11 px-3">
              <User />
              <span className="hidden max-w-32 truncate xl:inline">{session.user.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
            <DropdownMenuLabel className="break-all">
              <div>{session.user.email}</div>
              <div className="text-xs font-normal text-muted-foreground">{session.user.role}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onHelp} className="sm:hidden"><HelpCircle /> Help</DropdownMenuItem>
            <DropdownMenuItem onClick={signOut}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function GlobalSearch({ session }: { session: Session }) {
  const [active, setActive] = useState(0);
  const listId = useId();
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

  const enabled = searchReady(q) && !!session.orgId;
  const { data: items = [] } = useQuery({ queryKey: ["items", session.orgId, "global-search"], queryFn: () => api.listItems(), enabled: enabled && canAccess(session.user.role, "/items") });
  const { data: orders = [] } = useQuery({ queryKey: ["sales-orders", session.orgId, "all"], queryFn: () => api.listSalesOrders("all"), enabled: enabled && canAccess(session.user.role, "/sales-orders") });
  const { data: customers = [] } = useQuery({ queryKey: ["parties", session.orgId, "global-search"], queryFn: () => api.listParties(), enabled: enabled && canAccess(session.user.role, "/parties") });
  const hits = [
    ...(canAccess(session.user.role, "/items") ? items : []).filter(i => matchesSearch(`${i.name} ${i.sku} ${i.hsn}`, q)).slice(0,5).map(i => ({ key: `item-${i.id}`, name: i.name, detail: i.sku, open: () => navigate({ to: "/items/$id", params: { id: i.id } }) })),
    ...(canAccess(session.user.role, "/sales-orders") ? orders : []).filter(o => matchesSearch(`${o.number ?? "draft"} ${o.customerName}`, q)).slice(0,5).map(o => ({ key: `order-${o.id}`, name: o.number ?? "Draft", detail: o.customerName, open: () => navigate({ to: "/sales-orders/$id", params: { id: o.id } }) })),
    ...(canAccess(session.user.role, "/parties") ? customers : []).filter(c => matchesSearch(`${c.name} ${c.phone} ${c.gstin ?? ""}`, q)).slice(0,5).map(c => ({ key: `party-${c.id}`, name: c.name, detail: "Party", open: () => navigate({ to: "/parties/$id", params: { id: c.id } }) })),
  ].sort((a,b) => searchRank(a.name,q) - searchRank(b.name,q));
  const highlighted = Math.min(active, Math.max(0,hits.length - 1));
  useEffect(() => { setQ(""); setOpen(false); setActive(0); }, [session.orgId]);

  return (
    <div className="relative ml-2 hidden min-w-0 flex-1 xl:block" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value); setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        role="combobox" aria-autocomplete="list" aria-expanded={open && searchReady(q)} aria-controls={listId} aria-activedescendant={open && searchReady(q) && hits[highlighted] ? `${listId}-${highlighted}` : undefined}
        onKeyDown={e => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); }
          if (!open || !searchReady(q) || !hits.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive(n => Math.max(0,Math.min(hits.length-1,n+(e.key === "ArrowDown" ? 1 : -1)))); }
          if (e.key === "Enter") { e.preventDefault(); hits[highlighted]!.open(); setOpen(false); }
        }}
        aria-label="Search items, orders, customers"
        placeholder="Search items, orders, customers"
        className="h-9 w-full rounded-md border bg-card pl-8 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      <span className="kbd absolute right-2 top-1/2 -translate-y-1/2">/</span>
      {open && searchReady(q) && <div id={listId} role="listbox" aria-label="Global search matches" className="absolute left-0 right-0 top-11 z-50 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-lg">{!hits.length && <p className="px-3 py-4 text-sm text-muted-foreground">No matches for “{q}”</p>}{hits.map((hit,index) => <button type="button" role="option" aria-label={`${hit.name} ${hit.detail}`} id={`${listId}-${index}`} aria-selected={highlighted === index} key={hit.key} onPointerDown={e => e.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => { hit.open(); setOpen(false); }} className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${highlighted === index ? "bg-accent" : "hover:bg-accent"}`}><span><SearchHighlight text={hit.name} query={q}/></span><span className="text-xs text-muted-foreground"><SearchHighlight text={hit.detail} query={q}/></span></button>)}</div>}

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
