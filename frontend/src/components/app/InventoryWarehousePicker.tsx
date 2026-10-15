import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { updateSession, useSession } from "@/lib/session";

export function InventoryWarehousePicker() {
  const session = useSession();
  const q = useQuery({ queryKey: ["godowns", session?.orgId], queryFn: () => api.listGodowns(session!.orgId!), enabled: !!session?.orgId });
  return <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
    <label className="w-full text-sm sm:w-auto">Inventory warehouse
      <select aria-label="Inventory warehouse" className="mt-1 block min-h-11 max-w-full rounded border bg-background px-3 sm:ml-2 sm:mt-0 sm:inline-block" value={session?.godownId ?? "all"} onChange={e => updateSession({ godownId: e.target.value })}>
        <option value="all">Choose warehouse</option>
        {(q.data ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </label>
    <span className="text-xs text-muted-foreground">Quantities and stock values belong to the selected warehouse.</span>
    {q.error && <button className="min-h-11 text-sm text-destructive underline" onClick={() => q.refetch()}>Reload warehouses</button>}
  </div>;
}
