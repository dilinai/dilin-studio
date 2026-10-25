// 弹窗（ConfirmDialog.tsx、DialogHost.tsx）用的取字：网站那两档原本取网站字典，这里换成同样的几句三语，语言跟编辑器同一个偏好。
import { resolveStudioLang } from '../studio/shared/i18n'
import type { StudioLang } from '../studio/shared/types'

const DICT: Record<StudioLang, Record<string, string>> = {
  'zh-TW': { cancel: '取消', confirm: '確定', delete: '刪除', dlg_confirm_title: '請確認', dlg_alert_title: '提示', dlg_prompt_title: '請輸入', dlg_got_it: '知道了' },
  'zh-CN': { cancel: '取消', confirm: '确定', delete: '删除', dlg_confirm_title: '请确认', dlg_alert_title: '提示', dlg_prompt_title: '请输入', dlg_got_it: '知道了' },
  en: { cancel: 'Cancel', confirm: 'OK', delete: 'Delete', dlg_confirm_title: 'Please confirm', dlg_alert_title: 'Notice', dlg_prompt_title: 'Input', dlg_got_it: 'Got it' },
}

export function useT(): (key: string) => string {
  const lang = resolveStudioLang()
  return key => DICT[lang][key] ?? DICT.en[key] ?? key
}
