"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { useT } from "./site-t";
import { currentDialog, settleDialog, subscribeDialogs, type PendingDialog } from "../studio/shared/dialog-store";
const getServer = (): PendingDialog | null => null;
export default function DialogHost() {
    const t = useT();
    const cur = useSyncExternalStore(subscribeDialogs, currentDialog, getServer);
    const [text, setText] = useState("");
    useEffect(() => { if (cur?.req.kind === "prompt")
        setText(cur.req.defaultValue ?? ""); }, [cur?.id, cur?.req.kind, cur?.req.defaultValue]);
    const onCancel = useCallback(() => {
        if (!cur)
            return;
        settleDialog(cur.id, cur.req.kind === "confirm" ? false : cur.req.kind === "prompt" ? null : undefined);
    }, [cur]);
    const onConfirm = useCallback(() => {
        if (!cur)
            return;
        settleDialog(cur.id, cur.req.kind === "confirm" ? true : cur.req.kind === "prompt" ? text : undefined);
    }, [cur, text]);
    if (!cur)
        return null;
    const { kind } = cur.req;
    const title = cur.req.title ?? (kind === "alert" ? t("dlg_alert_title") : kind === "prompt" ? t("dlg_prompt_title") : t("dlg_confirm_title"));
    const okLabel = cur.req.confirmLabel ?? (kind === "alert" ? t("dlg_got_it") : t("confirm"));
    return (<ConfirmDialog open title={title} description={cur.req.message} confirmLabel={okLabel} cancelLabel={cur.req.cancelLabel} confirmVariant={cur.req.danger ? "danger" : "primary"} hideCancel={kind === "alert"} input={kind === "prompt" ? { value: text, onChange: setText, placeholder: cur.req.placeholder, type: cur.req.inputType } : undefined} onConfirm={onConfirm} onCancel={onCancel} testId={`app-dialog-${kind}`} zClassName="z-[100100]"/>);
}
