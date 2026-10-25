'use client'
// 网页剪辑页·「程式」页签右边内容（程序片段轨）：
// 上方＝选中程序片段的参数面板（照程序包 manifest 自动长：text→输入框、number→滑杆、color→取色、select→下拉、bool→开关·改了进复原栈）；
// 下面＝程序包格（内建／我上传的）·点一个 ⇒ 宿主放在播放头·也能拖进轨道；「我上传的」底下有「上传程序包（.zip）」。
import { useRef, useState } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { PROGRAM_DRAG_MIME, l10n, optValue, paramValue, type Lang, type ProgramBundle, type ProgramParamSpec, type ProgramParamValue, type StoredProgram } from '../lib/program.pure'

export type ProgramHost = {
  builtins: readonly ProgramBundle[]
  uploaded: readonly StoredProgram[]
  onPick: (id: string) => void
  /** 上传一个 zip：回 null＝成了；字串＝哪里不对 */
  onUpload: (f: File) => Promise<string | null>
  /** 选中的程序片段（bundle 为 null ⇒ 这台没有那个包） */
  selected: { clipId: string; name: string; bundle: ProgramBundle | null; params: Record<string, unknown>; locked: boolean } | null
  /** 改参数：commit＝进复原栈（拉滑杆中途 false·放手 true） */
  onParam: (spec: ProgramParamSpec, v: ProgramParamValue, commit: boolean) => void
}

