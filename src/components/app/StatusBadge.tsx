import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  confirmed: "bg-primary/10 text-primary border-primary/30",
  partially_delivered: "bg-warning/15 text-foreground border-warning/40",
  delivered: "bg-success/15 text-success border-success/30",
  in_transit: "bg-accent/15 text-foreground border-accent/40",
  awaiting_payment: "bg-primary/10 text-primary border-primary/30",
  partially_paid: "bg-warning/15 text-foreground border-warning/40",
  open: "bg-primary/10 text-primary border-primary/30",
  partially_received: "bg-warning/15 text-foreground border-warning/40",
  received: "bg-success/15 text-success border-success/30",
  paid: "bg-success/15 text-success border-success/30",
  overdue: "bg-destructive/10 text-destructive border-destructive/30",
  pending_approval: "bg-warning/15 text-foreground border-warning/40",
  posted: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
  advance: "bg-accent/15 text-foreground border-accent/40",
  allocated: "bg-success/15 text-success border-success/30",
  active: "bg-success/15 text-success border-success/30",
  inactive: "bg-muted text-muted-foreground border-border",
  invited: "bg-warning/15 text-foreground border-warning/40",
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed · stock held",
  partially_delivered: "Partially delivered",
  delivered: "Delivered",
  in_transit: "In transit",
  cancelled: "Cancelled",
  awaiting_payment: "Awaiting payment",
  partially_paid: "Partially paid",
  paid: "Paid",
  open: "Open",
  partially_received: "Partially received",
  received: "Received",
  overdue: "Overdue",
  pending_approval: "Awaiting approval",
  posted: "Posted",
  rejected: "Rejected",
  advance: "Has advance",
  allocated: "Allocated",
  active: "Active",
  inactive: "Inactive",
  invited: "Invite sent",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", STYLES[status] ?? STYLES["draft"])}>
      {LABELS[status] ?? status}
    </span>
  );
}
