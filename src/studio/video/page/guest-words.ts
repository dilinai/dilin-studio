// 游客版换字：登入版那几句讲「雲端硬碟」的，游客版换成讲这台电脑的（资料不上云）。其余字照登入版。
import type { StudioT } from '../../shared/types'

export const GUEST_WORDS: Readonly<Record<string, string>> = { vedit_proj_saved: 'vedit_guest_saved', vedit_media_empty: 'vedit_guest_media_empty' }
export const guestWords = (t: StudioT, table: Readonly<Record<string, string>> = GUEST_WORDS): StudioT => (k, v) => t(table[k] ?? k, v)
