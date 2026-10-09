import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { CreditCheck } from "@/lib/gst";
import { formatINR } from "@/lib/format";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function CreditOverrideDialog({
  open, onOpenChange, check, customer, canOverride, onOverride, pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  check: CreditCheck | null;
  customer: string;
  canOverride: boolean;
  onOverride: (reason: string) => void;
  pending?: boolean;
}) {
  const [reason, setReason] = useState("");
  if (!check) return null;
  const rows: [string, number, string?][] = [
    ["Credit limit", check.limit],
    ["Outstanding", check.outstanding],
    ["Available", check.available],
    ["This order", check.orderTotal],
    ["Over by", check.orderTotal - check.available, "text-destructive font-semibold"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-ember" /> Credit limit exceeded</DialogTitle>
          <DialogDescription>{customer} would go over their credit limit with this order.</DialogDescription>
        </DialogHeader>
        <div className="divide-y rounded-md border">
          {rows.map(([k, v, cls]) => (
            <div key={k} className="flex justify-between px-3 py-2 text-sm">
              <span className="text-muted-foreground">{k}</span>
              <span className={`num ${cls ?? ""}`}>{formatINR(v)}</span>
            </div>
          ))}
        </div>
        {canOverride ? (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Reason for override (recorded on the order)</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Post-dated cheque received for ₹3,00,000" />
          </div>
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm">Only the Owner can approve this order. Ask them to open it and confirm, or collect a payment first.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep as draft</Button>
          {canOverride && (
            <Button variant="ember" disabled={reason.trim().length < 5 || pending} onClick={() => onOverride(reason.trim())}>
              Override & confirm
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
