import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { SearchableSelect } from "./searchable-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({ label, hint, error, children, className }: { label: string; hint?: string | undefined; error?: string | null | undefined; children: ReactNode; className?: string | undefined }) {
  const generatedId = useId();
  const controls = Children.toArray(children);
  const control = controls.find((child) => isValidElement(child) &&
    [Input, Textarea, NativeSelect, "input", "textarea", "select"].some(type => type === child.type)) as ReactElement<{ id?: string | undefined; "aria-describedby"?: string | undefined; "aria-invalid"?: boolean | undefined }> | undefined;
  const controlId = control?.props.id ?? generatedId;
  const descriptionId = `${controlId}-description`;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={control ? controlId : undefined} className="text-xs font-medium">{label}</Label>
      {controls.map((child) => child === control ? cloneElement(control, {
        id: controlId,
        "aria-describedby": [control.props["aria-describedby"], (error || hint) && descriptionId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : control.props["aria-invalid"],
      }) : child)}
      {error ? <p id={descriptionId} className="text-xs text-destructive">{error}</p> : hint ? <p id={descriptionId} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = Children.toArray(props.children).filter(isValidElement).map(child => {
    const option = child.props as { value?: string; children?: ReactNode; disabled?: boolean };
    const text = Children.toArray(option.children).filter(x => typeof x === "string" || typeof x === "number").join("");
    return { value: String(option.value ?? ""), label: text, disabled: !!option.disabled };
  });
  const prompt = options.find(o => !o.value)?.label ?? "";
  const label = props["aria-label"] ?? (/customer/i.test(prompt) ? "Customer" : /supplier/i.test(prompt) ? "Supplier" : /item/i.test(prompt) ? "Item" : "");
  if (/customer|supplier|^item(?: \d+)?$/i.test(label)) return <SearchableSelect inputId={props.id} describedBy={props["aria-describedby"]} invalid={props["aria-invalid"]} label={label} searchLabel={`Search ${label.toLowerCase()}`} placeholder={prompt || "Choose…"} value={String(props.value ?? "")} disabled={!!props.disabled} required={!!props.required} options={options.filter(o => o.value)} onChange={value => props.onChange?.({ target: { value }, currentTarget: { value } } as React.ChangeEvent<HTMLSelectElement>)} />;
  return (
    <select
      {...props}
      className={cn("h-11 w-full min-w-0 rounded-md border bg-card px-2 text-base outline-none sm:h-9 sm:text-sm focus:ring-1 focus:ring-ring", props.className)}
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
