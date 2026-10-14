import { useLayoutEffect, useRef } from "react";
import type { Invoice, OrgSettings, PrintProfile } from "@/api/types";
import { InvoiceSheet } from "./InvoiceSheet";
import { singlePageInvoiceScale } from "@/lib/invoice-print";

/** Fit every line to one A4 page; never omit or crop invoice content. */
export function SinglePageInvoice({ invoice, settings, profile }: { invoice: Invoice; settings: OrgSettings; profile: PrintProfile }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let alive = true;
    const fit = () => {
      if (!alive) return;
      const sheet = root.current?.querySelector<HTMLElement>(".invoice-sheet");
      if (!sheet) return;
      sheet.style.zoom = "1";
      const height = sheet.getBoundingClientRect().height;
      sheet.style.zoom = String(singlePageInvoiceScale(height));
    };
    fit(); window.addEventListener("beforeprint", fit); window.addEventListener("resize", fit);
    document.fonts?.ready.then(fit);
    return () => { alive = false; window.removeEventListener("beforeprint", fit); window.removeEventListener("resize", fit); };
  }, [invoice, settings, profile]);
  return <div ref={root} className="print-document print-a4 invoice-single-page" aria-label="Invoice print layout"><style>{"@page { size: A4; margin: 12mm; }"}</style><InvoiceSheet invoice={invoice} settings={settings} profile={profile} copy="Original"/></div>;
}
