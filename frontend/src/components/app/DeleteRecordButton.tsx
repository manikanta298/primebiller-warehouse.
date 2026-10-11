import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { getSession, updateSession, useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import type { DeletableRecord } from "@/lib/record-delete-rules";
import { Button } from "@/components/ui/button";

export function DeleteRecordButton({ kind, id, name, orgId }: { kind: DeletableRecord; id: string; name: string; orgId: string }) {
  const session = useSession(), qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => {
      if (getSession()?.orgId !== orgId) throw new Error("Organisation changed. Refresh before deleting.");
      return api.deleteRecord(kind,id,orgId);
    },
    onSuccess: () => {
      if (kind === "warehouses" && getSession()?.orgId === orgId && getSession()?.godownId === id) updateSession({godownId:"all"});
      qc.removeQueries({queryKey:[kind === "items" ? "item" : kind === "parties" ? "party" : "warehouse", orgId,id]});
      qc.invalidateQueries();
      toast.success(`${name} deleted`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can(session?.user.role,"editMasters")) return null;
  return <Button aria-label={`Delete ${name}`} size="sm" variant="outline" className="min-h-11 text-destructive" disabled={remove.isPending} onClick={() => {
    if (window.confirm(`Delete "${name}" permanently? Only unused records can be deleted. Records with stock, balances, assignments or document history are protected.`)) remove.mutate();
  }}><Trash2 className="size-4" />{remove.isPending ? "Deleting…" : "Delete"}</Button>;
}
