import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/api/client";

export function PageHeader({ title, eyebrow, actions, children }: { title: string; eyebrow?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {children}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-14 text-center">
      <Inbox className="mb-3 size-8 text-muted-foreground" />
      <div className="font-medium">{title}</div>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <AlertTriangle className="mb-3 size-7 text-destructive" />
      <div className="font-medium">Couldn't load this</div>
      <p className="mt-1 text-sm text-muted-foreground">{msg}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function ComingNext({ title, section, bullets }: { title: string; section: string; bullets: string[] }) {
  return (
    <div>
      <PageHeader title={title} eyebrow={section} />
      <div className="rounded-lg border bg-card p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-ember/15 text-ember">
            <Hammer className="size-5" />
          </div>
          <div>
            <div className="font-semibold">Coming next</div>
            <p className="text-sm text-muted-foreground">This screen is planned. Ask for it when you're ready and it will be built against the same API.</p>
          </div>
        </div>
        <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2 rounded-md bg-muted px-3 py-2">
              <span className="text-primary">•</span>
              {b}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
