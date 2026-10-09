import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({ label, hint, error, children, className }: { label: string; hint?: string | undefined; error?: string | null | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn("h-9 w-full rounded-md border bg-card px-2 text-sm outline-none focus:ring-1 focus:ring-ring", props.className)}
    />
  );
}

export function ActiveDot({ active }: { active: boolean | undefined }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", active === false ? "text-muted-foreground" : "text-primary")}>
      <span className={cn("size-1.5 rounded-full", active === false ? "bg-muted-foreground" : "bg-primary")} />
      {active === false ? "Inactive" : "Active"}
    </span>
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            value === o.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
