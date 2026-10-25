"use client";
import { useEffect, useId, useRef } from "react";
import { useT } from "./site-t";
type Props = {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: "danger" | "primary";
    onConfirm: () => void;
    onCancel: () => void;
    hideCancel?: boolean;
    input?: {
        value: string;
        onChange: (v: string) => void;
        placeholder?: string;
        type?: "text" | "password";
    };
    testId?: string;
    zClassName?: string;
};
export default function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, confirmVariant = "danger", onConfirm, onCancel, hideCancel = false, input, testId = "confirm-dialog", zClassName = "z-[100000]", }: Props) {
    const t = useT();
    const titleId = useId();
    const descId = useId();
    const focusRef = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
    useEffect(() => {
        if (!open)
            return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
        } };
        window.addEventListener("keydown", onKey);
        const el = focusRef.current;
        if (el) {
            try {
                el.focus();
                if (el instanceof HTMLInputElement)
                    el.select();
            }
            catch { }
        }
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onCancel]);
    if (!open)
        return null;
    return (<div className={`fixed inset-0 ${zClassName} flex items-center justify-center`} data-testid={testId}>
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} data-testid={`${testId}-backdrop`}/>
      <div className="relative bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl" role={input ? "dialog" : "alertdialog"} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined}>
        <h3 id={titleId} className="text-base font-semibold text-white mb-2">{title}</h3>
        {description && (<p id={descId} className="text-sm text-gray-400 mb-6 whitespace-pre-wrap break-words" data-testid={`${testId}-message`}>{description}</p>)}
        {input && (<input ref={(el) => { focusRef.current = el; }} type={input.type ?? "text"} autoComplete={input.type === "password" ? "off" : undefined} value={input.value} placeholder={input.placeholder} onChange={(e) => input.onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") {
            e.preventDefault();
            onConfirm();
        } }} className="w-full mb-6 px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 text-white outline-none focus:border-violet-500/60" data-testid={`${testId}-input`}/>)}
        <div className="flex justify-end gap-3">
          {!hideCancel && (<button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors" data-testid={`${testId}-cancel`}>
              {cancelLabel ?? t("cancel")}
            </button>)}
          <button type="button" ref={(el) => { if (!input)
        focusRef.current = el; }} onClick={onConfirm} className={`px-4 py-2 text-sm font-medium keep-white rounded-xl transition-colors ${confirmVariant === "primary"
            ? "bg-violet-600 hover:bg-violet-500"
            : "bg-red-600 hover:bg-red-500"}`} data-testid={`${testId}-ok`}>
            {confirmLabel ?? t("delete")}
          </button>
        </div>
      </div>
    </div>);
}
