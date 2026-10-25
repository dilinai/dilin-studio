// Dilin Studio · Paint — this editor's own UI strings (the shell's shared strings are not repeated here).
import type { StudioDict } from '../shared/types'
import { PAINT_PAGE_I18N } from './page/i18n'

export type PaintKey = 'paint_title' | 'paint_loading' | 'paint_load_failed' | 'paint_missing' | 'paint_engine_failed' | 'paint_save_cmd' | 'paint_external_hold' | 'paint_multipage' | 'paint_export_psd' | 'paint_export_ai' | 'paint_save_psd' | 'paint_save_psd_hint'

const SESSION_I18N: StudioDict<PaintKey> = {
  'zh-TW': {
    paint_title: '畫板',
    paint_loading: '畫板載入中…',
    paint_load_failed: '工程打不開：{reason}',
    paint_missing: '找不到這些素材檔，相關圖層先空著：{files}',
    paint_engine_failed: '畫板沒有啟動，請重新整理網頁。',
    paint_save_cmd: '存進工程資料夾（project.json＋assets/）',
    paint_export_psd: '附上分層 PSD（project.psd，Photoshop 打得開每一層）',
    paint_export_ai: '附上分層 Illustrator 檔（project.ai，圖層、形狀可接著改，文字是可改的點文字，中文繁簡都能讀）',
    paint_save_psd: '存成 Photoshop／Illustrator 分層檔（.psd、.ai）',
    paint_save_psd_hint: '用 Photoshop 打開 project.psd、用 Illustrator 打開 project.ai，每個圖層都在。',
    paint_multipage: '此檔有 {n} 頁，這裡只能編輯第 1 頁，存檔會只留第 1 頁。自動存已停；要存請按 Ctrl+S。',
    paint_external_hold: '外面改過 project.json，自動存先停下，免得蓋掉；在上方選「重新載入」，或按 Ctrl+S 用這裡的版本蓋過去。',
  },
  'zh-CN': {
    paint_title: '画板',
    paint_loading: '画板载入中…',
    paint_load_failed: '工程打不开：{reason}',
    paint_missing: '找不到这些素材文件，相关图层先空着：{files}',
    paint_engine_failed: '画板没有启动，请重新整理网页。',
    paint_save_cmd: '存进工程文件夹（project.json＋assets/）',
    paint_export_psd: '附上分层 PSD（project.psd，Photoshop 打得开每一层）',
    paint_export_ai: '附上分层 Illustrator 档（project.ai，图层、形状可接着改，文字是可改的点文字，中文繁简都能读）',
    paint_save_psd: '存成 Photoshop／Illustrator 分层档（.psd、.ai）',
    paint_save_psd_hint: '用 Photoshop 打开 project.psd、用 Illustrator 打开 project.ai，每个图层都在。',
    paint_multipage: '此档有 {n} 页，这里只能编辑第 1 页，存档会只留第 1 页。自动存已停；要存请按 Ctrl+S。',
    paint_external_hold: '外面改过 project.json，自动存先停下，免得盖掉；在上方选「重新加载」，或按 Ctrl+S 用这里的版本盖过去。',
  },
  en: {
    paint_title: 'Paint',
    paint_loading: 'Loading Paint…',
    paint_load_failed: 'Could not open the project: {reason}',
    paint_missing: 'These asset files are missing, so their layers are empty: {files}',
    paint_engine_failed: 'The editor did not start. Please reload the page.',
    paint_save_cmd: 'save to the project folder (project.json + assets/)',
    paint_export_psd: 'Add a layered PSD (project.psd, every layer opens in Photoshop)',
    paint_export_ai: 'Add a layered Illustrator file (project.ai: layers and shapes stay editable, text comes in as editable point text, Chinese in traditional and simplified characters reads correctly)',
    paint_save_psd: 'Save as layered Photoshop / Illustrator files (.psd, .ai)',
    paint_save_psd_hint: 'Open project.psd in Photoshop or project.ai in Illustrator: every layer is there.',
    paint_multipage: 'This file has {n} pages. Only page 1 can be edited here, and saving keeps page 1 only. Autosave is off; press Ctrl+S to save.',
    paint_external_hold: 'project.json was changed outside, so autosave is paused to avoid overwriting it. Choose "Reload" above, or press Ctrl+S to save this version over it.',
  },
}

/** 本编辑器全部字串：工程会话那几句＋整页（page/i18n.ts）那一组 */
export const PAINT_I18N: StudioDict = {
  'zh-TW': { ...SESSION_I18N['zh-TW'], ...PAINT_PAGE_I18N['zh-TW'] },
  'zh-CN': { ...SESSION_I18N['zh-CN'], ...PAINT_PAGE_I18N['zh-CN'] },
  en: { ...SESSION_I18N.en, ...PAINT_PAGE_I18N.en },
}
