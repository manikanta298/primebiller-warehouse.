import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { userProblems } from "@/lib/admin-rules";
import { toast } from "sonner";
import { api } from "@/api/client";
import { ROLES, type AppUser, type AppUserInput, type Role } from "@/api/types";
import { formatDate } from "@/lib/format";
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
      { title: "Users & roles — Girder" },
      { name: "description", content: "Invite staff, set their role and godowns, deactivate leavers, and see what each role can do." },
      { property: "og:title", content: "Users & roles — Girder" },
      { property: "og:description", content: "Invite staff, set their role and godowns, deactivate leavers, and see what each role can do." },
    ],
  }),
  component: Users,
});

const blank: AppUserInput = { name: "", email: "", mobile: "", role: "Storekeeper", godownIds: [], active: true };

function Users() {
  const orgId = useSession()?.orgId;
  const q = useQuery({ queryKey: ["users", orgId], queryFn: api.listUsers, enabled: !!orgId });
  const [edit, setEdit] = useState<AppUserInput | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = (q.data ?? []).filter((u) =>
    `${u.name} ${u.email} ${u.mobile}`.toLowerCase().includes(search.toLowerCase().trim()) &&
    (filter === "all" || (filter === "active" ? u.active : filter === "inactive" ? !u.active : u.role === filter))
  );
  return (
    <div>
      <PageHeader title="Users & roles" eyebrow="Operations" actions={<Button onClick={() => setEdit(blank)}><Plus /> Invite user</Button>} />
      <Tabs defaultValue="users">
        <TabsList><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="matrix">What each role can do</TabsTrigger></TabsList>
        <TabsContent value="users">
          <div className="mb-3 flex flex-wrap gap-2">
            <Input aria-label="Search users" placeholder="Search name, email or mobile" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            <NativeSelect value={filter} aria-label="Filter users" onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All users</option><option value="active">Active</option><option value="inactive">Inactive</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </NativeSelect>
          </div>
          {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60"><tr className="eyebrow">{["Name", "Email", "Mobile", "Role", "Godowns", "Last sign-in", "Status"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {visible.map((u) => (
                    <tr key={u.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setEdit(toInput(u))}>
                      <td className="px-4 py-2.5 font-medium">{u.name}</td>
                      <td className="px-4 py-2.5">{u.email}</td>
                      <td className="num px-4 py-2.5">{u.mobile}</td>
                      <td className="px-4 py-2.5">{u.role}</td>
                      <td className="num px-4 py-2.5">{u.godownIds.length}</td>
                      <td className="num px-4 py-2.5">{u.lastLogin ? formatDate(u.lastLogin) : "—"}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={!u.active ? "inactive" : u.invitePending ? "invited" : "active"} /></td>
                    </tr>
                  ))}
                  {!visible.length && <tr><td className="px-4 py-6 text-center text-muted-foreground" colSpan={7}>No users match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="matrix"><RoleMatrix /></TabsContent>
      </Tabs>
      <UserSheet key={`${orgId}:${edit?.id ?? "new"}`} value={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

const toInput = (u: AppUser): AppUserInput => ({ id: u.id, name: u.name, email: u.email, mobile: u.mobile, role: u.role, godownIds: u.godownIds, active: u.active });

function RoleMatrix() {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/60"><tr className="eyebrow"><th className="px-4 py-2.5 text-left font-semibold">Action</th>{ROLES.map((r) => <th key={r} className="px-3 py-2.5 text-center font-semibold">{r}</th>)}</tr></thead>
        <tbody>
          {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
            <tr key={p} className="border-t">
              <td className="px-4 py-2">{PERMISSION_LABELS[p]}</td>
              {ROLES.map((r) => <td key={r} className="px-3 py-2 text-center">{(PERMISSIONS[p] as readonly Role[]).includes(r) ? <Check className="mx-auto size-4 text-primary" /> : <span className="text-muted-foreground">—</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">Drivers only see challans assigned to them and record proof of delivery. Storekeepers are limited to their godowns.</p>
    </div>
  );
}

function UserSheet({ value, onClose }: { value: AppUserInput | null; onClose: () => void }) {
  const session = useSession();
  const qc = useQueryClient();
  const godowns = useQuery({ queryKey: ["godowns", session?.orgId], queryFn: () => api.listGodowns(session!.orgId!), enabled: !!session?.orgId });
  const [f, setF] = useState<AppUserInput>(blank);
  const [key, setKey] = useState<AppUserInput | null>(null);
  if (value !== key) { setKey(value); if (value) setF(value); }
  const problems = value ? userProblems(f, (godowns.data ?? []).filter((g) => g.active !== false).map((g) => g.id), [], session?.user.id) : [];
  const dirty = Boolean(value && JSON.stringify(f) !== JSON.stringify(value));
  const close = () => { if (!dirty || window.confirm("Discard unsaved user changes?")) onClose(); };
  const m = useMutation({
    mutationFn: api.saveUser,
    onSuccess: (u) => {
      const link = (u as { inviteUrl?: string }).inviteUrl;
      if (link) {
        void navigator.clipboard?.writeText(link).catch(() => undefined);
        toast.success(`Invite link for ${f.email} copied. Send it to them on WhatsApp or email.`, { description: link, duration: 15000 });
      } else toast.success(f.id ? "User saved" : `${f.email} added (demo accounts do not send invitations)`);
      qc.invalidateQueries({ queryKey: ["users", session?.orgId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (p: Partial<AppUserInput>) => setF((x) => ({ ...x, ...p }));
  return (
    <Sheet open={!!value} onOpenChange={(o) => !o && close()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader><SheetTitle>{f.id ? "Edit user" : "Invite user"}</SheetTitle></SheetHeader>
        <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); if (problems.length) { toast.error(problems[0]); return; } m.mutate(f); }}>
          <Field label="Name"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Email" hint={f.id ? undefined : "You'll get a link to send them so they can set their own password."}><Input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Mobile"><Input className="num" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} /></Field>
          <Field label="Role" hint={f.id ? "Changing the role signs them out everywhere." : undefined}>
            <NativeSelect value={f.role} onChange={(e) => set({ role: e.target.value as Role })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</NativeSelect>
          </Field>
          <Field label="Godowns they can work in">
            <div className="space-y-2 rounded-md border p-3">
              {godowns.data?.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.godownIds.includes(g.id)} onCheckedChange={(c) => set({ godownIds: c ? [...f.godownIds, g.id] : f.godownIds.filter((x) => x !== g.id) })} />
                  {g.name}
                </label>
              ))}
            </div>
          </Field>
          {f.id && <label className="flex items-center justify-between text-sm">Active (switch off instead of deleting) <Switch checked={f.active} onCheckedChange={(v) => set({ active: v })} /></label>}
          {problems.length > 0 && <p className="text-sm text-destructive" role="alert">{problems[0]}</p>}
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={m.isPending || godowns.isLoading || problems.length > 0}>{f.id ? "Save" : "Create invite link"}</Button></div>
          {!f.id && <p className="text-xs text-muted-foreground">The invite link is shown after saving; share it securely. No email is sent automatically.</p>}
        </form>
      </SheetContent>
    </Sheet>
  );
}
