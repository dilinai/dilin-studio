'use client'
// 占位编辑器：五个编辑器的 <app>/index.ts 还没交之前，registry 先指到这里。
//   画面：「这个编辑器还在做」＋ project.json 现在的内容（唯读·外面改了 Shell 会重挂它，所以会跟着变）。
//   格式：只有表头＋name（version 1）。

import { useEffect, useState } from 'react'
import type { EditorProps, StudioApp, StudioAppId } from '../types'
import { useStudioT } from '../StudioT'
import { readProjectJson, writeProjectJson } from '../project-file'

export type PlaceholderDoc = { name?: string } & Record<string, unknown>
const VERSION = 1

function PlaceholderEditor({ store, onSaveStateChange }: EditorProps) {
  const t = useStudioT()
  const [text, setText] = useState<string>('')
  const [err, setErr] = useState<string>('')
  useEffect(() => {
    let alive = true
    store.readJSON().then(j => { if (alive) setText(JSON.stringify(j, null, 2)) }, e => { if (alive) setErr(String((e as Error)?.message || e)) })
    onSaveStateChange?.('saved')
    return () => { alive = false }
  }, [store, onSaveStateChange])
  return (
    <div className="h-full overflow-auto p-6" data-testid="studio-placeholder">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-bold text-gray-800">{t('studio_placeholder_title')}</h2>
        <p className="mt-2 text-sm text-gray-500">{t('studio_placeholder_body')}</p>
        {err ? <p className="mt-4 text-sm text-red-600">{err}</p> : (
          <pre className="mt-4 p-4 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-700 whitespace-pre-wrap break-all" data-testid="studio-placeholder-json">{text}</pre>
        )}
      </div>
    </div>
  )
}

export function makePlaceholderApp(app: StudioAppId): StudioApp<PlaceholderDoc> {
  return {
    app,
    Editor: PlaceholderEditor,
    format: {
      version: VERSION,
      emptyProject: () => ({}),
      async load(store) {
        const j = await readProjectJson(store, app, VERSION)
        if (!j) return {}
        const { format: _f, version: _v, ...rest } = j
        void _f; void _v
        return rest
      },
      save: (store, doc) => writeProjectJson(store, app, VERSION, doc),
      summaryForAI: (lang) => lang === 'en'
        ? `project.json format: {"format": "dilin-studio/${app}", "version": 1, "name": "<project name>"} (this editor is still being built; only "name" is used for now).`
        : lang === 'zh-CN'
          ? `project.json 格式：{"format": "dilin-studio/${app}", "version": 1, "name": "<工程名>"}（这个编辑器还在做，现在只用到 name）。`
          : `project.json 格式：{"format": "dilin-studio/${app}", "version": 1, "name": "<工程名>"}（這個編輯器還在做，現在只用到 name）。`,
    },
    i18n: { 'zh-TW': {}, 'zh-CN': {}, en: {} },
  }
}