function ParamRow({ spec, value, lang, disabled, onParam }: { spec: ProgramParamSpec; value: ProgramParamValue; lang: Lang; disabled: boolean; onParam: ProgramHost['onParam'] }) {
  const [draft, setDraft] = useState<string | null>(null)
  const label = l10n(spec.label, lang)
  const common = { disabled, 'data-testid': 'vedit-prog-param', 'data-key': spec.key, 'aria-label': label }
  let input
  if (spec.type === 'text') {
    input = <input type="text" {...common} value={draft ?? String(value)} onChange={(e) => { setDraft(e.target.value); onParam(spec, e.target.value, false) }}
      onBlur={(e) => { setDraft(null); onParam(spec, e.target.value, true) }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="flex-1 min-w-0 h-7 px-2 rounded bg-neutral-900 border border-neutral-700 text-xs text-neutral-100" />
  } else if (spec.type === 'number') {
    const v = Number(value)
    input = <>
      <input type="range" {...common} min={spec.min ?? 0} max={spec.max ?? 100} step={spec.step ?? 1} value={v}
        onChange={(e) => onParam(spec, Number(e.target.value), false)}
        onPointerUp={(e) => onParam(spec, Number((e.target as HTMLInputElement).value), true)}
        onKeyUp={(e) => onParam(spec, Number((e.target as HTMLInputElement).value), true)} className="flex-1 min-w-0 accent-cyan-500" />
      <span className="w-10 text-right text-[11px] tabular-nums text-neutral-300">{Number.isInteger(v) ? v : v.toFixed(2)}</span>
    </>
  } else if (spec.type === 'color') {
    input = <input type="color" {...common} value={String(value)} onChange={(e) => onParam(spec, e.target.value, false)} onBlur={(e) => onParam(spec, e.target.value, true)}
      className="w-10 h-7 rounded bg-transparent border border-neutral-700" />
  } else if (spec.type === 'select') {
    input = <select {...common} value={String(value)} onChange={(e) => onParam(spec, e.target.value, true)} className="flex-1 min-w-0 h-7 px-1 rounded bg-neutral-900 border border-neutral-700 text-xs text-neutral-100">
      {spec.options.map((o) => <option key={optValue(o)} value={optValue(o)}>{typeof o === 'string' ? o : l10n(o.label, lang)}</option>)}
    </select>
  } else {
    input = <input type="checkbox" {...common} checked={value === true} onChange={(e) => onParam(spec, e.target.checked, true)} className="w-4 h-4 accent-cyan-500" />
  }
  return (
    <label className="flex items-center gap-2 py-1">
      <span className="w-14 shrink-0 text-[11px] text-neutral-400 truncate" title={label}>{label}</span>
      {input}
    </label>
  )
}

export default function VeditProgramPane({ host, mine }: { host: ProgramHost; mine: boolean }) {
  const t = useStudioT()
  const language = useStudioLang()
  const lang = language as Lang
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const sel = host.selected
  const cards: Array<{ id: string; name: string; version: string; builtin: boolean }> = mine
    ? host.uploaded.map((u) => ({ id: u.id, name: l10n(u.name, lang), version: u.version, builtin: false }))
    : host.builtins.map((b) => ({ id: b.id, name: l10n(b.manifest.name, lang), version: b.manifest.version, builtin: true }))
  const upload = async (f: File | undefined) => {
    if (!f) return
    setBusy(true); setMsg(null)
    const err = await host.onUpload(f)
    setBusy(false)
    setMsg(err ? { ok: false, text: t('vedit_prog_upload_fail').replace('{err}', err) } : { ok: true, text: t('vedit_prog_upload_ok').replace('{name}', f.name) })
  }
  return (
    <>
      {sel && (
        /* 选中的程序片段：参数面板（照 manifest 自动长·人改字改色拖滑杆·不碰程序） */
        <div className="px-2 py-1.5 rounded-md bg-neutral-800/80" data-testid="vedit-prog-panel" data-clip-id={sel.clipId}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] text-neutral-400 shrink-0">{t('vedit_prog_sel')}</span>
            <span className="text-xs text-neutral-200 truncate min-w-0">{sel.name}</span>
          </div>
          {!sel.bundle ? (
            <div className="text-[11px] text-amber-300" data-testid="vedit-prog-missing">{t('vedit_prog_missing')}</div>
          ) : sel.bundle.manifest.params.length === 0 ? (
            <div className="text-[11px] text-neutral-500">{t('vedit_prog_params_none')}</div>
          ) : sel.bundle.manifest.params.map((s) => (
            <ParamRow key={`${sel.clipId}:${s.key}`} spec={s} value={paramValue(s, sel.params[s.key])} lang={lang} disabled={sel.locked} onParam={host.onParam} />
          ))}
        </div>
      )}
      <div className="text-[11px] text-neutral-500 -mt-1">{t('vedit_prog_hint')}</div>
      {mine && (
        <div className="flex flex-col gap-1">
          <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" data-testid="vedit-prog-upload-input"
            onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="vedit-prog-upload"
            className="self-start h-7 px-2.5 rounded-md bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-xs text-white">{busy ? t('vedit_prog_uploading') : t('vedit_prog_upload')}</button>
          <div className="text-[11px] text-neutral-500">{t('vedit_prog_upload_hint')}</div>
          {msg && <div className={`text-[11px] ${msg.ok ? 'text-emerald-400' : 'text-amber-300'}`} data-testid="vedit-prog-upload-msg">{msg.text}</div>}
        </div>
      )}
      {cards.length === 0 ? (
        <div className="flex-1 min-h-16 flex items-center justify-center text-xs text-neutral-500" data-testid="vedit-prog-empty">{t('vedit_prog_empty_mine')}</div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }} data-testid="vedit-prog-grid">
          {cards.map((c) => (
            <button key={c.id} type="button" data-testid="vedit-prog-item" data-prog-id={c.id} draggable
              onDragStart={(e) => { e.dataTransfer.setData(PROGRAM_DRAG_MIME, c.id); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => host.onPick(c.id)} title={c.name}
              className="aspect-[4/3] rounded-md bg-neutral-800 hover:bg-neutral-700 flex flex-col items-center justify-center gap-1 px-1.5 cursor-grab text-center">
              <span className="text-lg text-cyan-300" aria-hidden>{'</>'}</span>
              <span className="text-[11px] text-neutral-200 leading-tight line-clamp-2">{c.name}</span>
              <span className="text-[10px] text-neutral-500">{t('vedit_prog_version').replace('{v}', c.version)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
