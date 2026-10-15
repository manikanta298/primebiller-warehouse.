import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { QuotationDraft, QuotationInput } from "@/api/types";

/** Serial writes with optimistic versions: late responses never replace form input. */
export function useQuotationAutosave(key: string, input: QuotationInput, initial: QuotationDraft, enabled: boolean) {
  const version = useRef(initial.version);
  const saved = useRef(JSON.stringify(initial.input ?? input));
  const flight = useRef<Promise<void> | null>(null);
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasSaved, setHasSaved] = useState(!!initial.input);
  const serialized = JSON.stringify(input);
  const pending = serialized !== saved.current;
  useEffect(() => {
    if (!enabled || !pending || flight.current || error) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      const task = api.saveQuotationDraft(key, version.current, JSON.parse(serialized)).then(result => {
        version.current = result.version;
        saved.current = serialized;
        setHasSaved(true);
      }).catch((e: Error) => { setError(e); throw e; });
      flight.current = task;
      // Keep rejection available to manual Save, but don't produce an unhandled rejection.
      void task.catch(() => {}).finally(() => { flight.current = null; setSaving(false); setTick(n => n + 1); });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [key, serialized, enabled, pending, tick, error]);
  return {
    pending, saving, hasSaved, error,
    retry: () => setError(null),
    wait: async () => { if (flight.current) await flight.current; return version.current; },
    markSaved: (snapshot: QuotationInput) => { version.current += 1; saved.current = JSON.stringify(snapshot); setError(null); },
  };
}
