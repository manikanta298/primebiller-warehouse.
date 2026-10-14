import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Keep suggestions outside horizontally scrolling line-item tables. */
export function SearchSuggestions({ anchor, id, label, children, minWidth = 180 }: {
  anchor: RefObject<HTMLElement | null>; id: string; label: string; children: ReactNode; minWidth?: number;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({ left: 8, top: 8, width: 280, maxHeight: 256 });
  useLayoutEffect(() => {
    const position = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, minWidth), window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      setStyle(below < 120 && above > below ? { left, width, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(256, above) } : { left, width, top: rect.bottom + 4, maxHeight: Math.max(60, Math.min(256, below)) });
    };
    position(); window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [anchor, minWidth]);
  if (typeof document === "undefined") return null;
  return createPortal(<div id={id} role="listbox" aria-label={label} style={style} className="fixed z-50 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">{children}</div>, document.body);
}
