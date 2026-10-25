// 单机版本机 MCP 交到剪辑页的活（video_list_commands／video_run）：在页面现况上跑命令表（同网站 video_edit_run 那支 applyCommandsState）。
//   list ⇒ 命令清单（filter 比对 id 与说明）；run ⇒ 一批全有或全无：成了回新轨道（与改了的比例）让页面当「角色那批」入账（一步复原·⛔ 过主轨磁吸·照常自动存）。
//   要网站后端的（配音 media.tts、网页截图 media.webShot、音效 sfx.add）与动到素材清单的（加／删素材）这里不做：照实说、什么都不动。
//   纯函数（题直接跑）·⛔ 碰 DOM。
import { applyCommandsState, listCommands, type CmdState, type CommandStep } from './commands.pure'
import type { RatioSel } from './ratio.pure'
import type { Tracks } from './timeline.pure'

export type VideoAgentReply = { ok: true; result: unknown } | { ok: false; error: string; message?: string }
export type VideoAgentOut = { reply: VideoAgentReply; next?: { tracks: Tracks; ratio: RatioSel | null } }

/** 要网站后端才做得了的步骤 */
export const WEBSITE_ONLY = new Set(['media.tts', 'media.webShot', 'sfx.add'])

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function videoAgentJob(job: { kind?: unknown; filter?: unknown; steps?: unknown }, state: CmdState, newId: () => string): VideoAgentOut {
  if (job.kind === 'list') {
    const f = typeof job.filter === 'string' ? job.filter.trim().toLowerCase() : ''
    const all = listCommands()
    return { reply: { ok: true, result: f ? all.filter((c) => c.id.toLowerCase().includes(f) || c.description.toLowerCase().includes(f) || c.params.some((p) => p.name.toLowerCase().includes(f))) : all } }
  }
  if (job.kind !== 'run') return { reply: { ok: false, error: 'bad_job', message: `unknown kind ${String(job.kind)}` } }
  const steps = (Array.isArray(job.steps) ? job.steps : []) as CommandStep[]
  const web = steps.findIndex((s) => s && WEBSITE_ONLY.has(String(s.command).trim()))
  if (web >= 0) return { reply: { ok: false, error: 'not_available', message: `Step ${web} (${steps[web].command}) needs the website (voice-overs, web screenshots and sound effects are made there). Nothing was applied. Make it on the website, or import a file in the editor and use media.list.` } }
  const r = applyCommandsState(state, steps, { newId })
  if (!r.ok) {
    const where = r.step >= 0 ? `Step ${r.step}${r.command ? ` (${r.command})` : ''} failed: ` : ''
    return { reply: { ok: false, error: 'command_failed', message: `${where}${r.error}\nNothing was applied (all steps apply together or not at all). Fix that step and send the batch again.` } }
  }
  if (!same(r.state.media, state.media)) return { reply: { ok: false, error: 'not_available', message: 'Adding or removing media files is not available from here. Nothing was applied. Ask the user to import the file in the editor, then use media.list to get its id.' } }
  const ratio = same(r.state.ratio, state.ratio) ? null : r.state.ratio
  const changed = !same(r.state.tracks, state.tracks) || !!ratio
  return { reply: { ok: true, result: { ok: true, changed, results: r.results } }, ...(changed ? { next: { tracks: r.state.tracks, ratio } } : {}) }
}
