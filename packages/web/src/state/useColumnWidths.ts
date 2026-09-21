import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "katsu-magi.columnWidths.v1";
const MIN_FRACTION = 0.12;

function load(count: number): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length === count && parsed.every((n) => typeof n === "number" && n > 0)) {
        const sum = parsed.reduce((a, b) => a + b, 0);
        return parsed.map((n) => n / sum);
      }
    }
  } catch {
    // ignore storage problems; fall back to equal widths
  }
  return Array(count).fill(1 / count);
}

/**
 * Column widths as fractions of the row (sum = 1), persisted per browser.
 * `startDrag(i)` returns a pointerdown handler for the divider between column i and i+1.
 */
export function useColumnWidths(count: number) {
  const [widths, setWidths] = useState<number[]>(() => load(count));
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
      // ignore
    }
  }, [widths]);

  const reset = useCallback(() => setWidths(Array(count).fill(1 / count)), [count]);

  const startDrag = useCallback(
    (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      e.preventDefault();
      const total = container.getBoundingClientRect().width;
      const startX = e.clientX;
      const start = [...widths];
      const pair = start[index]! + start[index + 1]!;

      const onMove = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) / total;
        let left = start[index]! + delta;
        left = Math.max(MIN_FRACTION, Math.min(pair - MIN_FRACTION, left));
        const next = [...start];
        next[index] = left;
        next[index + 1] = pair - left;
        setWidths(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [widths],
  );

  return { widths, containerRef, startDrag, reset };
}
