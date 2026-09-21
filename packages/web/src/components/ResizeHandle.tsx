import type { PointerEvent } from "react";

interface Props {
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onReset: () => void;
}

/** Vertical divider between two columns. Drag to resize, double-click to reset all widths. */
export function ResizeHandle({ onPointerDown, onReset }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      className="group flex w-3 shrink-0 cursor-col-resize items-center justify-center touch-none select-none"
    >
      <div className="h-16 w-1 rounded-full bg-zinc-300 transition-colors group-hover:bg-indigo-500 dark:bg-zinc-700 dark:group-hover:bg-indigo-400" />
    </div>
  );
}
