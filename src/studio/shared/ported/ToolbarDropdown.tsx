"use client";


import { useCallback, useEffect, useRef, type ReactNode } from "react";

export type ToolbarDropdownItem = {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  items: ToolbarDropdownItem[];
  triggerTitle?: string;
  triggerClassName?: string;
  align?: "left" | "right";
};

export default function ToolbarDropdown({
  open,
  onOpenChange,
  trigger,
  items,
  triggerTitle,
  triggerClassName,
  align = "left",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const handlePick = useCallback((item: ToolbarDropdownItem) => {
    if (item.disabled) return;
    item.onSelect();
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        title={triggerTitle}
        className={triggerClassName ?? "px-2 py-0.5 text-sm rounded hover:bg-gray-200 text-gray-600 flex items-center gap-1"}
      >
        {trigger}
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 opacity-60">
          <path d="M5.5 7.5l4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className={`absolute top-full mt-1 z-50 min-w-[140px] bg-white border border-gray-200 rounded-lg shadow-lg py-1 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => handlePick(item)}
              disabled={item.disabled}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${item.active ? "text-blue-600 bg-blue-50" : "text-gray-700 hover:bg-gray-50"} disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
