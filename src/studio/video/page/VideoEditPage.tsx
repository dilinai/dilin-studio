'use client'
// ═══════════════════════════════════════════════════════════════════════════════════════════
// 剪辑编辑器整页（登入版 /video-edit 与游客版 /studio/video/<编号> 共用这一份）。
// 版面：顶栏 ／ 上排三格（左素材区：素材｜文本｜特效｜转场｜字幕…｜编曲｜技能；中预览播放器；右「AI｜人工」那一格）／ 底整排多轨（工具列＋时间尺＋各轨）。
//   素材｜播放器｜右格之间两条竖拉条·上排与轨道之间一条横拉条·尺寸存这个浏览器（lib/layout.pure.ts）。
//   素材页＝左窄栏（匯入｜雲端硬碟·点整格展开／收起·「雲端硬碟」那格的内容由宿主给）＋拖拉条＋右素材格（没素材＝大「匯入」·有素材＝左上小「＋ 匯入」）。
// 轨道可变多条：一开始只有一条主轨；拖素材下来先在「即将占位」处画灰底；落点被占 ⇒ 画面往上新增一条轨·音频往下新增；空了的非主轨自动收掉；
//   轨道头＝种类小图示＋锁＋眼睛＋喇叭；预览照轨道状态（隐藏的不画不出声·静音的不出声·上面的画面轨盖下面的）。算法在 lib/timeline.pure.ts。
// 素材原档存哪、工程存哪、云盘、角色对话、终端、朗读、别台导出：一律经宿主（page/host.ts）。
//   登入版宿主＝网站接线（工程档存云盘、边剪边自动存、角色改档即时看到）；游客版宿主＝工程资料夹（project.json＋assets/），要后端的几组给 null、不画那几颗钮。
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { registerDesktopBeforeClose } from '../../shared/desktop-before-close'
import { resolveMediaDuration } from '../lib/media-duration'
import { pauseWhenHidden } from '../lib/background-pause'
import VeditProjectGroupNotice from '../ui/ProjectGroupNotice'
import VeditDeviceGate, { useRenderVerdict } from '../ui/DeviceGate'
import { takeProjectGroupNotice, type ProjectGroupNotice, type ProjectGroupNoticeSeen } from '../lib/project-group-notice.pure'
import { VEDIT_LAYOUT_DEFAULT, VEDIT_LAYOUT_KEY, clampLayout, dragLayout, parseLayout, type VeditLayout, type VeditSplit } from '../lib/layout.pure'
import * as T from '../lib/timeline.pure'
import { VEDIT_MEDIA_KEY, parseStoredMedia, storableMedia } from '../lib/store.pure'
import { blobUnreadable, makePeaks, makeProxy, probeSound, readProxy } from '../lib/opfs-cache'
import { SOUND_NOTICE_MS, firstSoundWarn, soundUndecodable } from '../lib/sound-check.pure'
import { SHELL_PROXY_INFLIGHT, cloudProxyOf, needOriginalDownload, proxyDevice, proxyRoute, slotGate, type CloudProxy } from '../lib/cloud-proxy.pure'
import { reusableMix } from '../lib/arrange-media.pure'
import { VEDIT_SETTINGS_KEY, isDriveBusy, isDriveFull, parseSettings, shouldAutoUpload, uploadFrac, type VeditSettings } from '../lib/upload.pure'
import { codecLabel, hasPicture, showNoPicture } from '../lib/codec.pure'
import { MEDIA_ACCEPT_EXTS, mediaKindOf } from '../lib/media-kind.pure'
import { ASSET_TABS, ASSET_TAB_SPEC, isAssetTab, type AssetTab } from '../lib/asset-tabs.pure'
import VeditAssetPane, { AssetTabIcon, BGFX_LABEL, SHAPE_LABEL } from '../ui/AssetTabs'
import VeditBgfxPanel from '../ui/BgfxPanel' // 动态背景属性
import VeditFancyText from '../ui/FancyText'
import VeditFilmstrip from '../ui/Filmstrip'
import VeditArrangePane, { type ArrCloud } from '../ui/Arrange'
import { arrLang, encodeWav } from '../lib/arrange.pure'
import { floatClones, type DragFloat } from '../ui/drag-float'
import VeditFilterCanvas from '../ui/FilterCanvas'
import VeditProgramFrame from '../ui/ProgramFrame'
import VeditScrubBar from '../ui/ScrubBar'
import VeditFxCanvas, { type FxOther } from '../ui/FxCanvas'
import VeditVectorCanvas from '../ui/VectorCanvas'
import { SHAPE_DEFAULT_SECONDS, SHAPE_KINDS, VECTOR_DRAG_MIME, addBackgroundAt, addVectorAt, isBackgroundClip, newBgfxClip, newShapeClip, newSolidClip, patchBgfx, type ShapeKind } from '../lib/shape.pure'
import { BGFX_KINDS, bgfxSeed, type BgfxKind } from '../lib/bgfx.pure' // 动态背景（星空粒子／光斑漂移）
/** 拖来的形状／纯色卡值（shape:<种类>／solid:#rrggbb）⇒ 新片段；认不得 ⇒ null */
const vectorClipOf = (v: string): T.TlClip | null => {
  const [k, x] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)]
  if (k === 'shape' && SHAPE_KINDS.includes(x as ShapeKind)) return newShapeClip(crypto.randomUUID(), x as ShapeKind)
  if (k === 'solid' && /^#[0-9a-f]{6}$/i.test(x)) return newSolidClip(crypto.randomUUID(), x)
  if (k === 'bgfx' && BGFX_KINDS.includes(x as BgfxKind)) return newBgfxClip(crypto.randomUUID(), x as BgfxKind, bgfxSeed(Math.random()))
  return null
}
import VeditAsrPane, { AsrSpinner, type AsrPhase, type CloudAsrPhase } from '../ui/AsrPane'
import { AsrEngine, convertTexts, hasWebGpu, mixTimelineAudio } from '../ui/asr-client'
import { ShellJobError, shellErrText, type ShellPhase } from '../lib/shell-job'
import { parseAsrResult, shellAsrLang, type MediaDevice } from '../lib/shell-media.pure'
import ClipStemsPanel, { useClipStems } from '../ui/ClipStems'
import { useSongStems } from '../ui/song-stems'
import { computeSwitchText } from '../lib/compute-failover.pure'
import { ASR_MAX_SEC, ASR_SAMPLE_RATE, asrAvailability, asrBlocks, asrRunOpts, asrSources, asrSpan, chunksToCues, type AsrLang, type AsrScope } from '../lib/asr.pure'
import type { FxHost } from '../ui/FxPane'
import { FX_DRAG_MIME, TRANS_DRAG_MIME, addEffect, decoratable, fxById, fxName, fxStateAt, laneSeams, removeEffect, removeTransition, seamFor, seamNear, setEffectStrength, setTransLength, setTransition, transLimit, type FxLang } from '../lib/fx.pure'
import type { ProgramHost } from '../ui/ProgramPane'
import { embeddedProgramNewer, PROGRAM_DRAG_MIME, addProgramAt, effectiveParams, l10n, newProgramClip, programTime, setProgramParam, type Lang as ProgLang, type ProgramBundle, type ProgramParamSpec, type ProgramParamValue, type StoredProgram } from '../lib/program.pure'
import { BUILTIN_PROGRAMS, builtinProgram } from '../lib/programs.data'
import { listUploadedPrograms, loadUploadedProgram, saveUploadedProgram, unpackProgramZip } from '../lib/program-store'
import { parseManifest } from '../lib/program.pure'
import { VEDIT_LIVE_POLL_MS, VEDIT_NAME_MAX, VEDIT_PROGRAMS_EMBED_MAX, VEDIT_PROJECT_EXT, VEDIT_SAVE_DEBOUNCE_MS, buildProject, projectTitle, type ProjectMedia, type ProjectProgram, type VeditProject } from '../lib/project.pure'
import { DRAFT_IDLE, coverPick, draftCreateName, draftFailKind, draftNext, draftRetryMs, draftTouched, renameVerdict, type DraftFail, type DraftPhase, type DraftSnap, type DraftState } from '../lib/draft.pure'
import VeditRemoteAskDialog from '../ui/RemoteAskDialog'
import { mergeProjects, remoteAction } from '../lib/remote.pure'
import { videoAgentJob } from '../lib/agent-job.pure'
import { startAgentLink, type AgentJob, type AgentReply } from '../../shared/agent-link'
import { isStandalone } from '../../shared/host'
import * as PC from '../lib/page-cmd.pure' // 命令化第二期：人手动作派发命令表（同角色 video_edit_run 那支套用函数）
import type { CmdState, CommandStep, StepResult } from '../lib/commands.pure'
import { createGestureGuard, type GestureGuard } from '../lib/gesture.pure'
import { makeCover } from '../ui/cover'
import { FAV_PREF_KEY, FILTER_DEFAULT_SECONDS, FILTER_DRAG_MIME, addFilterAt, filterById, filterOverLayer, filterThumb, newFilterClip, parseFavs, setFilterStrength, toggleFav, type FavKind } from '../lib/filter.pure'
import { STICKER_DRAG_MIME, STICKER_DEFAULT_SECONDS, addStickerAt, moveSticker, newStickerClip, resizeSticker, stickerBox, stickerById, stickerSrc, stickerPose, stickerPoseCss, stickerSizeFromDrag } from '../lib/sticker.pure'
import { SUBTITLE_MAX_BYTES, TEXT_DEFAULT_SECONDS, TEXT_DRAG_MIME, TEXT_DRAG_PLAIN, type SubtitleCue, addDefaultText, addSubtitles, applyFancy, fillCueGaps, decodeSubtitleBytes, editableTextIds, fancyById, moveText, newTextClip, parseSubtitles, resizeText, setTextContent, sizeFromDrag } from '../lib/text.pure'
import { applyTextPatch, displayText, patchTexts, resolveTextLook, webFontsIn, type TextPatch } from '../lib/text-style.pure'
import { imagesToPreload, preloadTick } from '../lib/image-preload.pure'
import { useImagePreload } from '../ui/image-preload'
import { MEDIA_SORTS, isMediaSort, mediaListView, type MediaSort } from '../lib/media-list.pure'
import { isSafeMode, nextSafeMode, safeRects, type SafeMode } from '../lib/safe-zone.pure'
import { ensureFontsLoaded } from '../../shared/fonts/load'
import { charCount, charCss, charPoses, poseIdle, textAnimPose, visibleChars } from '../lib/text-anim.pure'
import { adjustFilterBody, adjustLayersOver, applyClipPatch, clipAnimPose, clipKfTimes, clipLiveStep, cropClipPath, kfCurrent, lookGrade, shadowCss, fadeGain, frameIn, fitLayerCss, gainAt, lookOf, lookStyle, manualClipState, masksUrl, patchClips, type ClipLive, type ClipPatch, volumeEnvelope, glowCss, borderRing, borderCss, lookXform } from '../lib/clip-look.pure'
import { pinCssMatrix, pinHandlePos, pinMatrix, pinQuad, type ClipPin } from '../lib/corner-pin.pure' // 四角透视
import { bindFollow, boxToHost, followAt, followCssMatrix, followPoint, hostXf, makeMTrack, mergeMTrack, patchMTracks, trackTimes, type TrackBox } from '../lib/motion-track.pure' // 运动跟踪
import { runTrack } from '../ui/track-client'
import { VeditFollowPinPanel, type MTrackHost } from '../ui/MotionTrackPanel'
import VeditWebShotDialog from '../ui/WebShotDialog' // 網頁截圖
import VeditClipInspector, { type PushHost } from '../ui/ClipInspector'
import { PUSH_BOX_MIN, PUSH_DUR_DEFAULT, applyPushBox } from '../lib/push-box.pure' // 推镜头「推到框」
import type { EasePreset } from '../lib/keyframe.pure'
import { MOSAIC_DEFAULT, MOSAIC_ROUND, MOSAIC_STEP, mosaicBlock, mosaicBlur, mosaicsAt, recordMosaic, type Mosaic, type MosaicSample } from '../lib/mosaic.pure'
import { picDragPos, recordKf, shouldSample, type KfSample } from '../lib/kf-record.pure'
import { canGroup, canUngroup, dropStems, mergeBlock, replaceWithMerged, groupClickSelect, groupClips, groupMembers, groupSelection, mixdownName, pruneGroups, subClipName, subClipPlan, ungroupClips } from '../lib/group.pure'
import { renderSubClip } from '../ui/mix'
import VeditExportDialog from '../ui/ExportDialog'
import { canExportVideo, renderVideo, type ExportEnv } from '../ui/export-render'
import { exportSize, matteOpOf } from '../lib/export.pure'
import { blendHost, matteLanesAt } from '../lib/mask-matte.pure' // 轨道遮罩／混合跨文字层
import { matteCssUrl } from '../ui/matte-draw' // 轨道遮罩（同汇出那支）
import { clipsSnapshot, offloadable, offloadPart, type OffloadAct } from '../lib/offload.pure'
import { syncMediaEl } from '../ui/media-sync'
import { SIDE_TABS, VEDIT_SIDE_TAB_KEY, manualTextState, parseSideTab, textLiveStep, type SideTab, type TextLive } from '../lib/manual.pure'
import VeditManualPane from '../ui/ManualPane'
import VeditKfBtn from '../ui/KfBtn'
import VeditBgFill from '../ui/BgFill'
import VeditGradeCanvas from '../ui/GradeCanvas'
/** 这一层有调色／抠像 ⇒ 原元素一出场就藏（调色画布抠好了才露画面·画不出来时它自己放原元素出来）——原先挂上去那一下、换段那一下先露没抠的绿底 */
const GRADE_HIDE = { opacity: 0 } as const
import VeditMotionBlurCanvas from '../ui/MotionBlurCanvas'
import VeditDirBlurCanvas from '../ui/DirBlurCanvas'
import { mblurActive, mblurDirSamples, mblurModeOf } from '../lib/motion-blur.pure'
import { buildAudioFx, warmPitch, type AudioFx } from '../ui/audio-fx'
import { audioFxKey, normGain, type ClipAudio } from '../lib/audio.pure'
import { SFX_RATE, sfxById } from '../lib/sfx-lib.pure'
import { bakeGradeLut, gradeActive, gradeKey } from '../lib/grade.pure'
import { SOLID_COLORS, SOLID_SECONDS, addAdjustLayer, canFreeze, canReverse, copyAttrs, freezeFrame, pasteAttrs, solidFileName, toggleFlip, toggleReverse, type AttrPack } from '../lib/clip-ops.pure'
import { applyKfOp, filterKfStrength, filterStrengthAt, kfOnClip, textBodyAt, textKfCurrent, textKfSplit, type KfOp } from '../lib/text-kf.pure'
import VeditRatioMenu from '../ui/RatioMenu'
import VeditToolbar, { BladeCursorStyle } from '../ui/Toolbar'
import { addMarker, bladeSplit, markersOf, removeMarker, selectSide, trimAt, trimTargets, type EditTool } from '../lib/toolbar.pure'
import { TIMELINE_PREFS_DEFAULT, VEDIT_TIMELINE_PREFS_KEY, magnetDrop, magnetDropPlan, magnetEdit, magnetMove, magnetPack, parseTimelinePrefs, rippleTrim, type TimelinePrefs } from '../lib/magnet.pure'
import { SNAP_LINE_COLOR, STAGE_HELD_NONE, holdSnap, snapThresholds, stageSnap, type SnapHold, type StageBox } from '../lib/snap.pure'
import { VEDIT_RATIO_KEY, fitAspectOf, fitRefMediaId, parseRatio, ratioOf, stageBox, type RatioSel } from '../lib/ratio.pure'
import LicensesDialog from '../LicensesDialog'
import { ImportBad, detectProjectFile, importNoteText, importProject, importedToTracks, matchByName, type ImportApp } from '../lib/import-project.pure'
import { parseProjectIssues } from '../lib/project.pure'
import { VEDIT_FEATURES, type DriveRef, type HostMedia, type ProjGet, type VeditLoadFail, type VideoPageHost } from './host'

/** 界面字典的键（登入版查网站字典、游客版查编辑器字典·两边都有这些键） */
type TKey = string

type MediaKind = 'video' | 'audio' | 'image'
/** url＝播放用（预览档 ＞ 本机原档 ＞ 云盘链接）；from＝从电脑汇入／云盘；remote＝云盘链接；stored＝原档已在本机储存；
 *  proxied＝url 已是预览档；work＝背景正在做的（素材卡上显示）；
 *  noPicture＝<video> 量过这份没画面；codec＝原档画面编码（转预览档时读到的）。 */
type MediaWork = { what: 'store' | 'cache' | 'proxy' | 'upload'; p?: number }
const WORK_KEY = { store: 'vedit_work_store', cache: 'vedit_work_cache', proxy: 'vedit_work_proxy', upload: 'vedit_work_upload' } as const
type Media = { id: string; name: string; kind: MediaKind; url: string; duration: number; /** 工程档里有·这台本机没有、云盘也取不到 ⇒ 缺素材（url 空） */ missing?: boolean; /** 缺素材的原因是读不到它所在的资料夹（服务端没给链接） */ denied?: boolean; driveId?: string; from: 'local' | 'drive'; remote?: string; stored?: boolean; proxied?: boolean; work?: MediaWork; noPicture?: boolean; /** 声音轨这台浏览器解不开（汇入探测或算波形时发现·不写进工程档） */ noSound?: boolean; codec?: string | null; /** 背景上传云盘中（p＝0～1·不挡剪辑） */ up?: { p: number }
  /** 编曲素材：stems＝藏着的分轨（拖上轨道展开成几条·绑一组）·stemOf＝我是哪份的分轨（素材区不列） */ stems?: string[]; stemOf?: string
  /** cloudProxy＝终端转好、存云盘的剪辑用小档／波形／缩图（进工程档·换电脑共用）；
   *  shellPx＝正交给终端转（p 0～1·wait＝等传完云盘再交·⛔ 占 work：转一支长片要很久，不能挡移除）；thumbs＝缩图拼图（本机暂时链接） */
  cloudProxy?: CloudProxy; shellPx?: { p: number; wait?: boolean }; thumbs?: { url: string; every: number; cols: number; n: number } }
/** 素材｜文本｜特效｜转场｜字幕（照剪映排法·后四个在 VeditAssetTabs.tsx）｜技能 */
// 「技能」跟「程式」中间放「编曲」（VeditArrange.tsx）
type TopTab = 'media' | AssetTab | 'arrange' | 'skill'
const MEDIA_SORT_LABEL: Record<MediaSort, TKey> = { added: 'vedit_media_sort_added', name: 'vedit_media_sort_name', duration: 'vedit_media_sort_duration', kind: 'vedit_media_sort_kind' }
const SAFE_MODE_LABEL: Record<SafeMode, TKey> = { off: 'vedit_safe_off', broadcast: 'vedit_safe_broadcast', douyin: 'vedit_safe_douyin' }
const SAFE_LABEL: Record<string, TKey> = { action: 'vedit_safe_action', title: 'vedit_safe_title', content: 'vedit_safe_content' }
const TOP_TABS: readonly TopTab[] = ['media', ...ASSET_TABS, 'arrange', 'skill']
/** 按在轨道片段上（本体／左右拉边／音量线）——那几只都 preventDefault 挡掉了换焦点 ⇒ 焦点若还在对话框就放掉
 *  （不然接着按 Alt+A 被当成在打字·小卡插不进去；框里光标已记着）。片段正中间是音量线·漏了它点中间就插不进。 */
function releaseTypingFocus() {
  const ae = document.activeElement as HTMLElement | null
  if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) ae.blur()
}
const IMAGE_SECONDS = T.IMAGE_DEFAULT_SECONDS
/** 宿主没有终端那条（游客版）时顶替那两只 hook 的：什么都不读 */
const noLocalDevice = (): string | null => null
const noMediaDevices = (_active: boolean): MediaDevice[] | null => null
/** 宿主读回的原档可能只是 Blob ⇒ 换成带档名的 File（转预览档、汇出要档名） */
const asFile = (b: Blob | null, name: string): File | null => (!b ? null : b instanceof File ? b : new File([b], name, { type: b.type }))
/** 背景上传失败抛的错（status／code／reason：云盘满了由 isDriveFull 判） */
type DriveUploadError = Error & { status?: number; code?: string; reason?: string }
/** 轨道左边那栏（轨道头：种类图示＋锁／眼睛／喇叭）多宽：时间尺与片段都从它右边起算 */
const LABEL_W = 124
const DRAG_MIME = 'application/x-dilin-vedit-media'
/** 云盘影片还没读过长度时·灰底先画多长（放手后照真长度放） */
const GHOST_GUESS_SECONDS = 5
const LANE_NAME = { visual: 'vedit_lane_visual', audio: 'vedit_lane_audio', text: 'vedit_lane_text', sticker: 'vedit_lane_sticker', filter: 'vedit_lane_filter', program: 'vedit_lane_program' } as const
const uid = () => crypto.randomUUID()
/** 右键选单各项的字；静音／停用已经全是 ⇒ 换成「取消静音」「启用这段」 */
const MENU_LABEL: Record<T.MenuAct, TKey> = {
  copy: 'vedit_menu_copy', cut: 'vedit_menu_cut', paste: 'vedit_menu_paste', delete: 'vedit_tool_delete', duplicate: 'vedit_menu_duplicate',
  split: 'vedit_tool_split', detach: 'vedit_menu_detach', mute: 'vedit_menu_mute', disable: 'vedit_menu_disable', replace: 'vedit_menu_replace',
  find: 'vedit_menu_find', 'add-chat': 'vedit_menu_add_chat', group: 'vedit_menu_group', ungroup: 'vedit_menu_ungroup', subclip: 'vedit_menu_subclip', merge: 'vedit_menu_merge',
  freeze: 'vedit_tool_freeze', reverse: 'vedit_tool_reverse', mirror: 'vedit_tool_mirror', 'copy-attr': 'vedit_menu_copy_attr', 'paste-attr': 'vedit_menu_paste_attr',
  stems: 'vedit_menu_stems',
}
const MENU_LABEL_ON: Partial<Record<T.MenuAct, TKey>> = { mute: 'vedit_menu_unmute', disable: 'vedit_menu_enable', reverse: 'vedit_menu_unreverse' }

/** 轨道头小图示 */
function LaneIcon({ name }: { name: 'visual' | 'audio' | 'text' | 'sticker' | 'filter' | 'program' | 'lock' | 'unlock' | 'eye' | 'eye-off' | 'vol' | 'vol-off' }) {
  const p = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'w-3.5 h-3.5', 'aria-hidden': true }
  switch (name) {
    case 'visual': return <svg {...p}><rect x="2.5" y="4" width="15" height="12" rx="1.5" /><path d="M6 4v12M14 4v12M2.5 8h3.5M2.5 12h3.5M14 8h3.5M14 12h3.5" /></svg>
    case 'audio': return <svg {...p}><path d="M8 15V4.5l8-1.5v10" /><circle cx="6" cy="15" r="2" /><circle cx="14" cy="13" r="2" /></svg>
    case 'text': return <svg {...p}><path d="M4 5h12M10 5v11M7.5 16h5" /></svg>
    case 'filter': return <svg {...p}><circle cx="7.5" cy="8" r="4.5" /><circle cx="12.5" cy="8" r="4.5" /><circle cx="10" cy="12.5" r="4.5" /></svg>
    case 'program': return <svg {...p}><path d="m7 6-4 4 4 4M13 6l4 4-4 4M11 4 9 16" /></svg>
    case 'sticker': return <svg {...p}><path d="M16.5 10.5V5A1.5 1.5 0 0 0 15 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h5.5l6-6Z" /><path d="M10.5 16.5v-4.5a1.5 1.5 0 0 1 1.5-1.5h4.5" /></svg>
    case 'lock': return <svg {...p}><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>
    case 'unlock': return <svg {...p}><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 5.8-1" /></svg>
    case 'eye': return <svg {...p}><path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z" /><circle cx="10" cy="10" r="2.5" /></svg>
    case 'eye-off': return <svg {...p}><path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z" /><path d="M3 17 17 3" /></svg>
    case 'vol': return <svg {...p}><path d="M3 8v4h3l4 3.5v-11L6 8H3Z" /><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10" /></svg>
    case 'vol-off': return <svg {...p}><path d="M3 8v4h3l4 3.5v-11L6 8H3Z" /><path d="m13 8 4 4M17 8l-4 4" /></svg>
  }
}
/** 轨道头的开关钮（按下不抢焦点·开着＝亮青色） */
function LaneBtn({ on, label, testid, onClick, children }: { on: boolean; label: string; testid: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={on} data-testid={testid} onClick={onClick} onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()}
      className={`h-5 w-5 flex items-center justify-center rounded hover:bg-neutral-700 ${on ? 'text-cyan-400' : 'text-neutral-500 hover:text-neutral-200'}`}>
      {children}
    </button>
  )
}

/** File.type 不是影音图片类型（空字串、application/octet-stream…）⇒ 按副档名（lib/media-kind.pure.ts） */
function kindOf(file: File): MediaKind | null {
  return mediaKindOf(file)
}

function fmtTime(s: number): string {
  const t = Math.max(0, s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = Math.floor(t % 60)
  const f = Math.floor((t % 1) * 30)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`
}

/** 读影音长度（读不到 ⇒ 5 秒占位）＋影片这个浏览器放不放得出画面。
 *  （大工程远端更新没载入）：量不出来也不回（网路卡住）原本会一直等 ⇒ 开档／换上远端版那一步卡住、之后问版本一直让开·再也载不进来；
 *  ⇒ 最多等 PROBE_TIMEOUT_MS·逾时回 0（＝还没量·下次开档再量·⛔ 写成 5 秒存进档）。 */
const PROBE_TIMEOUT_MS = 12_000
/** 云盘素材只在请求带 Origin 时才回许可头、也才带 Vary: Origin。
 *  页上若有一处不带跨源载同一网址（素材卡缩图、量长度…）⇒ 浏览器把没许可头的那份快取起来 ⇒ 时间轴原元素（跨源·抠像／调色要读像素）拿到它被挡 ⇒ 载不出来、抠不了。
 *  ⇒ 剪辑页凡载素材网址的影音图元素一律跨源模式（blob:／data: 不受影响）。题：_lib/vedit-media-cors.test.ts＋vedit-media-cors.chromium.mjs */
const MEDIA_CORS = 'anonymous' as const
function probeMedia(url: string, kind: MediaKind): Promise<{ duration: number; noPicture: boolean }> {
  if (kind === 'image') return Promise.resolve({ duration: IMAGE_SECONDS, noPicture: false })
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio')
    let done = false
    const finish = (v: { duration: number; noPicture: boolean }) => { if (done) return; done = true; window.clearTimeout(timer); resolve(v) }
    const timer = window.setTimeout(() => { finish({ duration: 0, noPicture: false }); el.removeAttribute('src'); el.load() }, PROBE_TIMEOUT_MS)
    el.preload = 'metadata'
    // 录音／录屏的 WebM 档头没时长（Infinity）⇒ resolveMediaDuration 拨远逼出真时长·逼不出才退回 5
    el.onloadedmetadata = () => {
      const noPicture = !hasPicture(kind, el instanceof HTMLVideoElement ? el.videoWidth : 0)
      void resolveMediaDuration(el).then((d) => finish({ duration: d ?? 5, noPicture }))
    }
    el.onerror = () => finish({ duration: 5, noPicture: false }) // 整个读不开（断网／过期链接）不算「没画面」
    el.crossOrigin = MEDIA_CORS
    el.src = url
  })
}

/** 读画面宽高比（「比例」选「适应（原始）」用）；读不到／没画面 ⇒ null */
function probeAspect(url: string, kind: MediaKind): Promise<number | null> {
  if (kind === 'audio') return Promise.resolve(null)
  return new Promise((resolve) => {
    if (kind === 'image') {
      const im = new Image()
      im.onload = () => resolve(im.naturalWidth > 0 && im.naturalHeight > 0 ? im.naturalWidth / im.naturalHeight : null)
      im.onerror = () => resolve(null)
      im.crossOrigin = MEDIA_CORS
      im.src = url
      return
    }
    const el = document.createElement('video')
    el.crossOrigin = MEDIA_CORS
    el.preload = 'metadata'
    el.onloadedmetadata = () => resolve(el.videoWidth > 0 && el.videoHeight > 0 ? el.videoWidth / el.videoHeight : null)
    el.onerror = () => resolve(null)
    el.src = url
  })
}

/** 片段里的声音波形：素材峰值表取片段那一段·一根根画（按分贝画·高度跟着这段的音量走·最高顶满）；
 *  播放时整条时间轴每帧重画 ⇒ memo 住·参数没变就跳过 */
const ClipWave = memo(function ClipWave({ peaks, offset, length, widthPx, gain, fadeIn = 0, fadeOut = 0 }: { peaks: Float32Array | undefined; offset: number; length: number; widthPx: number; gain: number; fadeIn?: number; fadeOut?: number }) {
  const bars = Math.max(1, Math.min(1200, Math.floor(widthPx / 3)))
  const w = T.peaksWindow(peaks, offset, length, bars)
  if (!w.length) return null
  // 淡入淡出那段波形跟着变矮（同剪映）·fadeIn／fadeOut＝占片段几成
  const fade = (i: number) => { const x = (i + 0.5) / w.length; let k = 1; if (fadeIn > 0) k = Math.min(k, x / fadeIn); if (fadeOut > 0) k = Math.min(k, (1 - x) / fadeOut); return Math.min(1, Math.max(0, k)) }
  const d = w.map((p, i) => { const h = Math.max(0.02, T.waveHeight(p, gain * fade(i))); return `M${i} ${(0.5 - h / 2).toFixed(3)}h0.7v${h.toFixed(3)}h-0.7z` }).join('')
  return (
    <svg viewBox={`0 0 ${bars} 1`} preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[72%] w-full pointer-events-none text-[#ffffff]/30" aria-hidden data-testid="vedit-clip-wave">
      <path d={d} fill="currentColor" />
    </svg>
  )
})

/** 工具钮：按下不抢焦点（免得空白键再按一次它） */
function ToolBtn({ label, onClick, disabled, testid, children, active }: { label: string; onClick?: () => void; disabled?: boolean; testid?: string; children: React.ReactNode; /**  开着的样子（安全区） */ active?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} data-testid={testid} onMouseDown={(e) => e.preventDefault()} {...(active !== undefined ? { 'aria-pressed': active } : {})}
      className={`h-7 w-7 flex items-center justify-center rounded hover:bg-neutral-700 disabled:opacity-35 disabled:hover:bg-transparent ${active ? 'text-cyan-400 bg-cyan-500/15' : 'text-neutral-300'}`}>
      {children}
    </button>
  )
}
/** 时间轴右上开关：图示照截图画（20×20 线条）·开着＝青色底青色图示；悬停写「主軌磁吸：開」＋一句说明 */
function TlToggle({ on, onClick, label, hint, state, testid, children }: { on: boolean; onClick: () => void; label: string; hint: string; state: string; testid: string; children: React.ReactNode }) {
  const tip = `${label}：${state}\n${hint}`
  return (
    <button type="button" title={tip} aria-label={`${label}：${state}`} aria-pressed={on} onClick={onClick} data-testid={testid} data-on={on ? '1' : '0'} onMouseDown={(e) => e.preventDefault()}
      className={`h-7 w-7 flex items-center justify-center rounded ${on ? 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30' : 'text-neutral-400 hover:bg-neutral-700'}`}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>{children}</svg>
    </button>
  )
}

/** 拖拉条：col＝竖条左右拖调宽·row＝横条上下拖调高。回调给的是「从按下到现在」的总位移（夹限时不漂）。 */
function Splitter({ dir, label, testid, onStart, onDrag, onEnd }: { dir: 'col' | 'row'; label: string; testid: string; onStart: () => void; onDrag: (total: number) => void; onEnd: () => void }) {
  const from = useRef<number | null>(null)
  const pos = (e: React.PointerEvent) => (dir === 'col' ? e.clientX : e.clientY)
  const stop = (e: React.PointerEvent<HTMLDivElement>) => {
    if (from.current === null) return
    from.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已放 */ }
    onEnd()
  }
  return (
    <div role="separator" aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'} aria-label={label} title={label} data-testid={testid}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); from.current = pos(e); onStart() }}
      onPointerMove={(e) => { if (from.current !== null) onDrag(pos(e) - from.current) }}
      onPointerUp={stop} onPointerCancel={stop}
      className={`group shrink-0 flex items-center justify-center touch-none ${dir === 'col' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'}`}>
      <div className={`rounded-full bg-transparent group-hover:bg-cyan-500/70 group-active:bg-cyan-400 ${dir === 'col' ? 'w-0.5 h-full' : 'h-0.5 w-full'}`} />
    </div>
  )
}

/** 罩期（角色在改这份工程档）挡掉的键动作：会改轨道的那些；播放、跳帧、缩放、选取、复制照常 */
const AI_LOCK_KEY_ACTS: ReadonlySet<T.KeyAct> = new Set<T.KeyAct>(['cut', 'paste', 'nudge-prev', 'nudge-next', 'split', 'delete', 'undo', 'redo', 'trim-left', 'trim-right', 'marker'])

// 手机、平板等渲染不了的装置不开放剪辑页——先过装置闸（VeditDeviceGate·判法 renderCapability）·过不了整页「請用電腦開」·⛔ 载编辑器
export default function VideoEditPage({ host }: { host: VideoPageHost }) {
  const verdict = useRenderVerdict()
  if (!verdict) return <div className="h-screen bg-neutral-900" data-testid="vedit-device-checking" />
  if (!verdict.ok) return <VeditDeviceGate reason={verdict.reason} homeHref={host.homeHref} />
  return <VideoEditEditor host={host} />
}

function VideoEditEditor({ host }: { host: VideoPageHost }) {
  const t = useStudioT()
  const language = useStudioLang() // 导入字幕猜编码也要用·提到这里
  const [gate, setGate] = useState<'checking' | 'ok' | 'no'>('checking')
  useEffect(() => {
    let alive = true
    host.checkGate()
      .then((ok) => { if (alive) setGate(ok ? 'ok' : 'no') })
      .catch(() => { if (alive) setGate('no') })
    return () => { alive = false }
  }, [])

  // ── 素材（只在本浏览器）──
  const [topTab, setTopTab] = useState<TopTab>('media')
  const [driveOpen, setDriveOpen] = useState(false)
  const [importAsk, setImportAsk] = useState(false)
  const [webShotOpen, setWebShotOpen] = useState(false) // 網頁截圖（登入版·host.webShot）
  const [settingsOpen, setSettingsOpen] = useState(false) // 顶栏「設定」
  const [exportOpen, setExportOpen] = useState(false)
  const [licensesOpen, setLicensesOpen] = useState(false) // 顶栏「匯出」
  const [dropping, setDropping] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** 提示条带「重试」——只在提示条还是这一句时显示钮（别的提示盖掉就不出）；what＝重取云盘那份／重算波形 */
  const [noticeRetry, setNoticeRetry] = useState<{ text: string; id: string; what: 'fetch' | 'decode' } | null>(null)
  const [peaksNudge, setPeaksNudge] = useState(0)
  /** 留久一点的那句提示（声音解不开·要使用者去转档） */
  const longNotice = useRef<string | null>(null)
  useEffect(() => { if (!notice) return; const h = setTimeout(() => setNotice(null), longNotice.current === notice ? SOUND_NOTICE_MS : 4000); return () => clearTimeout(h) }, [notice])
  const [media, setMedia] = useState<Media[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  // 素材区搜寻与排序（排序记在本机）
  const [mediaQ, setMediaQ] = useState('')
  const [mediaSort, setMediaSortRaw] = useState<MediaSort>(() => { try { const v = typeof window !== 'undefined' ? localStorage.getItem('vedit-media-sort') : null; return isMediaSort(v) ? v : 'added' } catch { return 'added' } })
  const [mediaDesc, setMediaDesc] = useState(false)
  // 预览安全区（记在本机）
  const [safeMode, setSafeModeRaw] = useState<SafeMode>(() => { try { const v = typeof window !== 'undefined' ? localStorage.getItem('vedit-safe-zone') : null; return isSafeMode(v) ? v : 'off' } catch { return 'off' } })
  const setSafeMode = (m: SafeMode) => { setSafeModeRaw(m); try { localStorage.setItem('vedit-safe-zone', m) } catch { /* 无痕视窗 */ } }
  const setMediaSort = (s: MediaSort) => { setMediaSortRaw(s); try { localStorage.setItem('vedit-media-sort', s) } catch { /* 无痕视窗 */ } }
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const fileRef = useRef<HTMLInputElement>(null)
  // 匯入：有云盘 ⇒ 先弹小窗选本机／云盘；没云盘（游客版）⇒ 直接开本机选档
  const openImport = () => { if (host.drive) setImportAsk(true); else fileRef.current?.click() }
  const urlsRef = useRef<string[]>([])
  useEffect(() => () => { urlsRef.current.forEach((u) => URL.revokeObjectURL(u)) }, [])
  const blobUrl = useCallback((b: Blob) => { const u = URL.createObjectURL(b); urlsRef.current.push(u); return u }, [])
  /** 素材原档（这次开页从电脑挑的那份·「存到雲端硬碟」与转预览档用；本机储存里也有一份） */
  const filesRef = useRef(new Map<string, File>())
  const mediaRef = useRef<Media[]>([])
  mediaRef.current = media
  /** 这份素材在本机储存（原档／预览档／波形）里的键——按内容（云盘档编号／本机汇入编号）·⛔ 直接拿素材编号（判法 mediaStoreKey） */
  const storeKeyOf = useCallback((m: Pick<Media, 'id' | 'from' | 'driveId'>) => host.media.keyOf(m, projRef.current?.id ?? null), []) // eslint-disable-line react-hooks/exhaustive-deps
  /** 改一条素材（同步改 mediaRef·背景工作跨好几拍要读到最新的）；url 换了 ⇒ 旧的本机暂时链接放掉 */
  const patchMedia = useCallback((id: string, patch: Partial<Media>) => {
    const old = mediaRef.current.find((m) => m.id === id)
    if (!old) return
    const next = { ...old, ...patch }
    mediaRef.current = mediaRef.current.map((m) => (m.id === id ? next : m))
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    if (patch.url && patch.url !== old.url && old.url.startsWith('blob:')) {
      const u = old.url
      setTimeout(() => { URL.revokeObjectURL(u); urlsRef.current = urlsRef.current.filter((x) => x !== u) }, 5000) // 播放器换好 src 再放
    }
  }, [])
  /** 声音解不开：素材标无声（素材卡与时间轴片段上都标）＋提示怎么转档；同一条素材只提示一次（汇入时与放上时间轴算波形时各会判一次·记号按素材编号·工程编号晚到也不变；重试钮先清掉记号）；retry＝提示条带重算波形的钮 */
  const soundWarned = useRef(new Set<string>())
  const flagNoSound = useCallback((m: Media, retry: boolean) => {
    if (!m.noSound) patchMedia(m.id, { noSound: true })
    if (!firstSoundWarn(soundWarned.current, m.id)) return
    const txt = t('vedit_audio_decode_fail').replace('{name}', m.name)
    longNotice.current = txt
    setNotice(txt); setNoticeRetry(retry ? { text: txt, id: m.id, what: 'decode' } : null)
  }, [patchMedia, t])
  /** 背景准备一份素材（一次一份·排队）：本机素材存原档 → 云盘素材下载到本机 → 影片转预览档 */
  const jobRef = useRef<Promise<void>>(Promise.resolve())
  /** 这次开页挑的本机原档读不动了（被移走／改写／iCloud 没下载完）⇒
   *  先换本机储存里那份 → 再换云盘那份（有的话·先照放云盘链接、背景下载一份）→ 都没有就标缺素材并明说「请重新汇入」。回换上的那份（没有 ⇒ null） */
  const recoverUnreadable = useCallback(async (id: string): Promise<File | null> => {
    filesRef.current.delete(id)
    const m = mediaRef.current.find((x) => x.id === id)
    if (!m) return null
    const kept = asFile(await host.media.readOriginal(m, projRef.current?.id ?? null), m.name)
    if (kept && !(await blobUnreadable(kept))) {
      patchMedia(id, { stored: true, ...(m.proxied ? {} : { url: blobUrl(kept) }) })
      return kept
    }
    if (m.remote) {
      setNotice(t('vedit_media_unreadable_cloud').replace('{name}', m.name))
      patchMedia(id, { stored: false, ...(m.proxied ? {} : { url: m.remote }) })
      const got = host.drive ? await host.drive.cacheOriginal(storeKeyOf(m), m.remote) : null
      if (got) patchMedia(id, { stored: true })
      return got
    }
    setNotice(t('vedit_media_unreadable').replace('{name}', m.name))
    patchMedia(id, { stored: false, work: undefined, ...(m.proxied ? {} : { url: '', missing: true }) })
    return null
  }, [patchMedia, blobUrl, t, storeKeyOf]) // eslint-disable-line react-hooks/exhaustive-deps
  // ── 代理档交给终端转、存云盘共用（判法 _lib/vedit-cloud-proxy.pure）：
  //   云盘有终端转好的 ⇒ 只下载那份小档（⛔ 拉整支原档）；有终端能转（装好识别字幕或 AI 分轨那台）⇒ 交给它；没壳／转不成 ⇒ 照旧本机转。──
  // 宿主一开页就定了（登入版有终端那条、游客版没有）⇒ 每次渲染叫的 hook 都一样
  const localDev = (host.shell?.useLocalDeviceId ?? noLocalDevice)()
  const localDevRef = useRef(localDev)
  localDevRef.current = localDev
  const proxyDevCache = useRef<{ at: number; dev: MediaDevice | null } | null>(null)
  /** 能转小档的那台（20 秒内问过就照用） */
  const proxyDevNow = useCallback(async (): Promise<MediaDevice | null> => {
    const c = proxyDevCache.current
    if (c && Date.now() - c.at < 20_000) return c.dev
    const dev = host.shell ? proxyDevice(await host.shell.fetchMediaDevices(), localDevRef.current) : null
    proxyDevCache.current = { at: Date.now(), dev }
    return dev
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  /** 交给终端失败过／云盘那份取不到的素材（这次开页不再试那条路·照旧本机转） */
  const shellFailedRef = useRef(new Set<string>())
  const cloudFailedRef = useRef(new Set<string>())
  const shellPxRef = useRef<(id: string) => void>(() => {})
  /** 云盘那份缩图拼图、波形下载进这台（本机储存有就直接读） */
  const cloudExtras = useCallback(async (id: string) => {
    const m = mediaRef.current.find((x) => x.id === id)
    const cp = m?.cloudProxy
    const drive = host.drive
    if (!m || !cp || !drive) return
    const sk = storeKeyOf(m)
    const th = cp.t
    if (th && !m.thumbs) {
      const f = await drive.cacheCloudThumbs(sk, th.id)
      if (f && mediaRef.current.find((x) => x.id === id)?.cloudProxy?.t?.id === th.id) patchMedia(id, { thumbs: { url: blobUrl(f), every: th.every, cols: th.cols, n: th.n } })
    }
    if (cp.w && (await drive.cacheCloudPeaks(sk, cp.w))) { peaksAsked.current.delete(id); setPeaksNudge((n) => n + 1) } // 波形换成终端算好的那份（⛔ 再解声音）
  }, [patchMedia, blobUrl, storeKeyOf]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 云盘那份剪辑用小档下载进本机储存、换上（成了 ⇒ true） */
  const applyCloudProxy = useCallback(async (id: string): Promise<boolean> => {
    const m = mediaRef.current.find((x) => x.id === id)
    const v = m?.cloudProxy?.v
    if (!m || !v || !host.drive) return false
    patchMedia(id, { work: { what: 'cache' } })
    const f = await host.drive.cacheCloudProxy(storeKeyOf(m), v)
    const cur = mediaRef.current.find((x) => x.id === id)
    if (!cur) return false
    if (cur.cloudProxy?.v !== v) { patchMedia(id, { work: undefined }); return false }
    patchMedia(id, { work: undefined, ...(f ? { url: blobUrl(f), proxied: true, noPicture: false } : {}) })
    if (f) void cloudExtras(id)
    return !!f
  }, [patchMedia, blobUrl, storeKeyOf, cloudExtras]) // eslint-disable-line react-hooks/exhaustive-deps
  const prepare = useCallback((id: string) => {
    const run = async () => {
      let m = mediaRef.current.find((x) => x.id === id)
      if (!m) return
      let orig: File | null = filesRef.current.get(id) ?? null
      if (m.from === 'local' && !m.stored && orig) {
        patchMedia(id, { work: { what: 'store' } })
        const ok = await host.media.storeOriginal(m, orig, projRef.current?.id ?? null)
        patchMedia(id, { stored: ok, work: undefined })
        if (!ok && (await blobUnreadable(orig))) orig = await recoverUnreadable(id) // 存不下其实是原档读不动（⛔ 报「浏览器存不下」）
        else if (!ok) setNotice(t('vedit_store_fail'))
      }
      if (!orig) orig = asFile(await host.media.readOriginal(m, projRef.current?.id ?? null), m.name)
      m = mediaRef.current.find((x) => x.id === id)
      if (!m) return
      // ②：影片的剪辑用小档怎么来（云盘下载／交给终端／本机转）·交给终端那条在背景跑（⛔ 占这条排队）
      const routeNow = async (mm: Media) => {
        const shellFailed = shellFailedRef.current.has(id), cloudFailed = cloudFailedRef.current.has(id)
        const cloudOk = !!mm.cloudProxy && !cloudFailed
        const maybeShell = mm.kind === 'video' && !mm.proxied && !cloudOk && !shellFailed && (!!mm.driveId || !!mm.up)
        return proxyRoute({ kind: mm.kind, proxied: !!mm.proxied, driveId: mm.driveId, cloud: mm.cloudProxy, cloudFailed, shellReady: maybeShell && !!(await proxyDevNow()), shellFailed, uploading: !!mm.up })
      }
      let route = await routeNow(m)
      if (route === 'fetch') {
        if (await applyCloudProxy(id)) return
        cloudFailedRef.current.add(id)
        m = mediaRef.current.find((x) => x.id === id)
        if (!m) return
        route = await routeNow(m)
      }
      if (route === 'have' && m.cloudProxy) void cloudExtras(id)
      if (route === 'wait') { // 传完云盘（startUpload 收尾）再排一次
        patchMedia(id, { shellPx: { p: 0, wait: true } })
        if (!mediaRef.current.find((x) => x.id === id)?.up) { patchMedia(id, { shellPx: undefined }); prepare(id) } // 问终端那一下已经传完（收尾看不到 wait）
        return
      }
      if (route === 'shell') { shellPxRef.current(id); return }
      if ((m.from === 'drive' || m.driveId) && !orig && m.remote && needOriginalDownload(route, !!m.cloudProxy?.v)) { // 本机素材这台没了但传过云盘 ⇒ 从云盘取回
        patchMedia(id, { work: { what: 'cache' } })
        const why: { why?: 'fetch' | 'space' | 'write' } = {}
        orig = host.drive ? await host.drive.cacheOriginal(storeKeyOf(m), m.remote, undefined, why) : null
        patchMedia(id, { work: undefined, ...(orig ? { stored: true, ...(m.proxied ? {} : { url: blobUrl(orig) }) } : {}) })
        // 音频从云盘取不到 ⇒ 没本机那份就没波形、汇出也会缺这段声音 ⇒ 明说是哪支＋给重试（空间不够另有原句·不算这种）
        if (!orig && why.why === 'fetch' && m.kind === 'audio') { const txt = t('vedit_audio_fetch_fail').replace('{name}', m.name); setNotice(txt); setNoticeRetry({ text: txt, id, what: 'fetch' }) }
      }
      m = mediaRef.current.find((x) => x.id === id)
      if (!m || m.kind !== 'video' || m.proxied || !orig) return
      const sk = storeKeyOf(m)
      let last = 0
      const proxyOf = (src: File) => {
        patchMedia(id, { work: { what: 'proxy', p: 0 } })
        last = 0
        return makeProxy(sk, 'video', src, m!.duration, (p) => {
          if (p - last < 0.02 && p < 1) return
          last = p
          patchMedia(id, { work: { what: 'proxy', p } })
        })
      }
      let px = await proxyOf(orig)
      if (px.unreadable) { // 原档读不动 ⇒ 换别的那份再转一次
        patchMedia(id, { work: undefined })
        const alt = await recoverUnreadable(id)
        if (!alt) return
        px = await proxyOf(alt)
      }
      // 转出来的预览档是 H.264 8bit 4:2:0 且确定带画面 ⇒ 有画面了；转不了 ⇒ 照放原档·原档也没画面就由 noPicture 明说
      patchMedia(id, { work: undefined, codec: px.codec ?? null, ...(px.file ? { url: blobUrl(px.file), proxied: true, noPicture: false } : {}) })
    }
    jobRef.current = jobRef.current.then(run, run).catch(() => {})
  }, [patchMedia, blobUrl, t, recoverUnreadable, storeKeyOf, proxyDevNow, applyCloudProxy, cloudExtras]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 交给终端转这份的剪辑用小档（原档已在云盘）：转好 ⇒ 记进素材（存进工程档）·下载换上；没终端／转不成 ⇒ 退回本机转（明说一句） */
  const shellBusyRef = useRef(new Set<string>())
  const [shellProxyGate] = useState(() => slotGate(SHELL_PROXY_INFLIGHT))
  const startShellProxy = useCallback(async (id: string) => {
    const m0 = mediaRef.current.find((x) => x.id === id)
    const shell = host.shell
    if (!m0?.driveId || shellBusyRef.current.has(id) || !shell) return
    const driveId = m0.driveId
    const back = (msg?: string) => {
      shellFailedRef.current.add(id)
      patchMedia(id, { shellPx: undefined })
      if (msg) setNotice(t('vedit_shell_proxy_fallback').replace('{name}', m0.name).replace('{msg}', msg))
      prepare(id)
    }
    const dev = await proxyDevNow()
    if (!dev) { back(); return }
    shellBusyRef.current.add(id)
    patchMedia(id, { shellPx: { p: 0 } })
    try {
      if (!settingsRef.current.uploadFolderId) await ensureDraftRef.current() // 结果存进专案资料夹（同上传素材）
      const cancelled = () => mediaRef.current.find((x) => x.id === id)?.driveId !== driveId // 素材拿掉／换了云盘档 ⇒ 叫那台停
      // 同时至多 SHELL_PROXY_INFLIGHT 件交过去（其余在这页排着）·壳的排队格留给识别字幕／拆曲
      const res = await shellProxyGate.run(() => {
        if (cancelled()) throw new ShellJobError('cancelled')
        return shell.runShellJob({
          dev, kind: 'proxy', have: { fileId: driveId, folderId: settingsRef.current.uploadFolderId ?? projFolderRef.current },
          onPhase: (p) => { if (p.kind === 'job' && p.job && mediaRef.current.some((x) => x.id === id)) patchMedia(id, { shellPx: { p: p.job.pct / 100 } }) },
          cancelled,
        })
      })
      const cp = cloudProxyOf(res, driveId)
      if (!cp) { back(t('vedit_shell_err_failed')); return }
      host.drive?.invalidate()
      patchMedia(id, { cloudProxy: cp, shellPx: undefined })
      if (cp.v) { if (!(await applyCloudProxy(id))) { cloudFailedRef.current.add(id); back(t('vedit_shell_err_failed')) } }
      else { void cloudExtras(id); prepare(id) } // 那台看过：原档本来就是小的一般 H.264 ⇒ 照旧（直接放原档）
    } catch (e) {
      if (e instanceof ShellJobError && e.why === 'cancelled') { if (mediaRef.current.some((x) => x.id === id)) patchMedia(id, { shellPx: undefined }); return }
      back(shellErrText(t, e))
    } finally { shellBusyRef.current.delete(id) }
  }, [patchMedia, t, prepare, proxyDevNow, applyCloudProxy, cloudExtras]) // eslint-disable-line react-hooks/exhaustive-deps
  shellPxRef.current = (id) => { void startShellProxy(id) }
  // ── ：本机素材汇入就能剪·同时默认在背景传一份进云盘（素材卡右上角转圈·点开看进度可取消）·设定存本机 ──
  const [settings, setSettings] = useState<VeditSettings>(() => parseSettings(null))
  const settingsRef = useRef(settings)
  /** 开着的剪辑工程档所在专案资料夹·设定里没另挑位置就传进这里 */
  const projFolderRef = useRef<string | null>(null)
  settingsRef.current = settings
  const settingsLoadedRef = useRef(false)
  useEffect(() => { try { setSettings(parseSettings(window.localStorage.getItem(VEDIT_SETTINGS_KEY))) } catch { /* 用缺省 */ } settingsLoadedRef.current = true }, [])
  const changeSettings = useCallback((v: VeditSettings) => {
    setSettings(v); settingsRef.current = v
    try { window.localStorage.setItem(VEDIT_SETTINGS_KEY, JSON.stringify(v)) } catch { /* 存不进只影响下次开页 */ }
  }, [])
  /** 按过「取消上傳」的素材（存本机·重开页不再自动传） */
  const NO_UPLOAD_KEY = 'dilin.videoEdit.noUpload.v1'
  const noUploadRef = useRef<Set<string> | null>(null)
  const noUpload = () => {
    if (!noUploadRef.current) { try { const v = JSON.parse(window.localStorage.getItem(NO_UPLOAD_KEY) || '[]'); noUploadRef.current = new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []) } catch { noUploadRef.current = new Set() } }
    return noUploadRef.current
  }
  /** 没开档时一动手剪就建草稿（下面剪辑工程档那段管）·上传要等它建好才知道传进哪个专案资料夹 */
  const ensureDraftRef = useRef<() => Promise<void>>(() => Promise.resolve())
  /** 开页那一刻（本机素材清单读回之后）的样子·拿来比「有没有动手剪」（null＝还没读完／开的是 ?id= ⇒ 不建草稿） */
  const draftBaseRef = useRef<DraftSnap | null>(null)
  const upCancelRef = useRef(new Map<string, () => void>())
  const upJobRef = useRef<Promise<void>>(Promise.resolve())
  const [upDialog, setUpDialog] = useState<{ id: string; confirm: boolean } | null>(null)
  /** 传一份进云盘（排队·一次一份）：manual＝按 ☁ 钮（成了／失败都说一声）；自动的只在云盘满了或失败时说 */
  const startUpload = useCallback((id: string, manual = false) => {
    const m0 = mediaRef.current.find((x) => x.id === id)
    const drive = host.drive
    if (!m0 || m0.from !== 'local' || m0.driveId || m0.up || !drive) return
    patchMedia(id, { up: { p: 0 } })
    const run = async () => {
      const m = mediaRef.current.find((x) => x.id === id)
      if (!m || !m.up) return // 排队时就被取消／移除
      const orig = filesRef.current.get(id) ?? (await host.media.readOriginal(m, projRef.current?.id ?? null))
      if (!orig) { patchMedia(id, { up: undefined }); if (manual) setNotice(t('vedit_save_drive_fail')); return }
      const file = orig instanceof File && orig.name === m.name ? orig : new File([orig], m.name, { type: orig.type })
      // 汇入素材就是动手剪 ⇒ 先等草稿建好（传进草稿的专案资料夹·同「存成剪輯檔」的规矩）；设定另挑了上传位置 ⇒ 不必等
      if (!settingsRef.current.uploadFolderId) await ensureDraftRef.current()
      if (!mediaRef.current.find((x) => x.id === id)?.up) return // 等的时候被取消／移除
      let last = 0
      const job = drive.upload(file, settingsRef.current.uploadFolderId ?? projFolderRef.current, (d, total) => {
        const p = uploadFrac(d, total)
        if (p - last < 0.01 && p < 1) return
        last = p
        patchMedia(id, { up: { p } })
      })
      upCancelRef.current.set(id, job.cancel)
      try {
        const up = await job.done
        // 上传口回的是 15 分钟签名链 ⇒ 记云盘档案行那条长期网址（换台电脑／隔天照样开得出来）
        const raw = await drive.rowUrl(up.id)
        patchMedia(id, { driveId: up.id, remote: raw || up.url, up: undefined })
        if (manual) setNotice(t('vedit_saved_drive'))
        drive.invalidate()
      } catch (e) {
        const err = e as DriveUploadError
        patchMedia(id, { up: undefined })
        if (err.name === 'AbortError') return
        if (isDriveFull(err)) {
          if (settingsRef.current.autoUpload) changeSettings({ ...settingsRef.current, autoUpload: false })
          setNotice(t('vedit_up_drive_full'))
        } else if (isDriveBusy(err)) setNotice(t('transfer_quota_sessions_title')) // 别的上传占着（重排几次还忙）：⛔ 当满·⛔ 关自动上传
        else setNotice(t(manual ? 'vedit_save_drive_fail' : 'vedit_up_fail').replace('{name}', m.name))
      } finally {
        upCancelRef.current.delete(id)
        // ②：等着传完交给终端转小档的影片 ⇒ 再排一次（传成了 ⇒ 交给终端；没传成／取消 ⇒ 照旧本机转）
        const mm = mediaRef.current.find((x) => x.id === id)
        if (mm?.shellPx?.wait) { patchMedia(id, { shellPx: undefined }); prepare(id) }
      }
    }
    upJobRef.current = upJobRef.current.then(run, run).catch(() => {})
  }, [patchMedia, changeSettings, t, storeKeyOf, prepare]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 「取消上傳」（弹窗里确认过）：停掉、记下这份不再自动传 */
  const cancelUpload = useCallback((id: string) => {
    noUpload().add(id)
    try { window.localStorage.setItem(NO_UPLOAD_KEY, JSON.stringify([...noUpload()])) } catch { /* 只影响下次开页 */ }
    const c = upCancelRef.current.get(id)
    if (c) c(); else patchMedia(id, { up: undefined }) // 还在排队 ⇒ 直接撤（run 起来看到没 up 就不传）
  }, [patchMedia])
  // 编曲导入的歌走同一套上传
  //（同一个自动上传开关、上传位置、先等草稿建好、记云盘档案行那条长期网址、云盘满了关自动）·进度与取消在编曲那边画
  const arrangeCloud = useMemo<ArrCloud | null>(() => { const drive = host.drive; return !drive ? null : {
    auto: () => settingsRef.current.autoUpload,
    cache: (file, url) => drive.cacheOriginal(file, url),
    start: (file, onProgress) => {
      let stopped = false
      let inner: { cancel: () => void } | null = null
      const done = (async () => {
        if (!settingsRef.current.uploadFolderId) await ensureDraftRef.current()
        if (stopped) throw Object.assign(new Error('canceled'), { name: 'AbortError' })
        const job = drive.upload(file, settingsRef.current.uploadFolderId ?? projFolderRef.current, (d, total) => onProgress(uploadFrac(d, total)))
        inner = job
        try {
          const up = await job.done
          const raw = await drive.rowUrl(up.id)
          drive.invalidate()
          return { driveId: up.id, url: raw || up.url }
        } catch (e) {
          const err = e as DriveUploadError
          if (err.name !== 'AbortError' && isDriveFull(err)) {
            if (settingsRef.current.autoUpload) changeSettings({ ...settingsRef.current, autoUpload: false })
            throw Object.assign(err, { full: true })
          }
          throw err
        }
      })()
      return { done, cancel: () => { stopped = true; inner?.cancel() } }
    },
  } }, [changeSettings]) // eslint-disable-line react-hooks/exhaustive-deps
  const autoUploadIfOn = useCallback((id: string) => {
    const m = mediaRef.current.find((x) => x.id === id)
    if (host.drive && m && shouldAutoUpload(m, settingsRef.current) && !noUpload().has(id)) startUpload(id)
  }, [startUpload]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 选进来的档里有别家剪辑工程（FCPXML／Premiere XML／剪映草稿）⇒ 汇入那份（别的档当它的素材）·实作在下面比例那段之后 */
  const importOtherRef = useRef<(proj: File, app: ImportApp, rest: File[]) => Promise<Media[]>>(async () => [])
  /** 选进来的字幕档（SRT／VTT／ASS）⇒ 同「匯入本機字幕」排上文字轨（实作在 importSubtitles） */
  const importSubsRef = useRef<(f: File) => Promise<void>>(async () => {})
  const onPick = useCallback(async (files: FileList | File[] | null) => {
    if (!files?.length) return [] as Media[]
    let all = Array.from(files)
    const subs = all.filter((f) => /\.(srt|vtt|ass|ssa)$/i.test(f.name))
    if (subs.length) { for (const f of subs) await importSubsRef.current(f); all = all.filter((f) => !subs.includes(f)); if (!all.length) return [] as Media[] }
    for (const f of all) {
      if (kindOf(f) || f.size > 64 * 1024 * 1024) continue
      const app = /\.(fcpxml|xml|json|bak|edl|otio)$/i.test(f.name) ? detectProjectFile(f.name, await f.slice(0, 4000).text().catch(() => '')) : null
      if (app) return importOtherRef.current(f, app, all.filter((x) => x !== f))
    }
    const added: Media[] = []
    for (const f of all) {
      const kind = kindOf(f)
      if (!kind) continue
      const url = blobUrl(f)
      const id = crypto.randomUUID()
      filesRef.current.set(id, f)
      const pr = await probeMedia(url, kind)
      const noSound = kind !== 'image' && soundUndecodable(kind, await probeSound(f))
      added.push({ id, name: f.name, kind, url, duration: pr.duration, from: 'local', ...(pr.noPicture ? { noPicture: true } : {}), ...(noSound ? { noSound: true } : {}) })
    }
    if (!added.length) { setNotice(t('vedit_drop_not_media')); return added }
    mediaRef.current = [...mediaRef.current, ...added]
    setMedia((m) => [...m, ...added])
    setSelected((s) => s ?? added[0].id)
    for (const m of added) prepare(m.id)
    for (const m of added) autoUploadIfOn(m.id) // 汇入就能剪·同时背景上传
    for (const m of added) if (m.noSound) flagNoSound(m, false)
    return added
  }, [t, blobUrl, prepare, autoUploadIfOn, flagNoSound])
  // 开页把上次的素材读回来（本机素材读不回原档 ⇒ 那条丢掉）·读回之后才开始存清单（免得空清单盖掉存档）
  const [restored, setRestored] = useState(false)
  const restoreRef = useRef(false)
  useEffect(() => {
    if (gate !== 'ok' || restoreRef.current) return
    restoreRef.current = true
    if (host.project.urlId() || !host.media.rememberList) return // 开的是工程档 ⇒ 素材照工程档（下面剪辑工程档那段）·不读本机清单
    void (async () => {
      let saved: ReturnType<typeof parseStoredMedia> = []
      try { saved = parseStoredMedia(window.localStorage.getItem(VEDIT_MEDIA_KEY)) } catch { /* 读不到当没有 */ }
      const back: Media[] = []
      for (const s of saved) {
        const sk = storeKeyOf(s) // 按内容的键（没开工程档 ⇒ 不带工程编号）
        const orig = await host.media.readOriginal(s, null)
        if (s.from === 'local' && !orig && !s.url) continue // 本机那份没了但传过云盘 ⇒ 照样从云盘开
        const px = s.kind === 'video' ? await readProxy(sk) : null
        const url = px ? blobUrl(px) : orig ? blobUrl(orig) : s.url
        if (!url) continue
        // 没有预览档的影片重新量一次有没有画面（上次开页可能还没转好／这个浏览器解不开）
        const noPicture = s.kind === 'video' && !px ? (await probeMedia(url, s.kind)).noPicture : false
        back.push({ id: s.id, name: s.name, kind: s.kind, duration: s.duration, url, from: s.from, ...(s.driveId ? { driveId: s.driveId } : {}), ...(s.url ? { remote: s.url } : {}), stored: !!orig, proxied: !!px, ...(noPicture ? { noPicture } : {}), ...(s.stems ? { stems: s.stems } : {}), ...(s.stemOf ? { stemOf: s.stemOf } : {}), ...(s.cloudProxy ? { cloudProxy: s.cloudProxy } : {}) })
      }
      const ids = new Set(back.map((m) => m.id))
      mediaRef.current = [...back, ...mediaRef.current.filter((m) => !ids.has(m.id))]
      setMedia((prev) => [...back, ...prev.filter((m) => !ids.has(m.id))])
      // 读回来的素材不算动手（只是看看 ⇒ 不建空草稿）·从这一刻起再有改动才建
      draftBaseRef.current = { tracks: tracksRef.current, mediaIds: back.map((m) => m.id), ratio: ratioRef.current }
      setRestored(true)
      for (const m of back) if (!m.proxied || !m.stored) prepare(m.id)
      for (const m of back) autoUploadIfOn(m.id) // 上次没传完的接着传（按过取消的不传）
    })()
  }, [gate, blobUrl, prepare, autoUploadIfOn, storeKeyOf]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!restored) return
    try { window.localStorage.setItem(VEDIT_MEDIA_KEY, JSON.stringify(storableMedia(media))) } catch { /* 存不进只影响下次开页 */ }
  }, [media, restored])

  // ── 四块拖拉条：尺寸存本机·视窗变了照样夹进放得下的范围 ──
  const bodyRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 1400, height: 800 })
  const [layout, setLayout] = useState<VeditLayout>(VEDIT_LAYOUT_DEFAULT)
  useEffect(() => { try { setLayout(parseLayout(window.localStorage.getItem(VEDIT_LAYOUT_KEY))) } catch { /* 读不到用缺省 */ } }, [])
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const fit = () => setBox({ width: el.clientWidth, height: el.clientHeight })
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [gate])
  const shown = useMemo(() => clampLayout(layout, box), [layout, box])
  const dragFrom = useRef<VeditLayout | null>(null)
  const splitProps = (which: VeditSplit) => ({
    onStart: () => { dragFrom.current = shown },
    onDrag: (d: number) => { if (dragFrom.current) setLayout(dragLayout(dragFrom.current, which, d, box)) },
    onEnd: () => { dragFrom.current = null; setLayout((l) => { const c = clampLayout(l, box); try { window.localStorage.setItem(VEDIT_LAYOUT_KEY, JSON.stringify(c)) } catch { /* 存不进只影响下次 */ } return c }) },
  })
  const current = useMemo(() => media.find((m) => m.id === selected) ?? null, [media, selected])
  /** 画面解不开 ⇒ 素材卡与播放器明说（⛔ 静默黑屏）·认得出编码就带上 */
  const noPictureBody = (m: Pick<Media, 'codec'>) => {
    const c = codecLabel(m.codec)
    return t('vedit_no_picture_body').replace('{codec}', c ? t('vedit_no_picture_codec').replace('{c}', c) : '')
  }
  const noPictureNote = (m: Pick<Media, 'codec'>) => (
    <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none" data-testid="vedit-no-picture">
      <p className="max-w-md rounded-md bg-neutral-900/90 border border-amber-500/40 px-4 py-3 text-xs leading-relaxed text-amber-200 text-center">⚠ {noPictureBody(m)}</p>
    </div>
  )

  /** 云盘影音图档进素材（同一份只进一次）·回那条素材 */
  const addDriveMedia = useCallback(async (f: DriveRef): Promise<Media | null> => {
    const kind = f.kind
    if (!kind || !f.url) return null
    const had = mediaRef.current.find((m) => m.driveId === f.id)
    if (had) return had
    const pr = await probeMedia(f.url, kind)
    const m: Media = { id: crypto.randomUUID(), name: f.name, kind, url: f.url, duration: pr.duration, driveId: f.id, from: 'drive', remote: f.url, ...(pr.noPicture ? { noPicture: true } : {}) }
    if (mediaRef.current.some((x) => x.driveId === f.id)) return mediaRef.current.find((x) => x.driveId === f.id) ?? null
    setMedia((prev) => (prev.some((x) => x.driveId === f.id) ? prev : [...prev, m]))
    mediaRef.current = [...mediaRef.current, m]
    prepare(m.id)
    return m
  }, [prepare])
  /** 「存到雲端硬碟」：按 ☁ 手动传（自动上传关着／取消过的）·起同背景上传那条（右上角转圈·可取消） */
  const saveToDrive = useCallback((id: string) => {
    const m = mediaRef.current.find((x) => x.id === id)
    if (!m || m.from !== 'local' || m.driveId || m.work || m.up) return
    noUpload().delete(id)
    startUpload(id, true)
  }, [startUpload])
  /** 移除素材：轨道上还在用 ⇒ 不移（先删片段）；移了 ⇒ 本机储存里那两份一起删 */
  const removeMedia = useCallback((id: string) => {
    const tr = tracksRef.current
    const m = mediaRef.current.find((x) => x.id === id)
    // 编曲素材：连藏着的分轨一起拿掉（分轨还有段在轨道上 ⇒ 跟用着的素材一样不让拿）
    const kill = [id, ...(m?.stems ?? [])]
    if (T.allClips(tr).some((c) => kill.includes(c.mediaId))) { setNotice(t('vedit_remove_in_use')); return }
    if (!m || m.work) return
    for (const k of kill) if (mediaRef.current.find((x) => x.id === k)?.up) upCancelRef.current.get(k)?.() // 拿掉素材 ⇒ 背景上传一起停（不另提醒）
    const gone = mediaRef.current.filter((x) => kill.includes(x.id))
    mediaRef.current = mediaRef.current.filter((x) => !kill.includes(x.id))
    setMedia((prev) => prev.filter((x) => !kill.includes(x.id)))
    setSelected((s) => (s && kill.includes(s) ? null : s))
    for (const k of kill) filesRef.current.delete(k)
    // 本机储存按内容的键删（⛔ 拿素材编号）；还留着的素材有同一份内容（同一个云盘档）⇒ 那份快取留着
    host.media.forget(gone, mediaRef.current, projRef.current?.id ?? null)
  }, [t]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 素材格收拖放：电脑拖来的档 ⇒ 同「從本機匯入」；云盘树拖来的影音图档 ⇒ 进素材并选中；
   *  「產物」里没进云盘、只有链接的 ⇒ 下载成本机档再同「從本機匯入」（下载不了 ⇒ 一句提示）；别的 ⇒ 一句提示 */
  const acceptsMediaDrop = (dt: DataTransfer) => Array.from(dt.types ?? []).includes('Files') || !!host.drive?.accepts(dt)
  const onMediaDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    // 素材区接住了 ⇒ ⛔ 再冒到右边对话框挂在 document 的整页拖入（同一份档会被取两次·第二次领不到就报「有檔案沒拿到」）
    e.stopPropagation()
    host.drive?.markHandled(e.nativeEvent) // 止冒泡挡不住同挂 document 的整页拖入 ⇒ 明记「已接住」
    setDropping(false)
    if (e.dataTransfer.files?.length) { void onPick(e.dataTransfer.files); return }
    const site = host.drive?.readDrop(e.dataTransfer) ?? null
    if (!site) return
    // 云電腦／工作站「檔案管理」拖来的 ⇒ 照清单取回成档 ⇒ 同「從本機匯入」
    if (site.kind === 'desk') {
      setNotice(t('sect_direct_desk_drag_fetching'))
      void site.fetch().then(async ({ files, failed }) => {
        setNotice(failed ? t('sect_direct_desk_drag_failed') : null)
        if (files.length) await onPick(files)
      })
      return
    }
    if (site.kind === 'artifact') {
      void (async () => {
        try { await onPick([await site.fetch()]) } catch { setNotice(t('vedit_drop_fetch_fail')) }
      })()
      return
    }
    void host.drive!.fileById(site.id).then((f) => {
      if (!f || !f.kind) { setNotice(t('vedit_drop_not_media')); return }
      void addDriveMedia(f).then((m) => { if (m) setSelected(m.id) })
    })
  }, [onPick, addDriveMedia, t]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 时间轴：片段、播放头、复原重做（算法全在 _lib/vedit-timeline.pure.ts）──
  const mediaOf = useCallback((id: string) => mediaRef.current.find((m) => m.id === id), [])
  const [tracks, setTracks] = useState<T.Tracks>(T.EMPTY_TRACKS)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  const histRef = useRef<T.Hist>(T.EMPTY_HIST)
  // 编辑遮罩：角色正在改这份工程档（服务端编辑锁·钩子在下面 aiShield）⇒ 一切改动挡掉·挡了就在下面提示一句
  const aiLockedRef = useRef(false)
  const aiNoteRef = useRef<() => void>(() => {})
  const [, setHistTick] = useState(0) // 复原／重做钮亮不亮跟着它重画
  // 时间轴右上两颗开关（存本机·算法在 _lib/vedit-magnet.pure.ts、_lib/vedit-snap.pure.ts）
  const [tlPrefs, setTlPrefs] = useState<TimelinePrefs>(TIMELINE_PREFS_DEFAULT)
  const tlPrefsRef = useRef(tlPrefs)
  tlPrefsRef.current = tlPrefs
  useEffect(() => { try { const v = parseTimelinePrefs(window.localStorage.getItem(VEDIT_TIMELINE_PREFS_KEY)); tlPrefsRef.current = v; setTlPrefs(v) } catch { /* 用缺省 */ } }, [])
  const changeTlPrefs = useCallback((v: TimelinePrefs) => {
    setTlPrefs(v); tlPrefsRef.current = v
    try { window.localStorage.setItem(VEDIT_TIMELINE_PREFS_KEY, JSON.stringify(v)) } catch { /* 存不进只影响下次开页 */ }
  }, [])
  /** 吸住时那条浅蓝竖线在时间轴哪一秒 */
  const [snapLine, setSnapLine] = useState<number | null>(null)
  // 命令化第二期（算法在 lib/page-cmd.pure.ts）：cmdLogRef＝人手派发的命令账（依先后·角色改档撞上没存的改动时拿来在角色版上重放）；
  //   recNextRef＝下一笔入账的是哪笔命令（runCmd 设·commitTracks 收）；ratioLedgerRef＝角色那批连比例一起换时·复原到哪份轨道比例回到哪
  const cmdLogRef = useRef<PC.CmdRec[]>([])
  const recNextRef = useRef<PC.CmdRec | null>(null)
  const ratioLedgerRef = useRef<PC.RatioLedger>(new WeakMap())
  /** 一笔改动成立：空了的非主轨收掉·主轨磁吸开着且这一下动到主轨 ⇒ 主轨排紧·旧状态进复原栈（这笔是命令 ⇒ 记进命令账） */
  const commitTracks = useCallback((raw: T.Tracks, prev: T.Tracks = tracksRef.current) => {
    const rec = recNextRef.current
    recNextRef.current = null
    const next = T.pruneLanes(tlPrefsRef.current.magnet ? magnetEdit(raw, prev) : raw)
    if (next === prev) return
    histRef.current = T.commitHist(histRef.current, prev)
    if (rec) cmdLogRef.current = PC.logPush(cmdLogRef.current, rec)
    tracksRef.current = next
    setTracks(next)
    setHistTick((n) => n + 1)
  }, [])
  /** 人手的改动（角色改的走 commitTracks）：罩期挡掉·拖到一半罩落（轨道已跟着滑鼠变了）⇒ 退回拖之前 */
  const edit = useCallback((raw: T.Tracks, prev: T.Tracks = tracksRef.current) => {
    if (aiLockedRef.current) {
      if (tracksRef.current !== prev) { tracksRef.current = prev; setTracks(prev) }
      recNextRef.current = null // 这笔没入账 ⇒ 命令账也不记
      aiNoteRef.current()
      return
    }
    commitTracks(raw, prev)
  }, [commitTracks])
  /** 命令层看的页面现况（比例、素材在下面才宣告·这里只在动作当下读） */
  const cmdState = (tracks: T.Tracks = tracksRef.current): CmdState => ({ tracks, ratio: ratioRef.current, media: mediaRef.current.map(PC.toCmdMedia) })
  /** 人手动作＝派发命令表的命令（同角色 video_edit_run 那支 applyCommandsState）：成了 ⇒ 照人手改动入账（edit：罩期挡、主轨磁吸、收空轨、进复原栈）＋记命令账；
   *  罩着 ⇒ 提示一句·locked；命令不收（锁轨、没东西可改…）⇒ 什么都不动（调用方照原本的提示）。tracks＝命令套完、入账前那份（找新片段落在哪用） */
  const runCmd = useCallback((steps: CommandStep[]): { ok: true; tracks: T.Tracks; results: StepResult[] } | { ok: false; locked: boolean } => {
    if (aiLockedRef.current) { aiNoteRef.current(); return { ok: false, locked: true } }
    const r = PC.runHuman(cmdState(), steps, uid, tlPrefsRef.current.magnet)
    if (!r.ok) return { ok: false, locked: false }
    recNextRef.current = r.rec
    edit(r.tracks)
    recNextRef.current = null
    return { ok: true, tracks: r.tracks, results: r.results }
  }, [edit]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 手势／原本另算的动作：命令重算跟原算法一样 ⇒ 用命令那份入账（记命令账）；不一样（命令表没有的玩法）⇒ 照原算法那份（结果跟改前逐字一样） */
  const editVia = useCallback((steps: CommandStep[], legacy: T.Tracks) => {
    const v = PC.via(cmdState(), steps, uid, legacy, false, tlPrefsRef.current.magnet)
    recNextRef.current = v.rec
    edit(v.tracks)
    recNextRef.current = null
  }, [edit]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 时间轴手势（拖位、拉两端、轨道排序）放手后补记命令账：轨道照手势那份（自己进复原栈）·命令在按下那刻（base）重算一模一样才记 */
  const logVia = (base: T.Tracks, steps: CommandStep[], drawn: T.Tracks, prune: boolean) => {
    const v = PC.via(cmdState(base), steps, uid, drawn, prune)
    if (v.rec) cmdLogRef.current = PC.logPush(cmdLogRef.current, v.rec)
  }
  /** 远端版（角色／别页写的）换上来——照原样进复原栈·⛔ 过主轨磁吸（原走 commitTracks ⇒ 磁吸开着〔缺省开〕时把远端主轨的时间整条排紧·
   *  页面又把排紧后的当成「已存那份」·下一次存档就把角色排好的时间盖回去） */
  const commitRemoteTracks = useCallback((raw: T.Tracks) => {
    const prev = tracksRef.current
    const next = T.pruneLanes(raw)
    if (next === prev) return
    histRef.current = T.commitHist(histRef.current, prev)
    tracksRef.current = next
    setTracks(next)
    setHistTick((n) => n + 1)
  }, [])
  // 编辑手势（拖音量线／拖片段／拉两端／拖轨道排序）登记在这只看守上——罩落那刻（onLock）或拖到一半任何一步发现罩着 ⇒
  //   这一下作废：退回按下那刻的轨道·之后的移动／放手全不算（不改值、不进复原、不触发存档）；播放头、选取、卷动、检视照常
  const gestureEndRef = useRef<() => void>(() => {})   // 这一下手势自己的收尾（放掉滑鼠监听、拿掉拖动影子）
  const gestureRef = useRef<GestureGuard<T.Tracks> | null>(null)
  if (!gestureRef.current) gestureRef.current = createGestureGuard<T.Tracks>({
    locked: () => aiLockedRef.current,
    restore: (b) => { if (tracksRef.current !== b) { tracksRef.current = b; setTracks(b) } },
    onAbort: () => { const f = gestureEndRef.current; gestureEndRef.current = () => {}; f(); aiNoteRef.current() },
  })
  const gesture = gestureRef.current
  // 复原／重做（快照·角色那批也是一步）：退到角色那批之前 ⇒ 那批连比例一起换的话比例也回去（PC.stepHist·比例帐）
  const stepHist = (dir: 'undo' | 'redo') => {
    const r = PC.stepHist(dir, histRef.current, ratioLedgerRef.current, { tracks: tracksRef.current, ratio: ratioRef.current })
    if (!r) return
    histRef.current = r.hist; tracksRef.current = r.tracks; setTracks(r.tracks); setHistTick((n) => n + 1)
    if (r.ratio) { ratioRef.current = r.ratio; setRatioSel(r.ratio) }
  }
  const undo = useCallback(() => {
    if (aiLockedRef.current) { aiNoteRef.current(); return }
    stepHist('undo')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const redo = useCallback(() => {
    if (aiLockedRef.current) { aiNoteRef.current(); return }
    stepHist('redo')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  /** 主轨磁吸开关：打开那一下照剪映把主轨现有的空隙收紧（进复原栈一步·没空隙就不记）；主轨锁了不动 */
  const toggleMagnet = useCallback(() => {
    const on = !tlPrefsRef.current.magnet
    changeTlPrefs({ ...tlPrefsRef.current, magnet: on })
    if (on) { const tr = tracksRef.current; edit(magnetPack(tr, tr)) }
  }, [changeTlPrefs, edit])
  /** 自动吸附开关：关掉 ⇒ 拖片段、拉两端、画面里拖字块贴纸都不吸、不顿、不画线 */
  const toggleSnap = useCallback(() => { changeTlPrefs({ ...tlPrefsRef.current, snap: !tlPrefsRef.current.snap }); setSnapLine(null) }, [changeTlPrefs])
  // 选取：跟着轨道走（删掉的、轨锁了的自动掉出去）
  const [selRaw, setSel] = useState<readonly string[]>([])
  const sel = groupSelection(tracks, selRaw) // 选到组里一段 ⇒ 整组都选起来
  const selRef = useRef(sel)
  selRef.current = sel
  const picked = sel.length ? sel[sel.length - 1] : null
  // 选中的接缝转场（存后一段编号·接缝分开了就自动不算选中）；选了片段 ⇒ 接缝选取放掉
  const [selTransRaw, setSelTrans] = useState<string | null>(null)
  const selTrans = (() => { if (!selTransRaw) return null; const f = T.findClip(tracks, selTransRaw); return f?.clip.transIn && decoratable(f.lane, f.clip) ? selTransRaw : null })() // 片头转场（前面没接着别段）也能选
  const selTransRef = useRef(selTrans)
  selTransRef.current = selTrans
  const selKeyFx = sel.join(',')
  useEffect(() => { if (selKeyFx) setSelTrans(null) }, [selKeyFx])
  // 游标模式（select／blade 刀片）＋选中的标记（存秒·那面旗没了就自动不算选中）；选了片段 ⇒ 标记选取放掉
  const [tool, setTool] = useState<EditTool>('select')
  const toolRef = useRef(tool)
  toolRef.current = tool
  const [selMarkerRaw, setSelMarker] = useState<number | null>(null)
  const markers = markersOf(tracks)
  const selMarker = selMarkerRaw !== null && markers.includes(selMarkerRaw) ? selMarkerRaw : null
  const selMarkerRef = useRef(selMarker)
  selMarkerRef.current = selMarker
  useEffect(() => { if (selKeyFx) setSelMarker(null) }, [selKeyFx])
  /** 复制下来的片段 */
  const boardRef = useRef<T.ClipBoard | null>(null)
  const isMac = useMemo(() => typeof navigator !== 'undefined' && T.isMacPlatform((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform), [])
  const [pxPerSec, setPxPerSec] = useState(T.ZOOM_DEFAULT)
  const pxRef = useRef(pxPerSec)
  pxRef.current = pxPerSec
  const end = useMemo(() => T.timelineEnd(tracks), [tracks])
  // 缩到最小＝整段放得进可见宽度（片再长也一样）；：右边无上限＝尾巴后永远多留一个可见宽度
  const [viewW, setViewW] = useState(800)
  const zoomFloor = T.zoomFloor(end, viewW)
  const floorRef = useRef(zoomFloor)
  floorRef.current = zoomFloor
  const totalSec = T.canvasSeconds(end, viewW / pxPerSec)

  // ── 播放：播放头沿轨走（rAF 计时·影音元素跟着播放头同步）；点素材格 ⇒ 播放器改看那份原素材（sourceMode）──
  const [now, setNowRaw] = useState(0)
  const nowRef = useRef(0)
  const setNow = useCallback((t: number) => { nowRef.current = t; setNowRaw(t) }, [])
  const [playing, setPlaying] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const sourceModeRef = useRef(sourceMode)
  sourceModeRef.current = sourceMode
  const [srcNow, setSrcNow] = useState(0)
  const sourceRef = useRef<HTMLMediaElement | null>(null)
  /** 每段片段自己一个影音元素（画面轨＝<video>·音频轨＝<audio>·键＝片段编号·只挂 T.prerollClips 那几段）；
   *  laneEls＝每条轨这一刻正在放的那个（滤镜、特效、蒙版拿它当画面） */
  const clipEls = useRef(new Map<string, HTMLMediaElement>())
  const clipElRef = (clipId: string) => (el: HTMLMediaElement | null) => { if (el) clipEls.current.set(clipId, el); else clipEls.current.delete(clipId) }
  const laneEls = useRef(new Map<string, HTMLMediaElement>())
  // 片段音量：元素自己的 volume 只到 100% ⇒ 超过的那几个元素接一个增益节点（Web Audio·接了就一直走它）；
  //   只接同源的（本机储存／预览档的 blob 链接）——云盘链接跨网域·接了会整段没声音 ⇒ 先开到 100%（判法在 T.elementGain）
  const audioCtxRef = useRef<AudioContext | null>(null)
  // 接了节点的元素＝来源 → 声音处理串（降噪／变调／声音效果／声道·同汇出 buildAudioFx）→ 音量节点；处理设定换了只重接中间那串
  type Wired = { src: MediaElementAudioSourceNode; gain: GainNode; fx: AudioFx | null; key: string }
  const wiredEls = useRef(new WeakMap<HTMLMediaElement, Wired>())
  const applyGain = (el: HTMLMediaElement, g: number, aud?: ClipAudio | null) => {
    let w = wiredEls.current.get(el)
    const canWire = (el.currentSrc || el.src).startsWith('blob:')
    const fxKey = audioFxKey(aud)
    const r = T.elementGain(g, { wired: !!w, canWire })
    if (!w && (r.wire || (fxKey && canWire))) {
      try {
        const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext())
        void warmPitch(ctx)
        const gn = ctx.createGain()
        const src = ctx.createMediaElementSource(el)
        src.connect(gn).connect(ctx.destination)
        w = { src, gain: gn, fx: null, key: '' }
        wiredEls.current.set(el, w)
        if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
      } catch { w = undefined }
    }
    if (w && w.key !== fxKey && audioCtxRef.current) {
      try { w.src.disconnect() } catch { /* 已断 */ }
      w.fx?.dispose()
      w.fx = buildAudioFx(audioCtxRef.current, aud)
      if (w.fx) { w.src.connect(w.fx.input); w.fx.output.connect(w.gain) } else w.src.connect(w.gain)
      // 变调处理器还没装好 ⇒ 先不记指纹·下一帧再接一次
      w.key = w.fx && aud?.semi && !w.fx.pitched ? '' : fxKey
    }
    const node = w?.gain
    if (node) { const v = T.elementGain(g, { wired: true, canWire }); if (v.boost !== null && Math.abs(node.gain.value - v.boost) > 1e-4) node.gain.value = v.boost; el.volume = 1 }
    else el.volume = Math.min(1, r.volume)
    // 实际出声的倍数写在元素上（元素 volume×增益节点·排查／真浏览器题读它）
    el.dataset.gain = (el.volume * (node ? node.gain.value : 1)).toFixed(2)
    el.dataset.wired = node ? '1' : '0'
  }
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (ts: number) => {
      const dt = Math.max(0, (ts - last) / 1000)
      last = ts
      const e = T.timelineEnd(tracksRef.current)
      const t = nowRef.current + dt   // 播放头只照自己的时钟走·不跟任何素材
      if (t >= e) { setNow(e); setPlaying(false); return }
      setNow(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, setNow])
  // 预览照轨道状态——隐藏的轨不画也不出声（元素停掉）·静音的轨照放但不出声·上面的画面轨盖下面的（layersAt 由上到下）
  const layers = T.layersAt(tracks, now)
  const layerMedia = (s: T.LayerState) => (s.hit ? media.find((m) => m.id === s.hit!.clip.mediaId) ?? null : null)
  const topVisual = T.topVisualAt(tracks, now)
  useEffect(() => {
    for (const s of layers) {
      // 接下来要放的那几段先载好、停在入点等着（静音·不放）·时间到直接开播；刚放完的停掉
      for (const c of T.prerollClips(s.lane.clips, now)) {
        if (c.id === s.hit?.clip.id) continue
        const pe = clipEls.current.get(c.id), pm = mediaOf(c.mediaId)
        if (!pe || !pm?.url || pm.kind === 'image') continue
        pe.muted = true
        syncMediaEl(pe, pm.url, T.srcAt(c, c.start), false, T.rateAt(c, c.start))
      }
      const el = s.hit ? clipEls.current.get(s.hit.clip.id) : undefined
      if (el) laneEls.current.set(s.lane.id, el); else laneEls.current.delete(s.lane.id)
      if (!el) continue
      const m = layerMedia(s)
      const playable = !!m && !!m.url && m.kind !== 'image' && !s.lane.hidden && !s.hit?.clip.disabled // 停用这段＝不画也不出声
      // 变速＝元素放慢放快（声音变调关着 ⇒ 保持原音高）；片段音量拖着时照即时值；淡入淡出照这一刻乘上去
      const hc = s.hit ? liveClip(s.hit.clip, s.lane.kind) : null
      const rate = hc ? T.rateAt(hc, now) : 1 // 曲线变速：每一刻的瞬间速度
      const keepPitch = !hc?.pitch
      if (el.preservesPitch !== keepPitch) el.preservesPitch = keepPitch
      syncMediaEl(el, !sourceMode && playable ? m.url : null, s.hit?.local ?? 0, playing, rate)
      el.muted = !s.sound
      // 这段的音量
      const nm = hc?.aud?.norm ? normGain(peaks[hc.mediaId], hc.offset, hc.offset + hc.length * T.speedOf(hc)) : 1
      applyGain(el, s.sound && hc ? gainAt(hc, now) * fadeGain(hc, now) * nm : 1, s.sound ? hc?.aud : null)
    }
  })
  const togglePlay = useCallback(() => {
    void audioCtxRef.current?.resume().catch(() => {}) // 增益节点的音讯环境要在按键／点击这一下叫醒
    const src = sourceRef.current
    if (sourceMode && src) { if (src.paused) void src.play().catch(() => {}); else src.pause(); return }
    const e = T.timelineEnd(tracksRef.current)
    if (e <= 0) return
    setSourceMode(false)
    if (!playing && nowRef.current >= e - T.FRAME / 2) setNow(0)
    setPlaying((p) => !p)
  }, [sourceMode, playing, setNow])
  // 分页转到背景 ⇒ 正在播（时间轴或素材预览）就停·切回来⛔ 自动接着播
  useEffect(() => pauseWhenHidden(document, () => {
    setPlaying(false)
    const src = sourceRef.current
    if (src && !src.paused) src.pause()
  }), [])
  /** 逐帧／逐秒（剪映 ←→）：素材预览中 ⇒ 挪那份素材；否则挪播放头 */
  const step = useCallback((dir: 1 | -1, unit: number) => {
    const src = sourceRef.current
    if (sourceMode && src) { src.pause(); src.currentTime = T.stepTime(src.currentTime, dir, src.duration || 0, unit); return }
    setPlaying(false)
    setNow(T.stepTime(nowRef.current, dir, Math.max(T.timelineEnd(tracksRef.current), totalSec), unit))
  }, [sourceMode, setNow, totalSec])
  const seekTimeline = useCallback((t: number) => {
    setSourceMode(false); setPlaying(false)
    setNow(Math.max(0, Math.min(totalSec, T.snapFrame(t))))
  }, [setNow, totalSec])
  const seekTimelineRef = useRef(seekTimeline)
  seekTimelineRef.current = seekTimeline

  // ── 片段编辑：放上轨道、拖位、拉两端修剪、分割、删除 ──
  const clipLen = (m: Pick<Media, 'kind' | 'duration'>) => (m.kind === 'image' ? T.IMAGE_DEFAULT_SECONDS : m.duration)
  const newClip = (m: Media): T.TlClip => ({ id: crypto.randomUUID(), mediaId: m.id, start: 0, length: clipLen(m), offset: 0 })
  // ── 拖素材进轨道：拖着时在「即将占位」处画灰底（落点被占 ⇒ 灰底画在新轨的位置）·放手照同一份落点规划放 ──
  /** 正在拖的素材（种类＋长度）：素材格／云盘树一开始拖就记下（悬停期浏览器不给读拖动资料） */
  const dragMediaRef = useRef<{ kind: MediaKind | 'text' | 'sticker' | 'filter' | 'program'; length: number } | null>(null)
  /** 拖的是特效／转场卡（放到片段／接缝上·不画落点灰底） */
  const dragDecorRef = useRef<'fx' | 'trans' | null>(null)
  /** 正在从库里拖卡（浏览器原生拖放）⇒ 播放头不接滑鼠（转场卡常要放在播放头正压着的接缝上·放在播放头上会被它吃掉） */
  const [dndOn, setDndOn] = useState(false)
  const [ghost, setGhostRaw] = useState<T.DropPlan | null>(null)
  const ghostRef = useRef<T.DropPlan | null>(null)
  const setGhost = useCallback((g: T.DropPlan | null) => {
    const o = ghostRef.current
    if (o === g || (o && g && o.lane === g.lane && o.at === g.at && o.kind === g.kind && Math.abs(o.start - g.start) < 1e-6 && Math.abs(o.length - g.length) < 1e-6)) return
    ghostRef.current = g
    setGhostRaw(g)
  }, [])
  useEffect(() => {
    const start = (e: Event) => {
      setDndOn(true)
      const dt = (e as globalThis.DragEvent).dataTransfer
      let own = ''
      try { own = dt?.getData(DRAG_MIME) ?? '' } catch { /* 读不到当不是 */ }
      const tys = Array.from(dt?.types ?? [])
      dragDecorRef.current = tys.includes(FX_DRAG_MIME) ? 'fx' : tys.includes(TRANS_DRAG_MIME) ? 'trans' : null
      if (dragDecorRef.current) { dragMediaRef.current = null; return }
      // 文本页的卡（默认文本／花字）拖来的 ⇒ 文字轨·缺省 3 秒
      if (Array.from(dt?.types ?? []).includes(TEXT_DRAG_MIME)) { dragMediaRef.current = { kind: 'text', length: TEXT_DEFAULT_SECONDS }; return }
      // 贴纸格拖来的 ⇒ 贴纸轨·缺省 3 秒
      if (Array.from(dt?.types ?? []).includes(VECTOR_DRAG_MIME)) { dragMediaRef.current = { kind: 'image', length: SHAPE_DEFAULT_SECONDS }; return } // 形状／纯色卡 ⇒ 画面轨
      if (Array.from(dt?.types ?? []).includes(STICKER_DRAG_MIME)) { dragMediaRef.current = { kind: 'sticker', length: STICKER_DEFAULT_SECONDS }; return }
      // 滤镜格拖来的 ⇒ 滤镜轨·缺省 3 秒
      if (Array.from(dt?.types ?? []).includes(FILTER_DRAG_MIME)) { dragMediaRef.current = { kind: 'filter', length: FILTER_DEFAULT_SECONDS }; return }
      // 程序包格拖来的 ⇒ 程序轨（拖着时读不到是哪个包 ⇒ 灰底先当 3 秒·放手照包里 defaultLength）
      if (Array.from(dt?.types ?? []).includes(PROGRAM_DRAG_MIME)) { dragMediaRef.current = { kind: 'program', length: 3 }; return }
      const m = own ? mediaRef.current.find((x) => x.id === own) : undefined
      if (m) { dragMediaRef.current = { kind: m.kind, length: clipLen(m) }; return }
      const d = host.drive?.dragInfo(dt) ?? null
      const k = d?.kind ?? null
      if (!d || !k) { dragMediaRef.current = null; return }
      const had = mediaRef.current.find((x) => x.driveId === d.id)
      dragMediaRef.current = { kind: k, length: had ? clipLen(had) : k === 'image' ? T.IMAGE_DEFAULT_SECONDS : GHOST_GUESS_SECONDS }
    }
    const clear = () => { dragMediaRef.current = null; dragDecorRef.current = null; setGhost(null); setSnapLine(null); setDndOn(false) }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => { window.removeEventListener('dragstart', start); window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear) }
  }, [gate, setGhost]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 滑鼠下是哪条轨／最上最下那片空白／灰底新轨那一行（'ghost'） */
  const hintAt = (target: EventTarget | null): T.DropHint | 'ghost' => {
    const n = (target as Element | null)?.closest?.('[data-lane-ghost],[data-lane-id],[data-lane-edge]')
    if (!n) return null
    if (n.hasAttribute('data-lane-ghost')) return 'ghost'
    const id = n.getAttribute('data-lane-id')
    if (id) return { lane: id }
    return { edge: n.getAttribute('data-lane-edge') === 'bottom' ? 'bottom' : 'top' }
  }
  /** 放手／悬停那一刻的落点；滑鼠在灰底新轨那一行 ⇒ 照旧放那条新轨·只换时间；
   *  主轨磁吸开着⇒ 画面素材落到主轨＝插在落点那两段之间（magnetDropPlan）。dropLineRef＝吸住的那条线（拖着时画浅蓝竖线） */
  const dropLineRef = useRef<number | null>(null)
  const planAt = (clientX: number, hint: T.DropHint | 'ghost', kind: MediaKind | 'text' | 'sticker' | 'filter' | 'program', length: number): T.DropPlan | null => {
    const r = rulerRef.current
    if (!r) return null
    const px = pxRef.current
    const pref = tlPrefsRef.current
    const { thr } = snapThresholds(px, pref.snap)
    const s = holdSnap(Math.max(0, (clientX - r.getBoundingClientRect().left) / px), [0], [...T.snapPoints(tracksRef.current, nowRef.current, null), ...markersOf(tracksRef.current)], thr, thr, null)
    const want = s.v
    dropLineRef.current = s.hit?.p ?? null
    const g = ghostRef.current
    if (hint === 'ghost' && g && g.lane === null) return { ...g, start: T.snapFrame(Math.max(0, want)), length }
    const plan = (pref.magnet ? magnetDropPlan : T.planDrop)(tracksRef.current, T.laneKindFor(kind), hint === 'ghost' ? null : hint, want, length)
    if (pref.magnet && plan.lane === T.MAIN_LANE) dropLineRef.current = null   // 插进主轨＝落在插入处·不画对齐线
    return plan
  }
  const onLanesDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (dragDecorRef.current) { e.dataTransfer.dropEffect = 'copy'; setGhost(null); return } // 特效／转场卡：放在片段／接缝上（不画落点）
    const info = dragMediaRef.current
    if (!info) { e.dataTransfer.dropEffect = 'none'; setGhost(null); return }
    e.dataTransfer.dropEffect = 'copy'
    setGhost(planAt(e.clientX, hintAt(e.target), info.kind, info.length))
    setSnapLine(dropLineRef.current)
  }
  const onLanesDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setGhost(null); setSnapLine(null) }
  }
  const onLanesDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setSnapLine(null)
    const x = e.clientX
    const hint = hintAt(e.target)
    const g = ghostRef.current
    // 特效卡放到画面轨的片段上 ⇒ 标在那段身上；转场卡放到接缝附近 ⇒ 标在那个接缝
    const fxDrop = e.dataTransfer.getData(FX_DRAG_MIME), trDrop = e.dataTransfer.getData(TRANS_DRAG_MIME)
    if (fxDrop || trDrop) {
      setGhost(null)
      const laneId = hint && hint !== 'ghost' && 'lane' in hint ? hint.lane : null
      const lane = laneId ? tracksRef.current.find((l) => l.id === laneId) ?? null : null
      const rr = rulerRef.current
      const at = rr ? Math.max(0, (x - rr.getBoundingClientRect().left) / pxRef.current) : 0
      if (fxDrop) applyEffect(lane ? T.clipAt(lane.clips, at)?.clip.id ?? null : null, fxDrop)
      else applyTransition(lane ? seamNear(lane, at, Math.max(0.5, 24 / pxRef.current)) : null, trDrop)
      return
    }
    // 素材格拖来的 ⇒ 直接用；云盘树拖来的 ⇒ 先进素材（影音图档才收）
    const txd = e.dataTransfer.getData(TEXT_DRAG_MIME)
    if (txd) {
      // 文本页的卡拖进轨道 ⇒ 照同一份落点规划放一段字（花字卡＝套那款·默认文本＝素白字·放完选起来）
      setGhost(null)
      ghostRef.current = g
      const plan = planAt(x, hint, 'text', TEXT_DEFAULT_SECONDS)
      ghostRef.current = null
      if (!plan) return
      const c = newTextClip(crypto.randomUUID(), t('vedit_text_default'), txd !== TEXT_DRAG_PLAIN && fancyById(txd) ? txd : null)
      edit(T.applyDrop(tracksRef.current, plan, c, crypto.randomUUID()))
      setSel([c.id]); setSourceMode(false)
      return
    }
    const vec = e.dataTransfer.getData(VECTOR_DRAG_MIME)
    const vc = vec ? vectorClipOf(vec) : null
    if (vc) {
      // 形状／纯色卡拖进轨道 ⇒ 画面轨·照同一份落点规划（放完选起来）
      setGhost(null)
      ghostRef.current = g
      const plan = planAt(x, hint, 'image', vc.length)
      ghostRef.current = null
      if (!plan) return
      edit(T.applyDrop(tracksRef.current, plan, vc, crypto.randomUUID()))
      setSel([vc.id]); setSourceMode(false)
      return
    }
    const stk = e.dataTransfer.getData(STICKER_DRAG_MIME)
    if (stk && stickerById(stk)) {
      // 贴纸拖进轨道 ⇒ 照同一份落点规划放一段贴纸（放完选起来）
      setGhost(null)
      ghostRef.current = g
      const plan = planAt(x, hint, 'sticker', STICKER_DEFAULT_SECONDS)
      ghostRef.current = null
      if (!plan) return
      const c = newStickerClip(crypto.randomUUID(), stk)
      edit(T.applyDrop(tracksRef.current, plan, c, crypto.randomUUID()))
      setSel([c.id]); setSourceMode(false)
      return
    }
    const prg = e.dataTransfer.getData(PROGRAM_DRAG_MIME)
    const prgBundle = prg ? programBundleOf(prg) : null
    if (prgBundle) {
      // 程序包拖进轨道 ⇒ 照同一份落点规划放一段程序片段（放完选起来）
      setGhost(null)
      ghostRef.current = g
      const c = newProgramClip(crypto.randomUUID(), prgBundle)
      const plan = planAt(x, hint, 'program', c.length)
      ghostRef.current = null
      if (!plan) return
      edit(T.applyDrop(tracksRef.current, plan, c, crypto.randomUUID()))
      setSel([c.id]); setSourceMode(false)
      return
    }
    const flt = e.dataTransfer.getData(FILTER_DRAG_MIME)
    if (flt && filterById(flt)) {
      // 滤镜拖进轨道 ⇒ 照同一份落点规划放一段滤镜（放完选起来）
      setGhost(null)
      ghostRef.current = g
      const plan = planAt(x, hint, 'filter', FILTER_DEFAULT_SECONDS)
      ghostRef.current = null
      if (!plan) return
      const c = newFilterClip(crypto.randomUUID(), flt)
      edit(T.applyDrop(tracksRef.current, plan, c, crypto.randomUUID()))
      setSel([c.id]); setSourceMode(false)
      return
    }
    const own = e.dataTransfer.getData(DRAG_MIME)
    const fromDrive = own ? null : host.drive?.dragInfo(e.dataTransfer) ?? null
    const driveFile = fromDrive && host.drive ? await host.drive.fileById(fromDrive.id) : null // 对话框「產物」拖来的不在云盘树那页 ⇒ 按编号查
    const m = own ? mediaOf(own) : driveFile && driveFile.kind ? await addDriveMedia(driveFile) : null
    setGhost(null)
    if (!m) return
    ghostRef.current = g // 灰底新轨那一行放手 ⇒ 照灰底那条
    const plan = planAt(x, hint, m.kind, clipLen(m))
    ghostRef.current = null
    const stems = stemsOf(m) // 编曲素材 ⇒ 展开成几条音频轨、绑一组
    if (plan && stems) { placeStems(stems, plan.start, plan); return }
    if (plan) edit((tlPrefsRef.current.magnet ? magnetDrop : T.applyDrop)(tracksRef.current, plan, newClip(m), crypto.randomUUID()))   // 磁吸开着进主轨＝插进去
  }
  /** 编曲素材的分轨（都还在、都有长度才算·缺一份 ⇒ 当普通音频放混好那份） */
  const stemsOf = useCallback((m: Media): Media[] | null => {
    if (!m.stems?.length) return null
    const out = m.stems.map((id) => mediaRef.current.find((x) => x.id === id))
    return out.every((x) => !!x && !x.missing && x.duration > 0) ? (out as Media[]) : null
  }, [])
  /** 编曲素材放上轨道：每份分轨一条音频轨·同一秒开始·绑成一组·选中整组 */
  const placeStems = useCallback((stems: Media[], at: number, first: T.DropPlan | null) => {
    const r = dropStems(tracksRef.current, stems.map((s) => ({ mediaId: s.id, length: clipLen(s) })), at, first, { clip: () => crypto.randomUUID(), lane: () => crypto.randomUUID(), group: crypto.randomUUID() })
    edit(r.tracks)
    setSel(r.ids); setSourceMode(false)
  }, [edit])
  /** 命令化第二期：双击放轨＝clip.add（不给时间与轨＝appendMedia）——长度量好了（图片／量过的影音）才走命令；
   *  回 true＝办完了（放好并选起、播放头到片头；或罩着已提示）·false＝长度没量到／命令不收 ⇒ 调用方照原算法 */
  const appendByCmd = useCallback((m: Media): boolean => {
    if (m.kind !== 'image' && !(m.duration > 0)) return false
    const r = runCmd([{ command: 'clip.add', params: { media: m.id } }])
    if (!r.ok) return r.locked
    const id = r.results[0].id!
    const f = T.findClip(r.tracks, id)
    setSourceMode(false); setPlaying(false)
    if (f) { setSel([id]); setNow(f.clip.start) }
    return true
  }, [runCmd, setNow])
  // 双击素材放上轨道 ⇒ 播放器回到时间轴（照剪映·不停在单份素材预览）·播放头跳到新片段开头·选中它
  const appendToTrack = useCallback((m: Media) => {
    const stems = stemsOf(m) // 编曲素材双击 ⇒ 接在音频区最尾巴·展开成一组
    if (stems) { placeStems(stems, Math.max(0, ...tracksRef.current.filter((l) => l.kind === 'audio').flatMap((l) => l.clips.map((c) => c.start + c.length))), null); return }
    if (appendByCmd(m)) return // 命令化第二期：clip.add
    const c = newClip(m)
    const next = T.appendMedia(tracksRef.current, T.laneKindFor(m.kind), c, crypto.randomUUID())
    edit(next)
    const f = T.findClip(next, c.id)
    setSourceMode(false); setPlaying(false)
    if (f) { setSel([c.id]); setNow(f.clip.start) }
  }, [edit, appendByCmd, setNow, stemsOf, placeStems])
  // 编曲弹窗「放进轨道」⇒ 算好的 WAV 先进素材（照本机汇入·会背景上传）·再放在播放头那一秒的音频轨（被占 ⇒ 新开一条）·选中它
  const exportArrange = useCallback(async (f: File) => {
    const added = await onPick([f])
    const m = added[0]
    if (!m) return
    const c = newClip(m)
    const plan = T.planDrop(tracksRef.current, 'audio', null, T.snapFrame(Math.max(0, nowRef.current)), c.length)
    edit(T.applyDrop(tracksRef.current, plan, c, crypto.randomUUID()))
    setSourceMode(false); setSel([c.id])
  }, [onPick, edit])
  // ── 音频页签（内建音效、录音）、文字「朗读」——都照本机汇入进素材区·放在 at 那一秒的音频轨（被占 ⇒ 往下开一条）·选起来 ──
  /** fallbackLen＝素材读不出长度时用的秒数（浏览器录的 webm 常没写长度） */
  const placeAudio = useCallback(async (f: File, at: number, fallbackLen?: number) => {
    const added = await onPick([f])
    const m = added[0]
    if (!m) return null
    const c0 = newClip(m)
    const len = Number.isFinite(c0.length) && c0.length > 0 ? c0.length : Math.max(T.MIN_CLIP, fallbackLen ?? 1)
    const c = { ...c0, length: T.snapFrame(len) }
    const plan = T.planDrop(tracksRef.current, 'audio', null, T.snapFrame(Math.max(0, at)), c.length)
    edit(T.applyDrop(tracksRef.current, plan, c, crypto.randomUUID()))
    setSourceMode(false); setSel([c.id])
    return c.id
  }, [onPick, edit])
  const audioLib = useMemo(() => ({
    onAddSfx: (id: string) => {
      const d = sfxById(id)
      if (!d) return
      const pcm = d.f(SFX_RATE)
      void placeAudio(new File([new Uint8Array(encodeWav([pcm, pcm], SFX_RATE))], `${d.name[language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw']}.wav`, { type: 'audio/wav' }), nowRef.current, d.seconds)
    },
    onRecorded: (f: File) => { void placeAudio(f, nowRef.current) },
  }), [placeAudio, language])
  /** 朗读：选中那段字 ⇒ 网站的朗读⇒ mp3 放在那段字开头的音频轨 */
  const [ttsBusy, setTtsBusy] = useState(false)
  const [ttsMsg, setTtsMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const runTts = useCallback(async (o: Record<string, unknown>) => {
    const id = editableTextIds(tracksRef.current, selRef.current).slice(-1)[0]
    const f = id ? T.findClip(tracksRef.current, id) : null
    const text = f?.clip.text?.content.trim() ?? ''
    const tts = host.tts
    if (!f || !text || !tts) return
    setTtsBusy(true); setTtsMsg(null)
    try {
      const r = await tts.speak(o, text)
      if (!r.ok) {
        const k: TKey = r.code === 'unreadable' ? 'vedit_tts_err_unreadable' : r.code === 'credits' ? 'vedit_tts_err_credits' : r.code === 'blocked' ? 'vedit_tts_err_blocked' : r.code === 'rate' ? 'vedit_tts_err_rate' : 'vedit_tts_err'
        setTtsMsg({ ok: false, text: t(k) }); return
      }
      await placeAudio(new File([r.blob], r.fileName, { type: 'audio/mpeg' }), f.clip.start, r.ms > 0 ? r.ms / 1000 : undefined)
      setTtsMsg({ ok: true, text: t('vedit_tts_done').replace('{n}', r.cost) })
    } catch { setTtsMsg({ ok: false, text: t('vedit_tts_err') }) } finally { setTtsBusy(false) }
  }, [placeAudio, t]) // eslint-disable-line react-hooks/exhaustive-deps
  // 文字用到的站上字体（切片按需载）——轨道一变就补挂·画面叠字才不会先用退回字体
  const textFontKey = webFontsIn(T.allClips(tracks).map((c) => c.text)).join(',')
  useEffect(() => { if (textFontKey) ensureFontsLoaded(textFontKey.split(',')) }, [textFontKey])
  // 「合成素材」：编曲算好的 WAV 只放进素材区（不放轨道）
  const kindOfMedia = useCallback((id: string) => mediaOf(id)?.kind, [mediaOf])
  // 混好那份带着几份分轨一起进来·分轨藏起来（素材区只列混好那份·标「多轨」）
  //   原曲已在素材区（汇入过那首／同一首再拆一次）⇒ 重用那张·只补分轨（⛔ 再多一张同名原曲）
  const addArrangeMedia = useCallback(async (f: File, stems?: File[]) => {
    const had = reusableMix(mediaRef.current, f, (id) => filesRef.current.get(id))
    const added = await onPick(had ? (stems ?? []) : [f, ...(stems ?? [])])
    const mixId = had ?? (added[0]?.name === f.name ? added[0].id : null)
    const parts = had ? added : added.slice(1)
    if (!mixId || !parts.length) return
    const link = (m: Media): Media => (m.id === mixId ? { ...m, stems: parts.map((x) => x.id) } : parts.some((x) => x.id === m.id) ? { ...m, stemOf: mixId } : m)
    mediaRef.current = mediaRef.current.map(link)
    setMedia((prev) => prev.map(link))
    setSelected(mixId)
  }, [onPick])
  // 混好那份复制成一份普通音频（不带分轨）放在旁边
  const [mediaMenu, setMediaMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const mixdown = useCallback(async (id: string) => {
    setMediaMenu(null)
    const m = mediaRef.current.find((x) => x.id === id)
    if (!m) return
    let blob: Blob | null = filesRef.current.get(id) ?? await host.media.readOriginal(m, projRef.current?.id ?? null)
    if (!blob && m.url) blob = await fetch(m.url).then((r) => (r.ok ? r.blob() : null), () => null)
    if (!blob) { setNotice(t('vedit_mixdown_fail')); return }
    const added = await onPick([new File([blob], mixdownName(m.name, arrLang(language)), { type: 'audio/wav' })])
    if (added[0]) { setSelected(added[0].id); setNotice(t('vedit_mixdown_done')) }
  }, [onPick, t, language]) // eslint-disable-line react-hooks/exhaustive-deps
  // 选中那几段照时间轴位置混成一段声音进素材区
  const [subBusy, setSubBusy] = useState(false)
  /** 汇出成片：汇出要的素材／程序包来源（下面程序包那段定义后才填）·播放器比例（成片比例） */
  const exportEnvRef = useRef<(() => ExportEnv) | null>(null)
  const stageRatioRef = useRef<number | null>(null)
  const makeSubClip = useCallback(async (ids: readonly string[]) => {
    const plan = subClipPlan(tracksRef.current, ids, kindOfMedia)
    // 汇出做好了 ⇒ 选到的有画面就照汇出那套画成一支 MP4（画面＋声音）进素材区；浏览器编不了影片 ⇒ 照旧只合声音
    if (plan?.picture && canExportVideo() && exportEnvRef.current) {
      if (subBusy) return
      setSubBusy(true); setNotice(t('vedit_subclip_busy'))
      try {
        const sz = exportSize(stageRatioRef.current, '1080')
        const r = await renderVideo(exportEnvRef.current(), { range: { from: plan.start, to: plan.end, only: new Set(ids) }, w: sz.w, h: sz.h })
        const firstId = ids.map((id) => T.findClip(tracksRef.current, id)?.clip.mediaId).find((x): x is string => !!x)
        const name = subClipName((firstId && mediaOf(firstId)?.name) || '', new Date(), arrLang(language)).replace(/\.wav$/, '.mp4')
        const added = await onPick([new File([r.blob], name, { type: 'video/mp4' })])
        if (added[0]) setSelected(added[0].id)
        setNotice(t('vedit_subclip_done'))
      } catch { setNotice(t('vedit_subclip_fail')) } finally { setSubBusy(false) }
      return
    }
    if (!plan || !plan.segs.length) { setNotice(t('vedit_subclip_silent')); return }
    if (subBusy) return
    setSubBusy(true); setNotice(t('vedit_subclip_busy'))
    try {
      const first = mediaOf(plan.segs[0].mediaId)?.name ?? ''
      const r = await renderSubClip(plan, (id) => { const m = mediaOf(id); return m && !m.missing && m.url ? m.url : null })
      const added = await onPick([new File([r.wav as BlobPart], subClipName(first, new Date(), arrLang(language)), { type: 'audio/wav' })])
      if (added[0]) setSelected(added[0].id)
      setNotice(t(plan.picture ? 'vedit_subclip_done_picture' : 'vedit_subclip_done'))
    } catch { setNotice(t('vedit_subclip_fail')) } finally { setSubBusy(false) }
  }, [kindOfMedia, mediaOf, onPick, t, language, subBusy])
  // 选中那几段（都在音频轨）照时间轴位置混成一段（同合成子素材）·
  // 放回轨道取代原来那几段（最早那段所在的轨）·新档也进素材区；有画面的段（影片汇出还没开放）⇒ 说明合不了
  const mergeClips = useCallback(async (ids: readonly string[]) => {
    const why = mergeBlock(tracksRef.current, ids)
    if (why === 'few') { setNotice(t('vedit_merge_few')); return }
    // 有画面 ⇒ 照汇出那套把选中那几段（画面＋声音）画成一支 MP4·放回画面轨取代原来那几段
    if (why === 'picture') {
      const pp = subClipPlan(tracksRef.current, ids, kindOfMedia)
      if (!pp || !canExportVideo() || !exportEnvRef.current) { setNotice(t('vedit_merge_picture')); return }
      if (subBusy) { setNotice(t('vedit_merge_busy')); return } // 还在合 ⇒ 说一声（从前再点没反应）
      setSubBusy(true); setNotice(t('vedit_merge_busy'))
      try {
        const sz = exportSize(stageRatioRef.current, '1080')
        const r = await renderVideo(exportEnvRef.current(), { range: { from: pp.start, to: pp.end, only: new Set(ids) }, w: sz.w, h: sz.h })
        const firstId = ids.map((id) => T.findClip(tracksRef.current, id)?.clip.mediaId).find((x): x is string => !!x)
        const name = subClipName((firstId && mediaOf(firstId)?.name) || '', new Date(), arrLang(language), 'merge').replace(/\.wav$/, '.mp4')
        const added = await onPick([new File([r.blob], name, { type: 'video/mp4' })])
        const m = added[0]
        if (!m) { setNotice(t('vedit_subclip_fail')); return }
        const length = Math.min(T.snapFrame(pp.end - pp.start), m.duration > 0 ? m.duration : Infinity)
        const out = replaceWithMerged(tracksRef.current, ids, { id: crypto.randomUUID(), mediaId: m.id, start: T.snapFrame(pp.start), length, offset: 0 }, crypto.randomUUID(), 'visual')
        edit(out.tracks)
        setSel([out.id]); setSelected(m.id)
        setNotice(t('vedit_merge_done'))
      } catch { setNotice(t('vedit_subclip_fail')) } finally { setSubBusy(false) }
      return
    }
    const plan = subClipPlan(tracksRef.current, ids, kindOfMedia)
    if (!plan || !plan.segs.length) { setNotice(t('vedit_subclip_silent')); return }
    if (subBusy) return
    setSubBusy(true); setNotice(t('vedit_merge_busy'))
    try {
      const first = mediaOf(plan.segs[0].mediaId)?.name ?? ''
      const r = await renderSubClip(plan, (id) => { const m = mediaOf(id); return m && !m.missing && m.url ? m.url : null })
      const added = await onPick([new File([r.wav as BlobPart], subClipName(first, new Date(), arrLang(language), 'merge'), { type: 'audio/wav' })])
      const m = added[0]
      if (!m) { setNotice(t('vedit_subclip_fail')); return }
      const length = Math.min(T.snapFrame(plan.end - plan.start), m.duration > 0 ? m.duration : Infinity)
      const out = replaceWithMerged(tracksRef.current, ids, { id: crypto.randomUUID(), mediaId: m.id, start: T.snapFrame(plan.start), length, offset: 0 }, crypto.randomUUID())
      edit(out.tracks)
      setSel([out.id]); setSelected(m.id)
      setNotice(t('vedit_merge_done'))
    } catch { setNotice(t('vedit_subclip_fail')) } finally { setSubBusy(false) }
  }, [kindOfMedia, mediaOf, onPick, t, language, subBusy, edit])
  // ── 选中片段的动作──
  const deleteClips = useCallback((ids: readonly string[]) => {
    if (!ids.length) return
    const tr = tracksRef.current
    if (!ids.some((id) => T.editable(tr, id))) { setNotice(t('vedit_lane_locked')); return }
    // 命令化第二期：clip.delete＝pruneGroups(T.removeClips(tr, ids))（组里删到只剩一段 ⇒ 那段不再算组·锁轨上的不删）
    runCmd([{ command: 'clip.delete', params: { clips: ids.filter((id) => T.editable(tr, id)) } }])
    setSel([])
  }, [runCmd, t])
  const deletePicked = useCallback(() => {
    // 选中的是接缝转场 ⇒ 删转场（片段不动·clip.setTransition null＝removeTransition）
    const st = selTransRef.current
    if (st) { const r = runCmd([{ command: 'clip.setTransition', params: { clip: st, transition: null } }]); if (r.ok || r.locked) setSelTrans(null); else setNotice(t('vedit_lane_locked')); return }
    // 选中的是时间尺上的标记 ⇒ 删那面旗（marker.remove＝removeMarker）
    const mk = selMarkerRef.current
    if (mk !== null) { runCmd([{ command: 'marker.remove', params: { at: mk } }]); setSelMarker(null); return }
    deleteClips(selRef.current)
  }, [deleteClips, runCmd, t])
  const copyClips = useCallback((ids: readonly string[]) => {
    const b = T.copyClips(tracksRef.current, ids)
    if (b) boardRef.current = b
    return !!b
  }, [])
  const cutClips = useCallback((ids: readonly string[]) => { if (copyClips(ids)) deleteClips(ids) }, [copyClips, deleteClips])
  /** 贴上：贴完选取贴上去的那几段 */
  const pasteClips = useCallback(() => {
    const b = boardRef.current
    if (!b) return
    const r = T.pasteClips(tracksRef.current, b, nowRef.current, uid, uid)
    edit(r.tracks)
    setSel(r.ids)
  }, [edit])
  const duplicateClips = useCallback((ids: readonly string[]) => {
    const r = T.duplicateClips(tracksRef.current, ids, uid, uid)
    if (!r.ids.length) return
    edit(r.tracks)
    setSel(r.ids)
  }, [edit])
  // 命令化第二期：Ctrl+B＝timeline.split（带选取＝只切选中的、播放头压到的那几段·都没压到 ⇒ 切播放头下全部·同 T.splitAtPlayhead）
  const splitClips = useCallback((ids: readonly string[]) => {
    runCmd([{ command: 'timeline.split', params: { at: nowRef.current, ...(ids.length ? { clips: [...ids] } : {}) } }])
  }, [runCmd])
  const splitNow = useCallback(() => splitClips(selRef.current), [splitClips])
  // ── 定格／倒放／镜像／复制粘贴属性／黑场白场（算法在 _lib/vedit-clip-ops.pure.ts）──
  const isVideoClip = useCallback((c: T.TlClip) => kindOfMedia(c.mediaId) === 'video', [kindOfMedia])
  /** 定格：选中的（缺＝播放头底下最上层那段）影片在播放头停 3 秒·后面的往后推·选起定格那段 */
  const freezeTarget = (tr: T.Tracks, ids: readonly string[], at: number) =>
    ids.find((id) => canFreeze(tr, id, at, isVideoClip)) ?? tr.flatMap((l) => l.clips).find((c) => canFreeze(tr, c.id, at, isVideoClip))?.id ?? null
  const freezeNow = useCallback((ids: readonly string[] = selRef.current) => {
    const id = freezeTarget(tracksRef.current, ids, nowRef.current)
    if (!id) { setNotice(t('vedit_freeze_need')); return }
    const r = freezeFrame(tracksRef.current, id, nowRef.current, { freeze: uid(), right: uid() })
    if (!r) return
    edit(r.tracks); setSel([r.id])
  }, [edit, isVideoClip, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const reverseNow = useCallback((ids: readonly string[] = selRef.current) => {
    const next = toggleReverse(tracksRef.current, ids, kindOfMedia)
    if (next !== tracksRef.current) edit(next)
  }, [edit, kindOfMedia])
  const mirrorNow = useCallback((ids: readonly string[] = selRef.current) => {
    const next = toggleFlip(tracksRef.current, ids, 'h')
    if (next !== tracksRef.current) edit(next)
  }, [edit])
  /** 属性剪贴簿（剪映 Ctrl+Alt+C／V）：跟片段剪贴簿分开 */
  const attrBoardRef = useRef<AttrPack | null>(null)
  const copyAttrsNow = useCallback((ids: readonly string[] = selRef.current) => {
    const p = copyAttrs(tracksRef.current, ids)
    if (!p) return false
    attrBoardRef.current = p; setNotice(t('vedit_attr_copied'))
    return true
  }, [t])
  const pasteAttrsNow = useCallback((ids: readonly string[] = selRef.current) => {
    const p = attrBoardRef.current
    if (!p || !ids.length) return false
    const next = pasteAttrs(tracksRef.current, ids, p, { sound: (c) => T.hasSound(c, kindOfMedia), speed: (c) => kindOfMedia(c.mediaId) !== 'image' })
    if (next !== tracksRef.current) edit(next)
    return true
  }, [edit, kindOfMedia])
  /** 黑场／白场：画一张 1920×1080 纯色图进素材区（照本机汇入·会背景上传）·放在播放头那一秒的画面轨（被占 ⇒ 往上开一条）·3 秒 */
  const solidNow = useCallback(async (k: keyof typeof SOLID_COLORS) => {
    const cv = Object.assign(document.createElement('canvas'), { width: 1920, height: 1080 })
    const g = cv.getContext('2d')!
    g.fillStyle = SOLID_COLORS[k]; g.fillRect(0, 0, cv.width, cv.height)
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'))
    if (!blob) return
    const added = await onPick([new File([blob], solidFileName(k), { type: 'image/png' })])
    const m = added[0]
    if (!m) return
    const c = { ...newClip(m), length: SOLID_SECONDS }
    const plan = T.planDrop(tracksRef.current, 'visual', null, T.snapFrame(Math.max(0, nowRef.current)), c.length)
    edit(T.applyDrop(tracksRef.current, plan, c, crypto.randomUUID()))
    setSourceMode(false); setSel([c.id])
  }, [onPick, edit])
  /**  调节层（剪映「调节」拖上轨道）——在播放头放 3 秒·放在滤镜轨（被占 ⇒ 往上开一条）·选起来·右栏只有「调整」页 */
  const adjustLayerNow = useCallback(() => {
    const r = addAdjustLayer(tracksRef.current, nowRef.current, { clip: crypto.randomUUID(), lane: crypto.randomUUID() })
    edit(r.tracks); setSourceMode(false); setSel([r.id])
  }, [edit])
  // ── 时间轴上方工具列──
  /** 换游标模式：进刀片 ⇒ 一句提示怎么回来 */
  const pickTool = useCallback((next: EditTool) => {
    if (next === toolRef.current) return
    setTool(next)
    if (next === 'blade') setNotice(t('vedit_blade_hint'))
  }, [t])
  /** 向左／向右全选（[ ／ ]）：选中播放头左边／右边的所有片段（锁了的轨不选） */
  const selectSideNow = useCallback((side: 'left' | 'right') => {
    setSel(selectSide(tracksRef.current, nowRef.current, side)); setSelTrans(null); setSelMarker(null)
  }, [])
  /** 向左／向右裁剪（Q ／ W）：选中的、播放头压在身上的那几段·切在播放头删掉那一边；没有能裁的 ⇒ false（键不吃） */
  const trimNow = useCallback((side: 'left' | 'right') => {
    const tr = tracksRef.current
    if (!trimTargets(tr, selRef.current, nowRef.current).length) return false
    edit(trimAt(tr, selRef.current, nowRef.current, side))
    return true
  }, [edit])
  /** 加标记（M）：在播放头插一面旗（那一帧已经有 ⇒ 不叠）·选中它 */
  const markerNow = useCallback(() => {
    const at = T.snapFrame(nowRef.current)
    runCmd([{ command: 'marker.add', params: { at } }]) // 命令化第二期：marker.add＝addMarker（那一帧已有／到上限 ⇒ 不动）
    setSelMarker(at); setSel([]); setSelTrans(null)
  }, [runCmd])
  /** 刀片点在片段上（capture 阶段先接走·片段本体／拉边／音量线都不再收这一下）：从点的位置切开这段 */
  const onBladeDown = (lane: T.Lane, clip: T.TlClip) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    if (lane.locked) { setNotice(t('vedit_lane_locked')); return }
    if (aiLockedRef.current) { aiNoteRef.current(); return }
    const r = rulerRef.current
    if (r) runCmd([{ command: 'clip.split', params: { clip: clip.id, at: (e.clientX - r.getBoundingClientRect().left) / pxRef.current } }]) // 命令化第二期：clip.split＝bladeSplit（离两头不到一帧 ⇒ 不切）
  }
  /** 刀片模式：滑鼠在片段上 ⇒ 一条竖线标出会切在哪（直接改样式·不重画整页） */
  const bladeLineRef = useRef<HTMLDivElement>(null)
  const onBladeHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = bladeLineRef.current, r = rulerRef.current
    if (!el || !r) return
    const on = toolRef.current === 'blade' && !!(e.target as Element).closest('[data-clip-id]')
    el.style.display = on ? 'block' : 'none'
    if (on) el.style.left = `${LABEL_W + T.snapFrame((e.clientX - r.getBoundingClientRect().left) / pxRef.current) * pxRef.current}px`
  }
  const onBladeLeave = () => { if (bladeLineRef.current) bladeLineRef.current.style.display = 'none' }
  // 命令化第二期：分离音频＝clip.detachAudio（只送分离得了的那几段·同 T.detachAudio 自己略过的）
  const detachClips = useCallback((ids: readonly string[]) => {
    const can = ids.filter((id) => T.canDetach(tracksRef.current, id, kindOfMedia))
    if (can.length) runCmd([{ command: 'clip.detachAudio', params: { clips: can } }])
  }, [runCmd, kindOfMedia])
  // 静音／停用＝clip.setFlag：同 T.toggleClipFlag——没锁、适用的那几段全都已经是 ⇒ 全部取消；否则全部设上
  const flagClips = useCallback((ids: readonly string[], flag: T.ClipFlag) => {
    const tr = tracksRef.current
    const live = ids.filter((id) => { const f = T.findClip(tr, id); return !!f && !f.lane.locked && (flag !== 'muted' || T.hasSound(f.clip, kindOfMedia)) })
    if (!live.length) return
    runCmd([{ command: 'clip.setFlag', params: { clips: live, flag, on: !live.every((id) => !!T.findClip(tr, id)!.clip[flag]) } }])
  }, [runCmd, kindOfMedia])
  /** 替换素材：先开小窗挑一份（replaceFor＝要换的那几段） */
  const [replaceFor, setReplaceFor] = useState<readonly string[] | null>(null)
  const replaceWith = useCallback((m: Media) => {
    const ids = replaceFor ?? []
    setReplaceFor(null)
    const r = T.replaceMedia(tracksRef.current, ids, { id: m.id, kind: m.kind, duration: m.duration })
    if (r.replaced) edit(r.tracks)
    if (r.skipped) setNotice(t('vedit_replace_skipped').replace('{n}', String(r.skipped)))
  }, [replaceFor, edit, t])
  /** 在素材区找到它：切到素材页·选中那份素材·捲到看得到并闪一下 */
  const [findFlash, setFindFlash] = useState<string | null>(null)
  useEffect(() => { if (!findFlash) return; const h = setTimeout(() => setFindFlash(null), 1600); return () => clearTimeout(h) }, [findFlash])
  const findInMedia = useCallback((ids: readonly string[]) => {
    const f = ids.length ? T.findClip(tracksRef.current, ids[0]) : null
    if (!f) return
    setTopTab('media'); setSelected(f.clip.mediaId); setFindFlash(f.clip.mediaId)
    requestAnimationFrame(() => document.querySelector(`[data-media-id="${CSS.escape(f.clip.mediaId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [])
  // ── 文字片段＋花字库：点一款花字 ⇒ 选中的文字都套这款·没选文字 ⇒ 在播放头新加一段套好的（选起来）；
  //   播放器上的字能拖位置、拉右下角改大小、双击改字（算法在 _lib/vedit-text.pure.ts）──
  const pickFancy = useCallback((id: string) => {
    setSourceMode(false)
    // 命令化第二期：没选文字 ⇒ 在播放头新加一段套好的＝text.add（同 applyFancy 那条 addTextAt 落点）；选了文字 ⇒ 照原算法换款
    if (fancyById(id) && !editableTextIds(tracksRef.current, selRef.current).length) {
      const a = runCmd([{ command: 'text.add', params: { content: t('vedit_text_default'), at: nowRef.current, fancy: id } }])
      if (a.ok) setSel([a.results[0].id!])
      if (a.ok || a.locked) return
    }
    const r = applyFancy(tracksRef.current, selRef.current, id, nowRef.current, { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID(), content: t('vedit_text_default') })
    if (r.tracks !== tracksRef.current) edit(r.tracks)
    if (r.added) setSel(r.ids)
  }, [edit, runCmd, t])
  // 默认文本＝播放头加一段素白字（选起来·双击改字）；
  //   导入本地字幕＝读 SRT／VTT（UTF-8 读不了按介面语言当 Big5／GBK）·一句一段排上一条文字轨·字在画面下方
  const addPlainText = useCallback(() => {
    setSourceMode(false)
    // 命令化第二期：text.add（不给轨＝addTextAt 同一份落点规划·同 addDefaultText）
    const a = runCmd([{ command: 'text.add', params: { content: t('vedit_text_default'), at: nowRef.current } }])
    if (a.ok) { setSel([a.results[0].id!]); return }
    if (a.locked) return
    const r = addDefaultText(tracksRef.current, nowRef.current, { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID(), content: t('vedit_text_default') })
    edit(r.tracks); setSel([r.id])
  }, [edit, runCmd, t])
  const importSubtitles = useCallback(async (file: File) => {
    setSourceMode(false)
    if (file.size > SUBTITLE_MAX_BYTES) { setNotice(t('vedit_sub_too_big')); return }
    const cues = parseSubtitles(decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer()), language))
    const r = addSubtitles(tracksRef.current, cues, { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID() })
    if (!r.ids.length) { setNotice(t('vedit_sub_none')); return }
    edit(r.tracks); setSel([])
    setNotice(t('vedit_sub_done').replace('{n}', String(r.ids.length)))
  }, [edit, t, language])
  importSubsRef.current = importSubtitles
  // （「在网页里下载识别模型，用你电脑的显卡直接在浏览器里跑」·
  // 「云端的之后再说」）：字幕→識別字幕＝网页里载 whisper turbo q4、用这台电脑的显卡识别（⛔ 上传声音）·时间轴会出声的片段混成一条·
  // 分段识别（看得到进度、能取消）·一句一段排上文字轨（同匯入本機字幕）。「有壳给壳」那条等壳带识别引擎再接。
  // 模型与程式库从哪下由宿主给（设了模型镜像 ⇒ 程式库也走同站镜像）
  const asrModelSrc = host.asr.modelHost
  const asrNpm = host.asr.npmBase
  const [asrGpu, setAsrGpu] = useState<boolean | null>(null)
  useEffect(() => {
    if (topTab !== 'caption' || asrGpu !== null) return
    let dead = false
    void hasWebGpu().then((v) => { if (!dead) setAsrGpu(v) })
    return () => { dead = true }
  }, [topTab, asrGpu])
  const [asrPhase, setAsrPhase] = useState<AsrPhase>({ kind: 'idle' })
  const asrRef = useRef<AsrEngine | null>(null)
  const asrRunRef = useRef(0)
  useEffect(() => () => { asrRunRef.current++; asrRef.current?.dispose() }, [])
  const cancelAsr = useCallback(() => { asrRunRef.current++; asrRef.current?.dispose(); asrRef.current = null; setAsrPhase({ kind: 'idle' }) }, [])
  const startAsr = useCallback(async (scope: AsrScope, lang: AsrLang) => {
    if (!asrModelSrc) return
    setSourceMode(false)
    const run = ++asrRunRef.current
    const live = () => asrRunRef.current === run
    const src = asrSources(tracksRef.current, (id) => mediaOf(id)?.kind, scope === 'sel' ? selRef.current : undefined)
    const span = asrSpan(src)
    if (!span) { setNotice(t('vedit_asr_no_audio')); return }
    if (span.end - span.start > ASR_MAX_SEC) { setNotice(t('vedit_asr_too_long')); return }
    try {
      if (!asrRef.current) asrRef.current = new AsrEngine(asrModelSrc, asrNpm, (l, tot) => { if (live()) setAsrPhase({ kind: 'model', loaded: l, total: tot }) })
      const eng = asrRef.current
      if (!eng.loaded) setAsrPhase({ kind: 'model', loaded: 0, total: 0 })
      await eng.load()
      if (!live()) return
      setAsrPhase({ kind: 'mix', done: 0, of: 1 })
      const { audio, skipped } = await mixTimelineAudio(src, (id) => { const m = mediaOf(id); return m && !m.missing && m.url ? m.url : null }, span,
        { onStep: (d, of) => { if (live()) setAsrPhase({ kind: 'mix', done: d, of }) }, cancelled: () => !live() })
      const blocks = asrBlocks(span.end - span.start)
      const opts = asrRunOpts(lang, language, asrNpm)
      const cues: SubtitleCue[] = []
      for (let i = 0; i < blocks.length; i++) {
        if (!live()) return
        setAsrPhase({ kind: 'run', done: i, of: blocks.length })
        const [a, b] = blocks[i]
        const part = audio.slice(Math.floor(a * ASR_SAMPLE_RATE), Math.ceil(b * ASR_SAMPLE_RATE))
        cues.push(...chunksToCues(await eng.run(part, opts.language, opts.opencc), span.start + a, b - a))
      }
      if (!live()) return
      setAsrPhase({ kind: 'idle' })
      // 识别完自动补满句子间的空隙（不加开关）
      const r = addSubtitles(tracksRef.current, fillCueGaps(cues), { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID() })
      if (!r.ids.length) { setNotice(t(skipped ? 'vedit_asr_no_sound' : 'vedit_asr_none')); return }
      edit(r.tracks); setSel([])
      setNotice(t('vedit_asr_done').replace('{n}', String(r.ids.length)))
    } catch (e) {
      if (!live()) return
      asrRef.current?.dispose(); asrRef.current = null
      setAsrPhase({ kind: 'idle' })
      setNotice(t('vedit_asr_fail'))
      console.warn('[vedit-asr]', e)
    }
  }, [asrModelSrc, asrNpm, mediaOf, edit, t, language])
  // ── 「有壳给壳」：
  //   识别字幕／拆曲可以交给用户自己电脑上的堤麟終端跑——各台报的能力（GET /api/agent/media）·档先传云盘拿编号再下单·那台跑完把结果传回云盘。
  const mediaDevs = (host.shell?.useMediaDevices ?? noMediaDevices)(topTab === 'caption' || topTab === 'arrange')
  /** 传一份进这份工程的上传夹（结果也存回那里）：回云盘编号与夹号 */
  const shellPut = useCallback(async (f: File, onP: (p: number) => void) => {
    if (!settingsRef.current.uploadFolderId) await ensureDraftRef.current()
    const folderId = settingsRef.current.uploadFolderId ?? projFolderRef.current
    if (!host.drive) throw new Error('no drive')
    const up = await host.drive.upload(f, folderId, (d, total) => onP(uploadFrac(d, total))).done
    host.drive.invalidate()
    return { fileId: up.id, folderId }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [shellAsr, setShellAsr] = useState<ShellPhase | null>(null)
  const shellAsrRun = useRef(0)
  useEffect(() => () => { shellAsrRun.current++ }, [])
  const cancelShellAsr = useCallback(() => { shellAsrRun.current++; setShellAsr(null) }, [])
  const startShellAsr = useCallback(async (dev0: MediaDevice, scope: AsrScope, lang: AsrLang) => {
    const shell = host.shell
    if (!shell) return
    setSourceMode(false)
    const run = ++shellAsrRun.current
    const live = () => shellAsrRun.current === run
    const src = asrSources(tracksRef.current, (id) => mediaOf(id)?.kind, scope === 'sel' ? selRef.current : undefined)
    const span = asrSpan(src)
    if (!span) { setNotice(t('vedit_asr_no_audio')); return }
    if (span.end - span.start > ASR_MAX_SEC) { setNotice(t('vedit_asr_too_long')); return }
    try {
      setShellAsr({ kind: 'upload', p: 0 })
      // 时间轴会出声的那几段混成一条 16kHz 单声道 WAV（同网页那条）·传云盘交给那台
      const { audio, skipped } = await mixTimelineAudio(src, (id) => { const m = mediaOf(id); return m && !m.missing && m.url ? m.url : null }, span, { cancelled: () => !live() })
      const wav = new File([new Uint8Array(encodeWav([audio], ASR_SAMPLE_RATE))], `${t('vedit_shell_asr_file')}-${Date.now()}.wav`, { type: 'audio/wav' })
      // 「自動調配算力」：开着时交终端失败（非取消）⇒ 换本帐号另一台装好识别字幕的（⛔ 再找失败过的）→ 都不行改这台浏览器识别；关着照旧只报错
      let dev = dev0
      const tried: string[] = []
      let cues: SubtitleCue[] | null = null
      for (;;) {
        try {
          const res = await shell.runShellJob({ dev, kind: 'asr', file: wav, lang: shellAsrLang(lang), put: shellPut, onPhase: (p) => { if (live()) setShellAsr(p) }, cancelled: () => !live() })
          if (res.kind !== 'asr') throw new ShellJobError('failed')
          cues = parseAsrResult(JSON.parse(await (await shell.fetchDriveBlob(res.file_id)).text()), span.start, span.end - span.start)
          if (!cues) throw new ShellJobError('failed')
          break
        } catch (err) {
          if (!live()) return
          tried.push(dev.deviceId)
          const step = await shell.computeFailover(err, { kind: 'asr', tried, local: localDevRef.current, web: async () => !!asrModelSrc && (await hasWebGpu()) })
          if (!live()) return
          if (!step) throw err
          setNotice(computeSwitchText(t, step))
          if (step.to === 'web') { setShellAsr(null); void startAsr(scope, lang); return }
          dev = step.dev
          setShellAsr({ kind: 'upload', p: 0 })
        }
      }
      // 壳出原文 ⇒ 繁简照站别转（同网页那条只换字不换词）
      const texts = await convertTexts(cues.map((c) => c.text), asrRunOpts(lang, language, asrNpm).opencc)
      cues = cues.map((c, i) => ({ ...c, text: texts[i] }))
      if (!live()) return
      setShellAsr(null)
      const r = addSubtitles(tracksRef.current, fillCueGaps(cues), { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID() })
      if (!r.ids.length) { setNotice(t(skipped ? 'vedit_asr_no_sound' : 'vedit_asr_none')); return }
      edit(r.tracks); setSel([])
      setNotice(t('vedit_asr_done').replace('{n}', String(r.ids.length)))
    } catch (e) {
      if (!live()) return
      setShellAsr(null)
      setNotice(shellErrText(t, e))
      console.warn('[vedit-shell-asr]', e)
    }
  }, [mediaOf, edit, t, language, asrNpm, shellPut, asrModelSrc, startAsr]) // eslint-disable-line react-hooks/exhaustive-deps
  // ── 「雲端識別」：时间轴会出声的那几段混成一条 16kHz 单声道（同网页那条）·每 2 分钟一段送服务器 ⇒
  //   阿里国际站（新加坡）qwen-audio-3.1-asr-flash ⇒ 一句一段排上文字轨（出简体 ⇒ 繁简照站别只换字）。
  //   每人每天免费 2 小时（站别时区 0 点重置·识别格显示今天还剩多少）；超出的部分开始前先给估价、确认后预扣，识别完按实际用量结算（多扣的退）。
  const cloudAsr = host.cloudAsr
  /** null＝还没问·false＝云端识别不可用（这站没开放／没设钥匙） */
  const [cloudLeft, setCloudLeft] = useState<{ left: number; daily: number } | false | null>(null)
  const refreshCloudQuota = useCallback(async () => {
    if (!cloudAsr) return
    const q = await cloudAsr.quota().catch(() => ({ available: false as const }))
    setCloudLeft(q.available ? { left: q.left, daily: q.daily } : false)
  }, [cloudAsr])
  useEffect(() => { if (topTab === 'caption' && cloudAsr) void refreshCloudQuota() }, [topTab, cloudAsr, refreshCloudQuota])
  const [cloudPhase, setCloudPhase] = useState<CloudAsrPhase | null>(null)
  const cloudRun = useRef(0)
  const cloudJob = useRef<string | null>(null)
  // 关页／换页时还在识别 ⇒ 当取消结算（没用到的免费秒与多扣的积分回来）
  useEffect(() => () => { cloudRun.current++; const j = cloudJob.current; cloudJob.current = null; if (j) void cloudAsr?.finish(j, true) }, [cloudAsr])
  const cloudEstimate = useCallback((scope: AsrScope) => {
    if (!cloudAsr || !cloudLeft) return null
    const span = asrSpan(asrSources(tracksRef.current, (id) => mediaOf(id)?.kind, scope === 'sel' ? selRef.current : undefined))
    if (!span) return null
    const sec = Math.ceil(span.end - span.start)
    return { sec, ...cloudAsr.estimate(sec, cloudLeft.left) }
  }, [cloudAsr, cloudLeft, mediaOf])
  const cancelCloudAsr = useCallback(() => {
    cloudRun.current++
    const j = cloudJob.current
    cloudJob.current = null
    setCloudPhase(null)
    if (j && cloudAsr) void cloudAsr.finish(j, true).then(() => refreshCloudQuota())
  }, [cloudAsr, refreshCloudQuota])
  const startCloudAsr = useCallback(async (scope: AsrScope, lang: AsrLang, expect: number) => {
    if (!cloudAsr) return
    setSourceMode(false)
    const run = ++cloudRun.current
    const live = () => cloudRun.current === run
    const src = asrSources(tracksRef.current, (id) => mediaOf(id)?.kind, scope === 'sel' ? selRef.current : undefined)
    const span = asrSpan(src)
    if (!span) { setNotice(t('vedit_asr_no_audio')); return }
    const total = span.end - span.start
    if (total > ASR_MAX_SEC) { setNotice(t('vedit_asr_too_long')); return }
    let job: string | null = null
    try {
      setCloudPhase({ kind: 'mix' })
      const { audio, skipped } = await mixTimelineAudio(src, (id) => { const m = mediaOf(id); return m && !m.missing && m.url ? m.url : null }, span, { cancelled: () => !live() })
      if (!live()) return
      const st = await cloudAsr.start(Math.ceil(total), expect)
      if (!live()) { if (st.ok) void cloudAsr.finish(st.job, true); return }
      if (!st.ok) {
        setCloudPhase(null)
        setNotice(t(st.code === 'credits' ? 'vedit_asr_cloud_credits' : st.code === 'price' ? 'vedit_asr_cloud_price' : 'vedit_asr_cloud_fail'))
        void refreshCloudQuota()
        return
      }
      job = st.job
      cloudJob.current = job
      setCloudLeft((v) => (v ? { ...v, left: st.left } : v))
      const blocks = asrBlocks(total, cloudAsr.segSec)
      const cues: SubtitleCue[] = []
      for (let i = 0; i < blocks.length; i++) {
        if (!live()) return
        setCloudPhase({ kind: 'run', done: i, of: blocks.length })
        const [a, b] = blocks[i]
        const wav = new Blob([encodeWav([audio.slice(Math.floor(a * ASR_SAMPLE_RATE), Math.ceil(b * ASR_SAMPLE_RATE))], ASR_SAMPLE_RATE) as BlobPart], { type: 'audio/wav' })
        let r = await cloudAsr.segment(job, wav, lang)
        if (!r.ok && r.code === 'rate' && live()) { await new Promise((ok) => setTimeout(ok, 4000)); r = await cloudAsr.segment(job, wav, lang) }
        if (!live()) return
        if (!r.ok) throw new Error(`cloud asr segment ${r.code}`)
        for (const c of r.cues) cues.push({ start: span.start + a + c.start, end: span.start + a + Math.max(c.start, c.end), text: c.text })
      }
      // 阿里中文出简体 ⇒ 照站别只换字（同网页／终端那两条）
      const texts = await convertTexts(cues.map((c) => c.text), asrRunOpts(lang, language, asrNpm).opencc)
      const fin = await cloudAsr.finish(job, false)
      cloudJob.current = null
      job = null
      if (fin?.left != null) setCloudLeft((v) => (v ? { ...v, left: fin.left as number } : v)); else void refreshCloudQuota()
      if (!live()) return
      setCloudPhase(null)
      const r = addSubtitles(tracksRef.current, fillCueGaps(cues.map((c, i) => ({ ...c, text: texts[i] }))), { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID() })
      if (!r.ids.length) { setNotice(t(skipped ? 'vedit_asr_no_sound' : 'vedit_asr_none')); return }
      edit(r.tracks); setSel([])
      setNotice(fin && fin.credits > 0 ? t('vedit_asr_cloud_done_paid').replace('{n}', String(r.ids.length)).replace('{c}', String(fin.credits)) : t('vedit_asr_done').replace('{n}', String(r.ids.length)))
    } catch (e) {
      // 中途失败 ⇒ 按已识别的量结算（没用到的免费秒与积分回来）
      if (job) { cloudJob.current = null; void cloudAsr.finish(job, true).then(() => refreshCloudQuota()) }
      if (!live()) return
      setCloudPhase(null)
      setNotice(t('vedit_asr_cloud_fail'))
      console.warn('[vedit-cloud-asr]', e)
    }
  }, [cloudAsr, mediaOf, edit, t, language, asrNpm, refreshCloudQuota]) // eslint-disable-line react-hooks/exhaustive-deps
  // 时间轴片段右键「分离人声」：复用 AI 分轨（有终端交终端·没有走编曲那支浏览器模型）·
  //   人声／伴奏进素材区并各放一段到音频轨对齐原片段（原片段静音）·进度与取消在右下角那张小卡（VeditClipStems）
  const clipStems = useClipStems({
    tracks: () => tracksRef.current,
    mediaOf,
    kindOf: (id) => mediaOf(id)?.kind,
    // 声音从剪辑用的那份读（同合成子素材／识别字幕）
    readBlob: async (id) => { const m = mediaOf(id); return m && !m.missing && m.url ? fetch(m.url).then((r) => (r.ok ? r.blob() : null), () => null) : null },
    addFiles: (files) => onPick(files),
    apply: (tr, ids) => { edit(tr); setSel(ids) },
    put: shellPut,
    notice: setNotice,
    shell: host.shell,
    asr: host.asr,
  })
  // 编曲「拆曲」交終端：剪辑页拿着那一趟（切去别的分页照跑·进度在右下角小卡；只有按取消或关页才取消）
  const songStems = useSongStems({ api: host.shell ?? { runShellJob: async () => { throw new Error('no shell') }, fetchDriveBlob: async () => { throw new Error('no shell') } }, put: shellPut, addMedia: (mix, stems) => addArrangeMedia(mix, stems), t })
  const asrHasSel =sel.length > 0 && asrSources(tracks, (id) => mediaOf(id)?.kind, sel).length > 0
  const textSel = editableTextIds(tracks, sel)
  const fancyActive = textSel.length ? T.findClip(tracks, textSel[textSel.length - 1])?.clip.text?.fancy ?? null : null
  /** 画面上正在拖的那段字（放手才进复原栈） */
  const [textDrag, setTextDrag] = useState<{ id: string; body: T.TextBody } | null>(null)
  // 画面里拖字块／贴纸 ⇒ 贴齐画面四边、中线、别的字块贴纸的边与中线（同时间轴那套门槛·顿住）·吸住画浅蓝辅助线；自动吸附关掉不吸不画
  const [stageGuides, setStageGuides] = useState<{ gx: number | null; gy: number | null } | null>(null)
  /** 按下那一刻量好：画面多大、自己多大（半宽半高）、画面上别的字块贴纸在哪（都按画面比例） */
  const stageBoxesAt = (stage: Element, self: Element): { w: number; h: number; self: StageBox; others: StageBox[] } => {
    const r = stage.getBoundingClientRect()
    const w = Math.max(1, r.width), h = Math.max(1, r.height)
    const box = (q: DOMRect): StageBox => ({ x: (q.left + q.width / 2 - r.left) / w, y: (q.top + q.height / 2 - r.top) / h, hw: q.width / 2 / w, hh: q.height / 2 / h })
    const others = Array.from(stage.querySelectorAll('[data-testid="vedit-text"],[data-testid="vedit-sticker"]')).filter((el) => el !== self).map((el) => box(el.getBoundingClientRect()))
    return { w, h, self: box(self.getBoundingClientRect()), others }
  }
  /** 拖到 (x, y)（已夹在 0～1）⇒ 吸完的位置·顺手更新辅助线（held 整趟拖动带着） */
  const stageSnapAt = (m: ReturnType<typeof stageBoxesAt>, x: number, y: number, held: { cur: ReturnType<typeof stageSnap>['held'] }) => {
    const s = stageSnap({ ...m.self, x, y }, m.others, m.w, m.h, tlPrefsRef.current.snap, held.cur)
    held.cur = s.held
    setStageGuides(s.gx === null && s.gy === null ? null : { gx: s.gx, gy: s.gy })
    return { x: s.x, y: s.y }
  }
  const onTextDown = (lane: T.Lane, c: T.TlClip, mode: 'move' | 'size') => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !c.text || mosaicRecRef.current || mtSelRef.current || pushSelRef.current) return // 框选中（跟踪／推镜头）⇒ 交给舞台拉框·别拖走字 // 追踪打码开着 ⇒ 按到字上也照记打码
    e.stopPropagation()
    setSel([c.id])
    if (lane.locked || aiLockedRef.current) return   // 罩期预览区不盖罩·但字块拖不动
    e.preventDefault()
    const stage = (e.currentTarget as HTMLElement).closest('[data-testid="vedit-stage"]')
    if (!stage) return
    const r = stage.getBoundingClientRect()
    const b0 = textBodyAt(c, nowRef.current) ?? c.text, x0 = e.clientX, y0 = e.clientY // 打过位置关键帧 ⇒ 从这一刻的位置拖起
    // 跟着运动跟踪走的字：手拖的位移要除掉跟随缩放（字层被放大 k 倍）·画面吸附量的是变换后的位置、对不上 ⇒ 不吸
    const fk = followAt(tracksRef.current, c, nowRef.current, r.width / Math.max(1, r.height))?.k || 0
    const meas = mode === 'move' && !fk ? stageBoxesAt(stage, e.currentTarget) : null
    const held = { cur: STAGE_HELD_NONE }
    let last: T.TextBody | null = null
    // 播放中拖字 ⇒ 一路记位置·放手写成关键帧（同画面 onPicDown）
    const samples: KfSample[] = []
    const sample = () => { if (last && mode === 'move' && playingRef.current && shouldSample(samples, nowRef.current)) samples.push({ t: nowRef.current, x: last.x, y: last.y }) }
    const timer = window.setInterval(sample, 40)
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / Math.max(1, r.width), dy = (ev.clientY - y0) / Math.max(1, r.height)
      if (!last && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return
      last = meas ? { ...b0, ...stageSnapAt(meas, Math.min(1, Math.max(0, b0.x + dx)), Math.min(1, Math.max(0, b0.y + dy)), held) } : mode === 'move' ? { ...b0, x: Math.min(1, Math.max(0, b0.x + dx / fk)), y: Math.min(1, Math.max(0, b0.y + dy / fk)) } : { ...b0, size: sizeFromDrag(b0.size, dy / (fk || 1)) }
      setTextDrag({ id: c.id, body: last })
      sample()
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      window.clearInterval(timer)
      setTextDrag(null); setStageGuides(null)
      const ft = T.findClip(tracksRef.current, c.id)
      if (samples.length && ft) { edit(setKfClip(c.id, recordKf(ft.clip, 'tx', 'ty', samples))); setNotice(t('vedit_kf_recorded').replace('{n}', String(samples.length))); return }
      // 命令化第二期：放手＝text.update（位置／字高·重算跟 moveText／resizeText 一样才用命令那份）
      if (last) editVia([{ command: 'text.update', params: mode === 'move' ? { clip: c.id, x: last.x, y: last.y } : { clip: c.id, size: last.size } }], mode === 'move' ? moveText(tracksRef.current, c.id, last.x, last.y) : resizeText(tracksRef.current, c.id, last.size))
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  // ── 贴纸：点一张 ⇒ 放在播放头（贴纸轨·3 秒·画面正中·选起来）；
  //   播放器上的贴纸能拖位置、拉右下角改大小（放手才进复原栈·算法在 _lib/vedit-sticker.pure.ts）──
  // ── 形状／纯色／动态背景：点一张 ⇒ 放在播放头（画面轨·主轨空着就进主轨·选起来）；纯色、动态背景放最底（addBackgroundAt）──
  const pickVector = useCallback((c: T.TlClip) => {
    setSourceMode(false)
    edit(isBackgroundClip(c) ? addBackgroundAt(tracksRef.current, c, nowRef.current, () => crypto.randomUUID()).tracks : addVectorAt(tracksRef.current, c, nowRef.current, () => crypto.randomUUID()))
    setSel([c.id])
  }, [edit])
  const pickSticker = useCallback((id: string) => {
    setSourceMode(false)
    // 命令化第二期：sticker.add（不给轨＝addStickerAt 同一份落点规划）；认不得的贴纸照旧不动
    if (!stickerById(id)) return
    const a = runCmd([{ command: 'sticker.add', params: { sticker: id, at: nowRef.current } }])
    if (a.ok) { setSel([a.results[0].id!]); return }
    if (a.locked) return
    const r = addStickerAt(tracksRef.current, id, nowRef.current, { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID() })
    if (!r.id) return
    edit(r.tracks)
    setSel([r.id])
  }, [edit, runCmd])
  const [stickerDrag, setStickerDrag] = useState<{ id: string; body: T.StickerBody } | null>(null)
  // ── 滤镜：点一款 ⇒ 播放头放一段（滤镜轨·3 秒·选起来）·底下的画面轨套色；
  //   选中滤镜片段 ⇒ 页签里出强度拉杆（拉着时即时看·放手才进复原栈）──
  // ── 程序片段──
  //   程序包＝网站内建（vedit-programs.data）＋使用者上传（本机 OPFS·开页读清单·用到才读本体）；点一个 ⇒ 播放头放一段（程序轨·可多条叠）；
  //   选中程序片段 ⇒ 「程式」页签上方参数面板（拉着时即时看·放手进复原栈）；画法＝沙盒 iframe（VeditProgramFrame）。
  const progLang = language
  const [uploadedProgs, setUploadedProgs] = useState<StoredProgram[]>([])
  const [progBundles, setProgBundles] = useState<Record<string, ProgramBundle | null>>({})
  const progBundlesRef = useRef(progBundles)
  progBundlesRef.current = progBundles
  useEffect(() => { setUploadedProgs(listUploadedPrograms()) }, [])
  /** 这个包现在拿得到的本体（内建当场有·上传的读过才有·读不到 ⇒ null） */
  const programBundleOf = useCallback((id: string): ProgramBundle | null => builtinProgram(id) ?? progBundlesRef.current[id] ?? null, [])
  // 汇出成片：素材原档（本机储存·汇出用原档）＋现在播放的那份＋程序包
  exportEnvRef.current = () => ({ tracks: tracksRef.current, mediaOf: (id) => mediaOf(id) ?? null, originalOf: async (id) => { const m = mediaOf(id); return filesRef.current.get(id) ?? (m ? await host.media.readOriginal(m, projRef.current?.id ?? null) : null) }, programOf: programBundleOf })
  // 轨道上用到、还没读过的上传包 ⇒ 读本机储存（读不到记 null·画面写「找不到」）
  const progIdsInUse = [...new Set(T.allClips(tracks).map((c) => c.program?.pkg).filter((x): x is string => !!x && !builtinProgram(x)))].sort().join(',')
  useEffect(() => {
    for (const id of progIdsInUse ? progIdsInUse.split(',') : []) {
      if (id in progBundlesRef.current) continue
      progBundlesRef.current = { ...progBundlesRef.current, [id]: null }
      // 本机那份晚到时工程档内嵌的新版可能已先放进来 ⇒ 只填还空着的（免得旧版盖回去）
      void loadUploadedProgram(id).then((b) => {
        if (progBundlesRef.current[id]) return
        progBundlesRef.current = { ...progBundlesRef.current, [id]: b }
        setProgBundles((m) => (m[id] ? m : { ...m, [id]: b }))
      })
    }
  }, [progIdsInUse])
  const pickProgram = useCallback(async (id: string) => {
    setSourceMode(false)
    let b = programBundleOf(id)
    if (!b) { b = await loadUploadedProgram(id); progBundlesRef.current = { ...progBundlesRef.current, [id]: b }; setProgBundles(progBundlesRef.current) }
    if (!b) { setNotice(t('vedit_prog_missing')); return }
    const r = addProgramAt(tracksRef.current, b, nowRef.current, { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID() })
    edit(r.tracks)
    setSel([r.id])
  }, [edit, programBundleOf, t])
  const pickProgramClick = (id: string) => { void pickProgram(id) }
  const uploadProgram = useCallback(async (f: File): Promise<string | null> => {
    const r = await unpackProgramZip(f, `u-${crypto.randomUUID()}`)
    if (!r.ok) return r.err
    if (!(await saveUploadedProgram(r.bundle))) return t('vedit_prog_save_fail')
    progBundlesRef.current = { ...progBundlesRef.current, [r.bundle.id]: r.bundle }
    setProgBundles(progBundlesRef.current)
    setUploadedProgs(listUploadedPrograms())
    return null
  }, [t])
  const [progLive, setProgLive] = useState<{ id: string; key: string; v: ProgramParamValue } | null>(null)
  const selProgram: ProgramHost['selected'] = (() => {
    if (!picked) return null
    const f = T.findClip(tracks, picked)
    const pg = f?.clip.program
    if (!f || !pg) return null
    const bundle = programBundleOf(pg.pkg)
    const params = progLive?.id === f.clip.id ? { ...pg.params, [progLive.key]: progLive.v } : pg.params
    return { clipId: f.clip.id, name: bundle ? l10n(bundle.manifest.name, progLang as ProgLang) : pg.pkg, bundle, params, locked: f.lane.locked }
  })()
  const onProgramParam = (spec: ProgramParamSpec, v: ProgramParamValue, commit: boolean) => {
    if (!selProgram || selProgram.locked) return
    if (!commit) { setProgLive({ id: selProgram.clipId, key: spec.key, v }); return }
    setProgLive(null)
    edit(setProgramParam(tracksRef.current, selProgram.clipId, spec, v))
  }

  // ── 特效／转场──
  // 特效＝标在画面轨素材片段身上（点一款：选中的那段·没选就播放头那段最上面的画面）；转场＝标在同轨尾接头的接缝上
  // （点一款：选中的接缝·没选就选中片段两头离播放头近的那个·再没有就最上面画面轨里离播放头 2 秒内的接缝）。也能把卡拖到片段／接缝上。
  const applyEffect = (clipId: string | null, fxId: string) => {
    setSourceMode(false)
    const tr = tracksRef.current
    const hit = clipId ? T.findClip(tr, clipId) : null
    if (!hit || !decoratable(hit.lane, hit.clip)) { setNotice(t('vedit_fx_need_clip')); return }
    if (hit.lane.locked) { setNotice(t('vedit_lane_locked')); return }
    if (!hit.clip.fx?.some((x) => x.fx === fxId)) {
      // 命令化第二期：clip.setFx＝addEffect（满了 ⇒ 命令不收 ⇒ 照原本的提示）
      const r = runCmd([{ command: 'clip.setFx', params: { clip: hit.clip.id, fx: fxId } }])
      if (!r.ok && !r.locked) { setNotice(t('vedit_fx_full')); return }
    }
    setSel([hit.clip.id])
  }
  const fxTargetClip = (): string | null => {
    const sp = selRef.current.length ? selRef.current[selRef.current.length - 1] : null
    if (sp) { const f = T.findClip(tracksRef.current, sp); if (f && decoratable(f.lane, f.clip)) return sp }
    for (const st of T.layersAt(tracksRef.current, nowRef.current)) if (st.show && st.hit && decoratable(st.lane, st.hit.clip)) return st.hit.clip.id
    return null
  }
  const applyTransition = (rightId: string | null, trId: string) => {
    setSourceMode(false)
    const tr = tracksRef.current
    if (!rightId) { setNotice(t('vedit_tr_need_seam')); return }
    const hit = T.findClip(tr, rightId)
    if (hit?.lane.locked) { setNotice(t('vedit_lane_locked')); return }
    // 命令化第二期：clip.setTransition＝setTransition（片段太短放不下 ⇒ 命令不收 ⇒ 照原本的提示）
    const r = runCmd([{ command: 'clip.setTransition', params: { clip: rightId, transition: trId } }])
    if (!r.ok && !r.locked && hit?.clip.transIn?.tr !== trId) { setNotice(t('vedit_tr_too_short')); return }
    setSel([]); setSelTrans(rightId)
  }
  const pickEffect = (id: string) => applyEffect(fxTargetClip(), id)
  const pickTransition = (id: string) => {
    const sp = selRef.current.length ? selRef.current[selRef.current.length - 1] : null
    applyTransition(selTransRef.current ?? seamFor(tracksRef.current, sp, nowRef.current), id)
  }
  const [fxLive, setFxLive] = useState<{ clipId: string; fx: string; strength: number } | null>(null)
  const [trLive, setTrLive] = useState<{ id: string; length: number } | null>(null)
  const selFxClip = (() => {
    if (!picked) return null
    const f = T.findClip(tracks, picked)
    if (!f || !decoratable(f.lane, f.clip)) return null
    return { id: f.clip.id, name: mediaOf(f.clip.mediaId)?.name ?? '', locked: f.lane.locked,
      effects: (f.clip.fx ?? []).map((e) => (fxLive?.clipId === f.clip.id && fxLive.fx === e.fx ? { ...e, strength: fxLive.strength } : e)) }
  })()
  const selTransInfo = (() => {
    if (!selTrans) return null
    const f = T.findClip(tracks, selTrans)
    if (!f?.clip.transIn) return null
    return { tr: f.clip.transIn.tr, length: trLive?.id === selTrans ? trLive.length : f.clip.transIn.length, max: transLimit(f.lane, f.clip), locked: f.lane.locked }
  })()
  const fxHost: FxHost = {
    favs: [], onFav: () => {}, onPick: pickEffect, selClip: selFxClip,
    onStrength: (fx, v, commit) => {
      if (!selFxClip || selFxClip.locked) return
      if (!commit) { setFxLive({ clipId: selFxClip.id, fx, strength: v }); return }
      setFxLive(null)
      runCmd([{ command: 'clip.setFx', params: { clip: selFxClip.id, fx, strength: v } }]) // 命令化第二期：clip.setFx strength＝setEffectStrength
    },
    onRemove: (fx) => { if (selFxClip && !selFxClip.locked) runCmd([{ command: 'clip.setFx', params: { clip: selFxClip.id, fx, remove: true } }]) }, // ＝removeEffect
  }
  const trHost: FxHost = {
    favs: [], onFav: () => {}, onPick: pickTransition, selTrans: selTransInfo,
    onLength: (v, commit) => {
      if (!selTrans || !selTransInfo || selTransInfo.locked) return
      if (!commit) { setTrLive({ id: selTrans, length: v }); return }
      setTrLive(null)
      // 命令化第二期：clip.setTransition 同款换长度＝setTransLength（重算跟原算法一样才用命令那份）
      const cur = T.findClip(tracksRef.current, selTrans)?.clip.transIn?.tr
      if (cur) editVia([{ command: 'clip.setTransition', params: { clip: selTrans, transition: cur, length: v } }], setTransLength(tracksRef.current, selTrans, v))
    },
    onRemoveTrans: () => { if (selTrans && selTransInfo && !selTransInfo.locked) { runCmd([{ command: 'clip.setTransition', params: { clip: selTrans, transition: null } }]); setSelTrans(null) } }, // ＝removeTransition
  }
  /** 特效画布（每条画面轨一张·滤镜要再套就读它）：画好了（data-ready=1）才给滤镜读·不然读原元素 */
  const fxCanvasEls = useRef(new Map<string, HTMLCanvasElement>())
  const fxCanvasRefs = useRef(new Map<string, (el: HTMLCanvasElement | null) => void>())
  const fxCanvasRef = (laneId: string) => {
    let f = fxCanvasRefs.current.get(laneId)
    if (!f) { f = (el) => { if (el) fxCanvasEls.current.set(laneId, el); else fxCanvasEls.current.delete(laneId) }; fxCanvasRefs.current.set(laneId, f) }
    return f
  }
  const fxSrcGetters = useRef(new Map<string, () => HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null>())
  const layerFxSource = (laneId: string) => {
    let g = fxSrcGetters.current.get(laneId)
    if (!g) { g = () => { const cv = fxCanvasEls.current.get(laneId); return cv && cv.dataset.ready === '1' ? cv : layerSource(laneId)() }; fxSrcGetters.current.set(laneId, g) }
    return g
  }

  const pickFilter = useCallback((id: string) => {
    setSourceMode(false)
    const r = addFilterAt(tracksRef.current, id, nowRef.current, { id: () => crypto.randomUUID(), laneId: () => crypto.randomUUID() })
    if (!r.id) return
    edit(r.tracks)
    setSel([r.id])
  }, [edit])
  const [filterLive, setFilterLive] = useState<{ id: string; strength: number } | null>(null)
  const selFilter = (() => {
    if (!picked) return null
    const f = T.findClip(tracks, picked)
    if (!f?.clip.filter) return null
    const c = f.clip
    // 强度关键帧：显示播放头这一刻的强度·旁边一颗菱形
    const kfBtn = <VeditKfBtn times={clipKfTimes(c, ['flt'])} on={kfOnClip(c, now, ['flt'])} now={now} onSeek={seekTimeline} disabled={f.lane.locked} testid="vedit-filter-kf"
      onToggle={() => edit(applyKfOp(tracksRef.current, [c.id], nowRef.current, { toggle: ['flt'] }, (x) => ({ flt: filterStrengthAt(x, nowRef.current) })))} />
    return { id: c.id, filter: c.filter!.filter, strength: filterLive?.id === c.id ? filterLive.strength : filterStrengthAt(c, now), locked: f.lane.locked, kf: kfBtn }
  })()
  const onFilterStrength = (v: number, commit: boolean) => {
    if (!selFilter || selFilter.locked) return
    if (!commit) { setFilterLive({ id: selFilter.id, strength: v }); return }
    setFilterLive(null)
    edit(filterKfStrength(tracksRef.current, selFilter.id, nowRef.current, v) ?? setFilterStrength(tracksRef.current, selFilter.id, v))
  }
  // ── 收藏：卡片右上角星星·存帐号偏好（换电脑也在）·开页读一次 ──
  const [favs, setFavs] = useState<Record<FavKind, string[]>>({ sticker: [], filter: [], fx: [], transition: [] })
  const favsRef = useRef(favs)
  favsRef.current = favs
  useEffect(() => {
    let alive = true
    void host.favs.load([FAV_PREF_KEY.sticker, FAV_PREF_KEY.filter, FAV_PREF_KEY.fx, FAV_PREF_KEY.transition]).then((v) => {
      if (!alive || !v) return
      setFavs({ sticker: parseFavs(v[FAV_PREF_KEY.sticker], (id) => !!stickerById(id)), filter: parseFavs(v[FAV_PREF_KEY.filter], (id) => !!filterById(id)),
        fx: parseFavs(v[FAV_PREF_KEY.fx], (id) => fxById(id)?.kind === 'effect'), transition: parseFavs(v[FAV_PREF_KEY.transition], (id) => fxById(id)?.kind === 'transition') })
    }).catch(() => { /* 读不到当没有收藏 */ })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const flipFav = useCallback((kind: FavKind, id: string) => {
    const next = toggleFav(favsRef.current[kind], id)
    favsRef.current = { ...favsRef.current, [kind]: next }
    setFavs(favsRef.current)
    void host.favs.save(FAV_PREF_KEY[kind], next).catch(() => setNotice(t('vedit_fav_save_fail')))
  }, [t]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 滤镜要拿画面元素当纹理：每条画面轨一只取元素的函数（同一条轨同一只·画布不重挂） */
  const imgEls = useRef(new Map<string, HTMLImageElement>())
  /** 画面层的图按素材换元素·每个（轨＋素材）一只 ref·放掉时只删自己那只（新元素可能先挂上） */
  const imgElRefs = useRef(new Map<string, (el: HTMLImageElement | null) => void>())
  const imgElRef = (laneId: string, mediaId: string) => {
    const k = `${laneId}\u0000${mediaId}`
    let f = imgElRefs.current.get(k)
    if (!f) {
      let mine: HTMLImageElement | null = null
      f = (el) => { if (el) { mine = el; imgEls.current.set(laneId, el) } else { if (mine && imgEls.current.get(laneId) === mine) imgEls.current.delete(laneId); mine = null } }
      imgElRefs.current.set(k, f)
    }
    return f
  }
  // 播放头前后会出现的图片先载好并 decode（算法在 _lib/vedit-image-preload.pure.ts）
  const preloadAt = preloadTick(now)
  const preloadUrls = useMemo(() => imagesToPreload(tracks, preloadAt, kindOfMedia).map((id) => { const m = mediaOf(id); return m && !m.missing && m.url ? m.url : '' }).filter(Boolean),
    [tracks, preloadAt, kindOfMedia, mediaOf, media]) // eslint-disable-line react-hooks/exhaustive-deps
  useImagePreload(preloadUrls)
  const srcGetters = useRef(new Map<string, () => HTMLVideoElement | HTMLImageElement | null>())
  /** 原元素（调色画布读它） */
  const rawSource = (laneId: string) => {
    let g = srcGetters.current.get(laneId)
    if (!g) { g = () => imgEls.current.get(laneId) ?? ((laneEls.current.get(laneId) as HTMLVideoElement | undefined) ?? null); srcGetters.current.set(laneId, g) }
    return g
  }
  /**  这一层有调色／抠像／调节层 ⇒ 调色画布画好了（data-ready=1）就给特效、滤镜、背景读它·不然读原元素 */
  const gradeCanvasEls = useRef(new Map<string, HTMLCanvasElement>())
  const gradeCanvasRefs = useRef(new Map<string, (el: HTMLCanvasElement | null) => void>())
  const gradeCanvasRef = (laneId: string) => {
    let f = gradeCanvasRefs.current.get(laneId)
    if (!f) { f = (el) => { if (el) gradeCanvasEls.current.set(laneId, el); else gradeCanvasEls.current.delete(laneId) }; gradeCanvasRefs.current.set(laneId, f) }
    return f
  }
  const gradedGetters = useRef(new Map<string, () => HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null>())
  /** 调色后的画面（运动模糊画布读它）：调色画布画好了 ⇒ 它·不然原元素 */
  const gradedSource = (laneId: string) => {
    let g = gradedGetters.current.get(laneId)
    // 调色画布在、还没画好也没坏 ⇒ 先等（⛔ 拿没抠的原片给下游画）；坏了（data-err）⇒ 原元素
    if (!g) { g = () => { const cv = gradeCanvasEls.current.get(laneId); return !cv ? rawSource(laneId)() : cv.dataset.ready === '1' ? cv : cv.dataset.err ? rawSource(laneId)() : null }; gradedGetters.current.set(laneId, g) }
    return g
  }
  /** 运动模糊：画布画好了（data-ready=1）就给特效、滤镜、背景读它·不然读调色后的画面 */
  const mbCanvasEls = useRef(new Map<string, HTMLCanvasElement>())
  const mbCanvasRefs = useRef(new Map<string, (el: HTMLCanvasElement | null) => void>())
  const mbCanvasRef = (laneId: string) => {
    let f = mbCanvasRefs.current.get(laneId)
    if (!f) { f = (el) => { if (el) mbCanvasEls.current.set(laneId, el); else mbCanvasEls.current.delete(laneId) }; mbCanvasRefs.current.set(laneId, f) }
    return f
  }
  const timelineClock = useCallback(() => nowRef.current, [])
  const layerGetters = useRef(new Map<string, () => HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null>())
  const layerSource = (laneId: string) => {
    let g = layerGetters.current.get(laneId)
    if (!g) { g = () => { const cv = mbCanvasEls.current.get(laneId); return cv && cv.dataset.ready === '1' ? cv : gradedSource(laneId)() }; layerGetters.current.set(laneId, g) }
    return g
  }
  const onStickerDown = (lane: T.Lane, c: T.TlClip, mode: 'move' | 'size') => (e: React.PointerEvent<HTMLElement>) => {
    if (mosaicRecRef.current || mtSelRef.current || pushSelRef.current) return // 追踪打码开着／框选中 ⇒ 交给舞台
    if (e.button !== 0 || !c.sticker) return
    e.stopPropagation()
    setSel([c.id])
    if (lane.locked || aiLockedRef.current) return   // 罩期贴纸拖不动
    e.preventDefault()
    const stage = (e.currentTarget as HTMLElement).closest('[data-testid="vedit-stage"]')
    if (!stage) return
    const r = stage.getBoundingClientRect()
    const b0 = c.sticker, x0 = e.clientX, y0 = e.clientY
    const fk = followAt(tracksRef.current, c, nowRef.current, r.width / Math.max(1, r.height))?.k || 0 // 跟着运动跟踪：位移除掉跟随缩放·不吸（同字块）
    const meas = mode === 'move' && !fk ? stageBoxesAt(stage, e.currentTarget) : null   // 对齐辅助线（同字块）
    const held = { cur: STAGE_HELD_NONE }
    let last: T.StickerBody | null = null
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / Math.max(1, r.width), dy = (ev.clientY - y0) / Math.max(1, r.height)
      if (!last && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return
      last = meas ? { ...b0, ...stageSnapAt(meas, Math.min(1, Math.max(0, b0.x + dx)), Math.min(1, Math.max(0, b0.y + dy)), held) } : mode === 'move' ? { ...b0, x: Math.min(1, Math.max(0, b0.x + dx / fk)), y: Math.min(1, Math.max(0, b0.y + dy / fk)) } : { ...b0, size: stickerSizeFromDrag(b0.size, dy / (fk || 1)) }
      setStickerDrag({ id: c.id, body: last })
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      setStickerDrag(null); setStageGuides(null)
      // 命令化第二期：放手＝sticker.update（重算跟 moveSticker／resizeSticker 一样才用命令那份）
      if (last) editVia([{ command: 'sticker.update', params: mode === 'move' ? { clip: c.id, x: last.x, y: last.y } : { clip: c.id, size: last.size } }], mode === 'move' ? moveSticker(tracksRef.current, c.id, last.x, last.y) : resizeSticker(tracksRef.current, c.id, last.size))
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  /** 双击改字（Enter／点别处＝改好·Esc＝不改） */
  const [textEdit, setTextEdit] = useState<{ id: string; value: string } | null>(null)
  const commitTextEdit = () => {
    const te = textEdit
    setTextEdit(null)
    if (te) editVia([{ command: 'text.update', params: { clip: te.id, content: te.value } }], setTextContent(tracksRef.current, te.id, te.value)) // 命令化第二期：text.update content（改成空的 ⇒ 命令不收 ⇒ 照原算法不改）
  }
  // ── 右栏两页签（AI＝原本的角色对话·记住上次选哪页·存本机）；
  // 「人工里面先做文字的编辑栏」：选中文字片段 ⇒ 人工页照剪映文本属性面板改（多选＝一起改）；拖滑杆／打数字时只即时看（textLive）·放手才进一步复原 ──
  const [sideTab, setSideTabState] = useState<SideTab>('ai')
  useEffect(() => { try { setSideTabState(parseSideTab(window.localStorage.getItem(VEDIT_SIDE_TAB_KEY))) } catch { /* 读不到用 AI */ } }, [])
  const pickSideTab = useCallback((k: SideTab) => {
    setSideTabState(k)
    try { window.localStorage.setItem(VEDIT_SIDE_TAB_KEY, k) } catch { /* 存不进只影响下次开页 */ }
  }, [])
  const textLiveRef = useRef<TextLive | null>(null)
  const [textLive, setTextLiveState] = useState<TextLive | null>(null)
  const setTextLive = useCallback((v: TextLive | null) => { textLiveRef.current = v; setTextLiveState(v) }, [])
  /**  文字关键帧：打过关键帧的那几项（位置／缩放／旋转／不透明度）改成在播放头补一颗·其余照旧改底值 */
  const commitTextPatch = useCallback((tr: T.Tracks, ids: readonly string[], p: TextPatch): T.Tracks => {
    let out = tr
    const plain: string[] = []
    for (const id of ids) {
      const f = T.findClip(out, id)
      if (!f?.clip.kf) { plain.push(id); continue }
      const r = textKfSplit(f.clip, nowRef.current, p as Record<string, unknown>)
      out = out.map((l) => (l.id !== f.lane.id ? l : { ...l, clips: l.clips.map((x) => { if (x.id !== id) return x; const n = { ...x }; if (r.kf) n.kf = r.kf; else delete n.kf; return n }) }))
      out = patchTexts(out, [id], r.rest as TextPatch)
    }
    return plain.length ? patchTexts(out, plain, p) : out
  }, [])
  const onTextPatch = useCallback((p: TextPatch, commit: boolean) => {
    // 即时值／放手的规矩在 textLiveStep（放手＝并上还没放手的即时值·套到当时选的那几段·一次进复原栈）
    const r = textLiveStep(textLiveRef.current, editableTextIds(tracksRef.current, selRef.current), p, commit)
    setTextLive(r.live)
    if (r.commit) edit(commitTextPatch(tracksRef.current, r.commit.ids, r.commit.patch))
  }, [edit, setTextLive, commitTextPatch])
  const onTextKf = useCallback((op: KfOp) => {
    edit(applyKfOp(tracksRef.current, editableTextIds(tracksRef.current, selRef.current), nowRef.current, op, (c, props) => textKfCurrent(c, nowRef.current, props)))
  }, [edit])
  // 选取换了还有没放手的即时值（打到一半点了别段）⇒ 先替原本那几段存下
  const textSelKey = textSel.join(',')
  useEffect(() => {
    const lv = textLiveRef.current
    if (!lv || lv.ids.join(',') === textSelKey) return
    setTextLive(null)
    edit(commitTextPatch(tracksRef.current, lv.ids, lv.patch))
  }, [textSelKey, edit, setTextLive, commitTextPatch])
  const manualState = (() => {
    const s0 = manualTextState(tracks, sel)
    // 面板显示播放头这一刻的值（文字关键帧）
    const tc = s0.kind === 'text' ? T.findClip(tracks, s0.ids[s0.ids.length - 1])?.clip : undefined
    const s = s0.kind === 'text' && tc ? { ...s0, body: textBodyAt(tc, now) ?? s0.body } : s0
    return s.kind === 'text' && textLive && textLive.ids.join(',') === s.ids.join(',') ? { ...s, body: applyTextPatch(s.body, textLive.patch) } : s
  })()
  // ── 选中影片／图片／音频片段 ⇒ 人工页换成剪映那排属性（VeditClipInspector）；
  //   规矩同文字：拖滑杆／打数字只即时看（clipLive·预览照它画）·放手才进一步复原；变速放手才改长度（后面紧接的片段跟着推）
  const clipLiveRef = useRef<ClipLive | null>(null)
  const [clipLive, setClipLiveState] = useState<ClipLive | null>(null)
  const setClipLive = useCallback((v: ClipLive | null) => { clipLiveRef.current = v; setClipLiveState(v) }, [])
  const clipState = manualClipState(tracks, sel, kindOfMedia)
  const clipIdsNow = clipState.kind === 'clip' ? clipState.ids : []
  const clipIdsRef = useRef(clipIdsNow)
  clipIdsRef.current = clipIdsNow
  const canSpeed = useCallback((c: T.TlClip) => kindOfMedia(c.mediaId) !== 'image', [kindOfMedia])
  const onClipPatch = useCallback((p0: ClipPatch, commit: boolean) => {
    const p = p0.at === undefined ? { ...p0, at: nowRef.current } : p0 // 关键帧：每笔改动带播放头（打过关键帧的数值改成在这一刻补一颗）
    const r = clipLiveStep(clipLiveRef.current, clipIdsRef.current, p, commit)
    setClipLive(r.live)
    if (r.commit) edit(patchClips(tracksRef.current, r.commit.ids, r.commit.patch, canSpeed))
  }, [edit, setClipLive, canSpeed])
  const onClipPatchV = onClipPatch
  const clipSelKey = clipIdsNow.join(',')
  useEffect(() => {
    const lv = clipLiveRef.current
    if (!lv || lv.ids.join(',') === clipSelKey) return
    setClipLive(null)
    edit(patchClips(tracksRef.current, lv.ids, lv.patch, canSpeed))
  }, [clipSelKey, edit, setClipLive, canSpeed])
  // 预览上按住画面拖＝改位置；播放中拖 ⇒ 每 0.1 秒记一笔·放手写成位置关键帧（一步复原·算法在 _lib/vedit-kf-record.pure.ts）
  const playingRef = useRef(playing)
  playingRef.current = playing
  const setKfClip = (id: string, kf: T.TlClip['kf']) => tracksRef.current.map((l) => (l.clips.some((x) => x.id === id) ? { ...l, clips: l.clips.map((x) => { if (x.id !== id) return x; const { kf: _old, ...rest } = x; void _old; return kf ? { ...rest, kf } : rest }) } : l))
  const onPicDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mtSelRef.current) { onMtDown(e); return } // 运动跟踪框选中：按下＝拉框
    if (pushSelRef.current) { onPushDown(e); return } // 推镜头框选中：按下＝拉框
    if (e.button !== 0 || sourceModeRef.current || aiLockedRef.current) return
    const tr = tracksRef.current, t0 = nowRef.current
    const pickable = (l: T.Lane, c: T.TlClip) => l.kind === 'visual' && !l.locked && !l.hidden && !!c.mediaId && kindOfMedia(c.mediaId) !== 'audio' && c.start <= t0 + 1e-6 && t0 < c.start + c.length
    let f = selRef.current.length === 1 ? T.findClip(tr, selRef.current[0]) : null
    if (!f || !pickable(f.lane, f.clip)) { f = null; for (const st of T.layersAt(tr, t0)) if (st.show && st.hit && pickable(st.lane, st.hit.clip)) { f = { lane: st.lane, clip: st.hit.clip }; break } }
    if (!f) return
    e.preventDefault()
    const c = f.clip, id = c.id
    setSel([id])
    const r = e.currentTarget.getBoundingClientRect()
    const base = kfCurrent(c, t0, ['x', 'y'])
    const bx = base.x ?? 0, by = base.y ?? 0, x0 = e.clientX, y0 = e.clientY
    let pos: { x: number; y: number } | null = null
    const samples: KfSample[] = []
    const sample = () => { if (pos && playingRef.current && shouldSample(samples, nowRef.current)) samples.push({ t: nowRef.current, ...pos }) }
    const timer = window.setInterval(sample, 40) // 滑鼠停着不动、片子照走 ⇒ 照样记（剪映也是）
    const move = (ev: PointerEvent) => {
      if (!pos && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return
      pos = picDragPos(bx, by, ev.clientX - x0, ev.clientY - y0, r.width, r.height)
      setClipLive({ ids: [id], patch: { look: { x: pos.x, y: pos.y }, at: nowRef.current } })
      sample()
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      window.clearInterval(timer)
      setClipLive(null)
      const ft = T.findClip(tracksRef.current, id)
      if (!pos || !ft) return
      if (samples.length) { edit(setKfClip(id, recordKf(ft.clip, 'x', 'y', samples))); setNotice(t('vedit_kf_recorded').replace('{n}', String(samples.length))) }
      else edit(patchClips(tracksRef.current, [id], { look: { x: pos.x, y: pos.y }, at: nowRef.current }, canSpeed))
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  // 追踪打码：右栏「跟踪」页开了 ⇒ 预览上按住＝记打码轨（没在播就自动播·放手停）·每 0.1 秒一笔·放手写进那段（一步复原·算法在 _lib/vedit-mosaic.pure.ts）
  const [mosaicRec, setMosaicRec] = useState(false)
  const mosaicRecRef = useRef(mosaicRec)
  mosaicRecRef.current = mosaicRec
  const [mosaicActive, setMosaicActive] = useState<string | null>(null)
  const mosaicActiveRef = useRef(mosaicActive)
  mosaicActiveRef.current = mosaicActive
  const [mosaicLive, setMosaicLive] = useState<{ x: number; y: number; style: Pick<Mosaic, 'shape' | 'w' | 'h'> } | null>(null)
  const onMosaicDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || sourceModeRef.current || aiLockedRef.current) return
    const tr = tracksRef.current, t0 = nowRef.current
    const pickable = (l: T.Lane, c: T.TlClip) => l.kind === 'visual' && !l.locked && !l.hidden && !!c.mediaId && kindOfMedia(c.mediaId) !== 'audio' && c.start <= t0 + 1e-6 && t0 < c.start + c.length
    let f = selRef.current.length === 1 ? T.findClip(tr, selRef.current[0]) : null
    if (!f || !pickable(f.lane, f.clip)) { f = null; for (const st of T.layersAt(tr, t0)) if (st.show && st.hit && pickable(st.lane, st.hit.clip)) { f = { lane: st.lane, clip: st.hit.clip }; break } }
    if (!f) { setNotice(t('vedit_mosaic_no_clip')); return }
    e.preventDefault(); e.stopPropagation()
    const id = f.clip.id
    setSel([id])
    const r = e.currentTarget.getBoundingClientRect()
    const target = f.clip.mosaic?.some((m) => m.id === mosaicActiveRef.current) ? mosaicActiveRef.current : null
    const tm = target ? f.clip.mosaic!.find((m) => m.id === target)! : MOSAIC_DEFAULT
    const style = { shape: tm.shape, w: tm.w, h: tm.h }
    const at = (cx: number, cy: number) => ({ x: Math.min(1.2, Math.max(-0.2, (cx - r.left) / Math.max(1, r.width))), y: Math.min(1.2, Math.max(-0.2, (cy - r.top) / Math.max(1, r.height))) })
    let pos = at(e.clientX, e.clientY)
    setMosaicLive({ ...pos, style })
    const samples: MosaicSample[] = []
    const sample = () => { if (playingRef.current && shouldSample(samples, nowRef.current, MOSAIC_STEP)) samples.push({ t: nowRef.current, ...pos }) }
    const started = !playingRef.current
    if (started) togglePlay()
    const timer = window.setInterval(sample, 30)
    const move = (ev: PointerEvent) => { pos = at(ev.clientX, ev.clientY); setMosaicLive({ ...pos, style }); sample() }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      window.clearInterval(timer)
      setMosaicLive(null)
      if (started && playingRef.current) setPlaying(false)
      const ft = T.findClip(tracksRef.current, id)
      if (!ft || !samples.length) return
      const r2 = recordMosaic(ft.clip, samples, target, `m-${crypto.randomUUID().slice(0, 8)}`)
      if (!r2.id) { setNotice(t('vedit_mosaic_full')); return }
      edit(patchClips(tracksRef.current, [id], { mosaic: r2.list ?? null }, canSpeed))
      setMosaicActive(r2.id)
      setNotice(t(target ? 'vedit_mosaic_redone' : 'vedit_mosaic_recorded').replace('{n}', String(samples.length)))
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  /** 即时值套上去的样子（预览画面、面板显示都照它·不含变速） */
  const liveClip = (c: T.TlClip, lane: T.LaneKind): T.TlClip => (clipLive && clipLive.ids.includes(c.id) ? applyClipPatch(c, clipLive.patch, lane) : c)
  /** 素材宽／高：读这段的播放元素·图片读画面层那张 */
  const srcRatioOf = (c: T.TlClip): number | undefined => {
    const v = clipEls.current.get(c.id) as HTMLVideoElement | undefined
    if (v && v.videoWidth > 0) return v.videoWidth / v.videoHeight
    const f = T.findClip(tracks, c.id), im = f ? imgEls.current.get(f.lane.id) : undefined
    return im && im.naturalWidth > 0 ? im.naturalWidth / im.naturalHeight : undefined
  }
  // ── 运动跟踪：影片片段「跟踪」页框一处（mtBox·成片画面座标）＋播放头 ⇒ 浏览器逐格读帧追（track-client）⇒ 存成 clip.mtrack；文字／贴纸 follow 绑上 ──
  const [mtSel, setMtSel] = useState(false)
  const mtSelRef = useRef(mtSel)
  mtSelRef.current = mtSel
  const [mtBox, setMtBox] = useState<TrackBox | null>(null)
  const [mtRun, setMtRun] = useState<{ done: number; total: number } | null>(null)
  const mtAbort = useRef<AbortController | null>(null)
  /** 在预览画面上拉一个框（画面比例·中心＋宽高）：拖着时 setBox 即时画·放手够大 ⇒ done(框) */
  const boxDrag = (e: React.PointerEvent<HTMLDivElement>, setBox: (b: TrackBox) => void, done: (b: TrackBox) => void) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const at = (cx: number, cy: number) => [Math.min(1, Math.max(0, (cx - r.left) / Math.max(1, r.width))), Math.min(1, Math.max(0, (cy - r.top) / Math.max(1, r.height)))] as const
    const [ax, ay] = at(e.clientX, e.clientY)
    const box = (ev: PointerEvent): TrackBox => { const [bx, by] = at(ev.clientX, ev.clientY); return { x: (ax + bx) / 2, y: (ay + by) / 2, w: Math.max(0.01, Math.abs(bx - ax)), h: Math.max(0.01, Math.abs(by - ay)) } }
    const move = (ev: PointerEvent) => setBox(box(ev))
    const up = (ev: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); const b = box(ev); if (b.w > PUSH_BOX_MIN && b.h > PUSH_BOX_MIN) done(b) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const onMtDown = (e: React.PointerEvent<HTMLDivElement>) => boxDrag(e, setMtBox, (b) => { setMtBox(b); setMtSel(false) })
  // ── 推镜头「推到框」：画面页「推镜头」组按「在画面拉框」⇒ 预览上拉框 ⇒ 套用＝在播放头与播放头＋时长打 sx／sy／x／y 关键帧（push-box.pure applyPushBox） ──
  const [pushSel, setPushSel] = useState(false)
  const pushSelRef = useRef(pushSel)
  pushSelRef.current = pushSel
  const [pushBox, setPushBox] = useState<TrackBox | null>(null)
  const [pushDur, setPushDur] = useState(PUSH_DUR_DEFAULT)
  const [pushEase, setPushEase] = useState<EasePreset>('inout')
  const onPushDown = (e: React.PointerEvent<HTMLDivElement>) => boxDrag(e, setPushBox, (b) => { setPushBox(b); setPushSel(false) })
  const onPushApply = () => {
    if (clipState.kind !== 'clip' || !pushBox) return
    const id = clipState.clip.id
    const next = applyPushBox(tracksRef.current, id, nowRef.current, pushBox, pushDur, pushEase, stageRatioRef.current ?? 16 / 9)
    if (!next) { setNotice(t('vedit_push_fail')); return }
    edit(next); setPushBox(null)
    setNotice(t('vedit_push_done'))
  }
  const pushHost: PushHost = { selecting: pushSel, setSelecting: (v) => { setPushSel(v); if (v) { setMtSel(false); setMosaicRec(false) } }, box: pushBox, dur: pushDur, setDur: setPushDur, ease: pushEase, setEase: setPushEase, onApply: onPushApply }
  /** dir＝往后／往前追；into＝重追某条（新算那截盖掉旧路径同方向那段·修漂移用）·没给＝新建一条 */
  const onMtStart = async (dir: 'fwd' | 'back' = 'fwd', into?: string) => {
    if (clipState.kind !== 'clip' || clipState.media !== 'video' || !mtBox || mtRun) return
    const c = clipState.clip, m = mediaOf(c.mediaId)
    if (!m?.url) { setNotice(t('vedit_mt_fail')); return }
    // 画面框 ⇒ 扣掉这段这一刻的位移／旋转／缩放（片段座标）⇒ 影片在画面里那块（照比例置中）⇒ 素材帧框
    const asp = stageRatioRef.current ?? 16 / 9
    const fr = frameIn(asp, srcRatioOf(c))
    const hb = boxToHost(mtBox, hostXf(c, nowRef.current), asp)
    const box: TrackBox = { x: (hb.x - fr.x) / fr.w, y: (hb.y - fr.y) / fr.h, w: hb.w / fr.w, h: hb.h / fr.h }
    const times = trackTimes(c, nowRef.current, 900, dir)
    if (times.length < 2) return
    const ac = new AbortController(); mtAbort.current = ac
    setMtRun({ done: 0, total: times.length })
    try {
      const r = await runTrack({ url: m.url, times, box, signal: ac.signal, onProgress: (done, total) => setMtRun({ done, total }) })
      const tk = r.pts.length >= 2 ? makeMTrack(into ?? `trk-${crypto.randomUUID().slice(0, 8)}`, times, r.pts, box, { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2, w: fr.w, h: fr.h }) : null
      const f = T.findClip(tracksRef.current, c.id)
      const old = into ? f?.clip.mtrack?.find((x) => x.id === into) : undefined
      const put = tk && old ? mergeMTrack(old, tk, dir) : tk
      if (put && f) { edit(patchClips(tracksRef.current, [c.id], { mtrack: patchMTracks(f.clip.mtrack, put.id, put) ?? null }, canSpeed)); setNotice(t('vedit_mt_done').replace('{n}', String(tk!.pts.length))) }
    } catch { setNotice(t('vedit_mt_fail')) } finally { setMtRun(null); mtAbort.current = null }
  }
  // 选中的文字／贴纸（跟随＋四角透视面板·画面角点）
  const tsSel = (() => { const id = sel[sel.length - 1]; const f = id ? T.findClip(tracks, id) : null; return f && !f.lane.locked && ((f.lane.kind === 'text' && f.clip.text) || (f.lane.kind === 'sticker' && f.clip.sticker)) ? f : null })()
  const tsIdRef = useRef<string | null>(null)
  // 选中的动态背景片段（属性面板：颜色、密度、速度、视差）
  const bgSel = (() => { const id = sel[sel.length - 1]; const f = id ? T.findClip(tracks, id) : null; return f && !f.lane.locked && f.clip.bgfx ? f : null })()
  tsIdRef.current = tsSel?.clip.id ?? null
  const onTsPatch = useCallback((p0: ClipPatch, commit: boolean) => {
    const id = tsIdRef.current
    if (!id) return
    const p = p0.at === undefined ? { ...p0, at: nowRef.current } : p0
    const r = clipLiveStep(clipLiveRef.current, [id], p, commit)
    setClipLive(r.live)
    if (r.commit) edit(patchClips(tracksRef.current, r.commit.ids, r.commit.patch, canSpeed))
  }, [edit, setClipLive, canSpeed])
  const onTsBind = (v: { clip: string; track: string } | null) => {
    const id = tsIdRef.current
    if (!id) return
    const fo = v ? bindFollow(tracksRef.current, v.clip, v.track, nowRef.current) : null
    if (v && !fo) return
    edit(patchClips(tracksRef.current, [id], { follow: fo }, canSpeed))
  }
  const tsPanel = tsSel ? <VeditFollowPinPanel key={tsSel.clip.id} clip={liveClip(tsSel.clip, tsSel.lane.kind)} tracks={tracks} now={now} onPatch={onTsPatch} onBind={onTsBind} onCancel={() => setClipLive(null)} /> : null
  const mtHost: MTrackHost = { selecting: mtSel, setSelecting: (v) => { setMtSel(v); if (v) setMosaicRec(false) }, box: mtBox, run: mtRun, onStart: (dir, into) => { void onMtStart(dir, into) }, onCancel: () => mtAbort.current?.abort() }
  const clipPanel = clipState.kind === 'clip'
    ? <VeditClipInspector key={clipState.ids.join(',')} host={{ state: { ...clipState, clip: liveClip(clipState.clip, clipState.lane) }, mtrack: mtHost, matteLanes: tracks.filter((l) => l.kind === 'text' || l.kind === 'sticker').map((l, i) => ({ id: l.id, label: `${t(l.kind === 'text' ? 'vedit_ci_matte_lane_text' : 'vedit_ci_matte_lane_sticker')} ${i + 1}` })), onPatch: onClipPatch, onCancel: () => setClipLive(null), stageRatio: stageRatioRef.current ?? undefined, now, onSeek: seekTimeline, srcRatio: srcRatioOf(clipState.clip), ...(clipState.lane === 'visual' && (clipState.media === 'video' || clipState.media === 'image') ? { push: pushHost } : {}), mosaic: { rec: mosaicRec, setRec: setMosaicRec, active: mosaicActive, setActive: setMosaicActive } }} />
    : tsSel?.lane.kind === 'sticker' ? <div className="h-full overflow-y-auto p-2.5 bg-neutral-900 text-neutral-200 text-xs" data-testid="vedit-sticker-panel">{tsPanel}</div>
      : bgSel ? <VeditBgfxPanel key={bgSel.clip.id} body={bgSel.clip.bgfx!} onPatch={(p) => edit(patchBgfx(tracksRef.current, bgSel.clip.id, p))} /> : null
  const textKfClip = manualState.kind === 'text' ? T.findClip(tracks, manualState.ids[manualState.ids.length - 1])?.clip ?? null : null
  const manualHost = { state: manualState, onPatch: onTextPatch, onCancel: () => setTextLive(null), clipPanel, kf: textKfClip ? { clip: textKfClip, now, onSeek: seekTimeline, onOp: onTextKf } : undefined, ...(host.tts ? { tts: (text: string) => host.tts!.renderPanel(text, { busy: ttsBusy, msg: ttsMsg, onRun: (o) => { void runTts(o) } }) } : {}), extra: tsSel?.lane.kind === 'text' ? tsPanel : undefined }

  // ── 每段音量：片段里一条横向音量线·拖上拖下调这一段（多选时一起调·0～1000%·拖时旁边即时显示数字）·双击回 100%；锁了的轨只看不拖 ──
  const sounding = useCallback((c: T.TlClip) => T.hasSound(c, kindOfMedia), [kindOfMedia])
  const volRef = useRef<{ ids: readonly string[]; base: T.Tracks; g0: number; y0: number; h: number; clip: string } | null>(null)
  const [volDrag, setVolDrag] = useState<{ clip: string; g: number } | null>(null)
  const onVolDown = (clip: T.TlClip) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    releaseTypingFocus()
    if (aiLockedRef.current) { aiNoteRef.current(); return }   // 罩期：音量线拉不动
    const box = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect()
    const cur = selRef.current
    const ids = cur.includes(clip.id) ? cur : [clip.id]
    if (!cur.includes(clip.id)) setSel([clip.id])
    if (!gesture.begin(tracksRef.current)) { aiNoteRef.current(); return }
    gestureEndRef.current = () => { volRef.current = null; setVolDrag(null) }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 抓不到照样拖 */ }
    volRef.current = { ids, base: tracksRef.current, g0: T.clipGain(clip), y0: e.clientY, h: box.height, clip: clip.id }
    setVolDrag({ clip: clip.id, g: T.clipGain(clip) })
  }
  const onVolMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = volRef.current
    if (!v) return
    if (!gesture.step()) return   // 拖到一半罩落 ⇒ 这一下作废（已退回按下那刻）
    const g = T.dragVolume(v.g0, e.clientY - v.y0, v.h)
    const next = T.setClipVolume(v.base, v.ids, g, sounding)
    tracksRef.current = next
    setTracks(next)
    setVolDrag({ clip: v.clip, g })
  }
  const onVolUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = volRef.current
    volRef.current = null
    setVolDrag(null)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已放 */ }
    const ok = v ? gesture.end() : null   // 罩期放手 ⇒ null（退回·不记复原）
    gestureEndRef.current = () => {}
    if (v && ok && tracksRef.current !== v.base) { histRef.current = T.commitHist(histRef.current, v.base); setHistTick((n) => n + 1) }
  }
  const onVolReset = (clip: T.TlClip) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const cur = selRef.current
    // 命令化第二期：音量回 100%＝clip.setVolume 1（只送没锁、会出声的那几段·同 T.setClipVolume 自己略过的）
    const tr = tracksRef.current
    const ids = (cur.includes(clip.id) ? cur : [clip.id]).filter((id) => { const f = T.findClip(tr, id); return !!f && !f.lane.locked && sounding(f.clip) })
    if (ids.length) runCmd([{ command: 'clip.setVolume', params: { clips: ids, volume: 1 } }])
  }
  // 声音波形：轨道上用到的影音素材背景算峰值表（一次一份·排队）；云盘素材还没下载到本机 ⇒ 等下载好（media 变了）再试
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({})
  /** 素材编号 ⇒ 算的是哪一份内容：同编号换了云盘档（角色改了工程档）⇒ 键变了·旧波形拿掉重算 */
  const peaksAsked = useRef(new Map<string, string>())
  const peaksJob = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    for (const c of T.allClips(tracks)) {
      const id = c.mediaId
      const m = mediaRef.current.find((x) => x.id === id)
      if (!m || m.kind === 'image') continue
      const sk = storeKeyOf(m)
      const was = peaksAsked.current.get(id)
      if (was === sk) continue
      if (was !== undefined) setPeaks((prev) => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n })
      peaksAsked.current.set(id, sk)
      const run = async () => {
        const mm = mediaRef.current.find((x) => x.id === id)
        const stale = () => peaksAsked.current.get(id) !== sk
        if (!mm || storeKeyOf(mm) !== sk) { if (!stale()) peaksAsked.current.delete(id); return }
        // ②：原档没下载进这台（剪辑用小档走云盘）⇒ 用终端算好的那份波形（本机储存里）·没有就从小档的声音算
        const src = filesRef.current.get(id) ?? (await host.media.readOriginal(mm, projRef.current?.id ?? null)) ?? (mm.kind === 'video' && mm.proxied ? await readProxy(sk) : null)
        const p = await makePeaks(sk, src, mm.duration)
        if (!src && !p.peaks) { if (!stale()) peaksAsked.current.delete(id); return }
        if (stale()) return // 算的时候这份素材换了内容 ⇒ 这份作废（新的那份另排）
        const pk = p.peaks
        if (pk) { setPeaks((prev) => ({ ...prev, [id]: pk })); if (mm.noSound) patchMedia(id, { noSound: false }) }
        // 有声音轨却解不开（编码不支援、解出 0 个样本）或音频档读不到声音轨 ⇒ 标无声＋提示怎么转档＋重试（汇出那边也会挡下·⛔ 静音汇出）
        else if (soundUndecodable(mm.kind, p.sound)) flagNoSound(mm, true)
      }
      peaksJob.current = peaksJob.current.then(run, run).catch(() => {})
    }
  }, [tracks, media, peaksNudge, storeKeyOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleLane = useCallback((laneId: string, flag: 'locked' | 'hidden' | 'muted') => {
    const l = tracksRef.current.find((x) => x.id === laneId)
    if (l) runCmd([{ command: 'lane.setFlag', params: { lane: laneId, flag, on: !l[flag] } }]) // 命令化第二期：轨道头锁／眼睛／喇叭＝lane.setFlag（＝T.setLaneFlag）
  }, [runCmd])
  // 片段拖位／拉两端：滑鼠事件挂在 window 上（片段拖到别条轨会换父元素重挂·挂在片段自己身上会断）；锁了的轨上的不进选取、不拖不拉。
  // 拖位对整批选取（相对位置不变·能跨到同种的别条轨）；按住 Alt（⌥）拖＝复制一份（原片段留着）·放手后选取复制出来的那几段。
  // ids＝这趟拖的那一批·copies＝Alt 复制时各段新编号（整趟固定）·copied＝最后一下是不是复制·collapse＝按在多选里的一段却没拖 ⇒ 放手只选它
  // （片段能离开原轨）：over＝滑鼠最后在哪条轨（d.base 里的）／上区最上、音频区最下那片空白；newLanes＝这趟拖动新增的轨（来源轨 ⇒ 新轨编号·整趟固定）
  const dragRef = useRef<{ mode: 'move' | 'l' | 'r'; lane: string; clip: T.TlClip; ids: readonly string[]; copies: Map<string, string>; copied: boolean; collapse: boolean; x0: number; sl0: number; base: T.Tracks; moved: boolean; over: { lane: string } | { edge: 'top' | 'bottom' }; newLanes: Map<string, string>
    /** 吸住的那条对齐线（顿住用·整趟拖动带着）；：t0＝按下那一刻滑鼠在时间轴的哪一秒（磁吸插入照滑鼠落点） */ hold: SnapHold; t0: number
    /** y0＝按下那一刻滑鼠的 y；float＝跟着滑鼠走的那份复制品（拖位才有） */ y0: number; float: DragFloat | null } | null>(null)
  /** 拖位时落点那几段（轨道上淡掉画＝会落在这里·本身另有一份跟着滑鼠走） */
  const [landIds, setLandIds] = useState<string>('')
  const clipDrag = useMemo(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      if (!gestureRef.current!.step()) return   // 拖到一半罩落 ⇒ 这一下作废（已退回按下那刻·监听也放掉了）
      // 拖到捲动区左右缘 ⇒ 自动捲；捲走的距离算进位移
      const sc = scrollRef.current
      if (sc) {
        const r = sc.getBoundingClientRect()
        if (e.clientX > r.right - 40) sc.scrollLeft += 24
        else if (e.clientX < r.left + LABEL_W + 24) sc.scrollLeft = Math.max(0, sc.scrollLeft - 24)
      }
      const dx = e.clientX - d.x0 + ((sc?.scrollLeft ?? 0) - d.sl0)
      let toLane = d.lane
      let edge: 'top' | 'bottom' | undefined
      if (d.mode === 'move') {
        // 滑鼠下是哪条轨／哪片空白（只认轨道区里的·预览叠层也带 data-lane-id 要排掉）；拖着时新增出来的轨不在 d.base ⇒ 照上一下的落点（免得来回跳）
        const n = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-testid="vedit-lane"],[data-lane-edge]')
        const over = n?.getAttribute('data-lane-id')
        if (over) { if (d.base.some((l) => l.id === over)) d.over = { lane: over } }
        else if (n) d.over = { edge: n.getAttribute('data-lane-edge') === 'bottom' ? 'bottom' : 'top' }
        if ('lane' in d.over) toLane = d.over.lane
        else edge = d.over.edge
      }
      if (!d.moved && Math.abs(dx) < 3 && toLane === d.lane && !edge) return
      if (!d.moved && d.mode === 'move') {
        const root = scrollRef.current
        d.float = floatClones(d.ids.map((id) => root?.querySelector(`[data-testid="vedit-clip"][data-clip-id="${CSS.escape(id)}"]`)).filter((x): x is Element => !!x))
      }
      d.moved = true
      d.float?.move(e.clientX - d.x0, e.clientY - d.y0)
      const px = pxRef.current
      const dt = dx / px
      // 自动吸附开着 ⇒ 片头片尾（拉两端＝拉的那头）贴齐播放头、别段头尾、标记旗·吸住后要拖出一小段才放开（顿住）·吸住画浅蓝竖线；关掉 ⇒ 不吸
      const pref = tlPrefsRef.current
      const mainUnlocked = !!d.base.find((l) => l.id === T.MAIN_LANE && !l.locked)
      const { thr, release } = snapThresholds(px, pref.snap && !(pref.magnet && mainUnlocked && d.mode === 'l' && d.lane === T.MAIN_LANE)) // 磁吸拉主轨片头：片头留在原位·不吸
      const pts = [...T.snapPoints(d.base, nowRef.current, d.mode === 'move' ? new Set(d.ids) : d.clip.id), ...markersOf(d.base)]
      const src = mediaOf(d.clip.mediaId)
      const srcDur = !src || src.kind === 'image' ? Infinity : src.duration
      d.copied = d.mode === 'move' && e.altKey
      const laneShift = d.base.findIndex((l) => l.id === toLane) - d.base.findIndex((l) => l.id === d.lane)
      const newLaneId = (from: string) => { let id = d.newLanes.get(from); if (!id) { id = uid(); d.newLanes.set(from, id) } return id }
      let next: T.Tracks
      if (d.mode === 'move') {
        const s = holdSnap(d.clip.start + dt, [0, d.clip.length], pts, thr, release, d.hold)
        d.hold = s.hit
        const opts: T.MoveOpts = { copy: d.copied, newId: (old) => d.copies.get(old) ?? uid(), edge, newLaneId, overlapNew: true } // 撞到别段 ⇒ 上面新开一条
        // 主轨磁吸：落进主轨＝照滑鼠落点（按下那一刻的时刻＋位移）插在那两段之间·从主轨拖走 ⇒ 后面往前补
        next = pref.magnet ? magnetMove(d.base, d.ids, s.v - d.clip.start, laneShift, opts, d.t0 + dt) : T.moveGroup(d.base, d.ids, s.v - d.clip.start, laneShift, opts)
        const landed = T.findClip(next, d.copied ? d.copies.get(d.clip.id) ?? d.clip.id : d.clip.id)
        if (pref.magnet && mainUnlocked && landed?.lane.id === T.MAIN_LANE) d.hold = null   // 插进主轨＝排在插入处·不画对齐线
      } else {
        const s = holdSnap(d.mode === 'l' ? d.clip.start + dt : d.clip.start + d.clip.length + dt, [0], pts, thr, release, d.hold)
        d.hold = s.hit
        // 主轨磁吸：拉主轨片段的两端 ⇒ 片头留在原位·后面的跟着补／推（rippleTrim）
        next = (pref.magnet ? rippleTrim : T.trimClip)(d.base, d.clip.id, d.mode, s.v, srcDur)
      }
      setSnapLine(d.hold ? d.hold.p : null)
      if (d.mode === 'move') setLandIds((d.copied ? d.ids.map((id) => d.copies.get(id) ?? id) : d.ids).join(','))
      tracksRef.current = next
      setTracks(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const d = dragRef.current
      dragRef.current = null
      setSnapLine(null)
      d?.float?.end(); setLandIds('')
      const ok = d ? gestureRef.current!.end() : null   // 罩期放手 ⇒ null（已退回·不记复原）
      gestureEndRef.current = () => {}
      if (d && !d.moved && d.collapse) setSel([d.clip.id])
      if (!ok || !d?.moved || tracksRef.current === d.base) return
      const next = T.pruneLanes(tracksRef.current) // 拖走后空了的非主轨收掉
      // 命令化第二期：拉两端＝clip.trim·单段拖位（不复制）＝clip.move——在按下那刻的轨道上重算·跟拖出来的一模一样才记命令账（轨道照拖出来那份·内容相同）；
      //   磁吸插入／排紧、整组拖、撞位开新轨、Alt 复制…命令表没有的玩法 ⇒ 不记（角色改档撞上时不重放·照旧问）
      const fd = T.findClip(next, d.clip.id)
      const steps: CommandStep[] = !fd ? [] : d.mode !== 'move' ? [{ command: 'clip.trim', params: { clip: d.clip.id, side: d.mode === 'l' ? 'start' : 'end', at: d.mode === 'l' ? fd.clip.start : fd.clip.start + fd.clip.length } }]
        : !d.copied && d.ids.length === 1 && d.ids[0] === d.clip.id ? [{ command: 'clip.move', params: { clip: d.clip.id, at: fd.clip.start, lane: fd.lane.id } }] : []
      if (steps.length) logVia(d.base, steps, next, true)
      tracksRef.current = next
      setTracks(next)
      histRef.current = T.commitHist(histRef.current, d.base); setHistTick((n) => n + 1)
      if (d.copied) setSel([...d.copies.values()].filter((id) => T.findClip(next, id)))
    }
    return { move, up }
  }, [mediaOf])
  const onClipDown = (lane: T.Lane, clip: T.TlClip, mode: 'move' | 'l' | 'r') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    releaseTypingFocus()
    setSelected(clip.mediaId); setSourceMode(false)
    // Ctrl／⌘＋点＝加入／移出选取（Mac 的 Ctrl＋点是右键·只认 ⌘）·不拖
    const additive = e.metaKey || (e.ctrlKey && !isMac)
    const cur = selRef.current
    if (aiLockedRef.current) { setSel(groupClickSelect(tracksRef.current, cur, clip.id, additive)); return }   // 罩期点片段只选不拖
    if (additive || lane.locked) { setSel(groupClickSelect(tracksRef.current, cur, clip.id, additive)); return }   // Ctrl＋点组里一段＝整组进出
    const inSel = cur.includes(clip.id)
    if (!inSel) setSel([clip.id])
    // 群组：按住组里一段拖 ⇒ 整组一起挪（拉两端只拉这一段）
    const ids = mode === 'move' ? (inSel ? cur : groupMembers(tracksRef.current, clip.id)) : [clip.id]
    if (!gesture.begin(tracksRef.current)) return
    gestureEndRef.current = () => {
      const d = dragRef.current
      dragRef.current = null
      d?.float?.end(); setLandIds(''); setSnapLine(null)
      window.removeEventListener('pointermove', clipDrag.move); window.removeEventListener('pointerup', clipDrag.up); window.removeEventListener('pointercancel', clipDrag.up)
    }
    dragRef.current = { mode, lane: lane.id, clip, ids, copies: new Map(ids.map((id) => [id, uid()])), copied: false, collapse: inSel && cur.length > 1, x0: e.clientX, y0: e.clientY, float: null, sl0: scrollRef.current?.scrollLeft ?? 0, base: tracksRef.current, moved: false, over: { lane: lane.id }, newLanes: new Map(),
      hold: null, t0: rulerRef.current ? (e.clientX - rulerRef.current.getBoundingClientRect().left) / pxRef.current : clip.start }
    window.addEventListener('pointermove', clipDrag.move)
    window.addEventListener('pointerup', clipDrag.up)
    window.addEventListener('pointercancel', clipDrag.up)
  }
  useEffect(() => () => { window.removeEventListener('pointermove', clipDrag.move); window.removeEventListener('pointerup', clipDrag.up); window.removeEventListener('pointercancel', clipDrag.up) }, [clipDrag])
  // 按住轨道头上下拖 ⇒ 换轨道顺序（T.moveLane·只在自己那一区·锁了的轨不动）；
  // 落点＝滑鼠以上有几条别的轨（照各行中线算·行高不同也不来回跳）；放手才记一笔复原（顺序没变 ⇒ 不记）
  const laneDragRef = useRef<{ id: string; base: T.Tracks; y0: number; float: DragFloat | null } | null>(null)
  const [laneLand, setLaneLand] = useState<string | null>(null) // 拖着的轨道那一行（原位淡掉＝会插在这里）
  const laneDrag = useMemo(() => {
    const move = (e: PointerEvent) => {
      const d = laneDragRef.current
      if (!d) return
      if (!gestureRef.current!.step()) return   // 拖到一半罩落 ⇒ 作废
      if (!d.float && Math.abs(e.clientY - d.y0) >= 3) { d.float = floatClones([document.querySelector(`[data-testid="vedit-lane"][data-lane-id="${CSS.escape(d.id)}"]`)].filter((x): x is Element => !!x)); setLaneLand(d.id) }
      d.float?.move(0, e.clientY - d.y0)
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="vedit-lane"]')).filter((el) => el.dataset.laneId !== d.id)
      const to = rows.filter((el) => { const q = el.getBoundingClientRect(); return q.top + q.height / 2 < e.clientY }).length
      const cur = tracksRef.current
      const next = T.moveLane(cur, d.id, to)
      if (next === cur) return
      tracksRef.current = next
      setTracks(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const d = laneDragRef.current
      laneDragRef.current = null
      d?.float?.end(); setLaneLand(null)
      const ok = d ? gestureRef.current!.end() : null
      gestureEndRef.current = () => {}
      if (!d || !ok || tracksRef.current === d.base) return
      if (tracksRef.current.map((l) => l.id).join('\n') === d.base.map((l) => l.id).join('\n')) { tracksRef.current = d.base; setTracks(d.base); return }
      histRef.current = T.commitHist(histRef.current, d.base); setHistTick((n) => n + 1)
      logVia(d.base, [{ command: 'lane.move', params: { lane: d.id, index: tracksRef.current.findIndex((l) => l.id === d.id) } }], tracksRef.current, false) // 命令化第二期：放手＝lane.move
    }
    return { move, up }
  }, [])
  useEffect(() => () => { window.removeEventListener('pointermove', laneDrag.move); window.removeEventListener('pointerup', laneDrag.up); window.removeEventListener('pointercancel', laneDrag.up) }, [laneDrag])
  const onLaneHeadDown = (ln: T.Lane) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || ln.locked || ln.id === T.MAIN_LANE) return   // 主轨本身不能拖
    if (aiLockedRef.current) return   // 罩期：轨道不能排
    e.preventDefault()
    if (!gesture.begin(tracksRef.current)) return
    gestureEndRef.current = () => {
      const d = laneDragRef.current
      laneDragRef.current = null
      d?.float?.end(); setLaneLand(null)
      window.removeEventListener('pointermove', laneDrag.move); window.removeEventListener('pointerup', laneDrag.up); window.removeEventListener('pointercancel', laneDrag.up)
    }
    laneDragRef.current = { id: ln.id, base: tracksRef.current, y0: e.clientY, float: null }
    window.addEventListener('pointermove', laneDrag.move)
    window.addEventListener('pointerup', laneDrag.up)
    window.addEventListener('pointercancel', laneDrag.up)
  }
  // 框选：轨道空白处按住拉框——框到的轨、时间有交集的片段（锁了的轨不算）；按着 Ctrl／⌘ ⇒ 并进原选取；没拉动＝点空白 ⇒ 清空选取
  const canvasRef = useRef<HTMLDivElement>(null)
  const boxFrom = useRef<{ x: number; y: number; base: readonly string[]; moved: boolean } | null>(null)
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const onLanesPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('[data-clip-id],[data-lane-head],button,input')) return
    const additive = e.metaKey || (e.ctrlKey && !isMac)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 抓不到照样框 */ }
    boxFrom.current = { x: e.clientX, y: e.clientY, base: additive ? selRef.current : [], moved: false }
    if (!additive) setSel([])
  }
  const onLanesPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = boxFrom.current
    if (!b || (!b.moved && Math.abs(e.clientX - b.x) < 3 && Math.abs(e.clientY - b.y) < 3)) return
    b.moved = true
    const cv = canvasRef.current?.getBoundingClientRect()
    const r = rulerRef.current?.getBoundingClientRect()
    if (!cv || !r) return
    const x0 = Math.min(b.x, e.clientX), x1 = Math.max(b.x, e.clientX), y0 = Math.min(b.y, e.clientY), y1 = Math.max(b.y, e.clientY)
    setMarquee({ left: x0 - cv.left, top: y0 - cv.top, width: x1 - x0, height: y1 - y0 })
    const laneIds = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-lane-id]'))
      .filter((el) => { const q = el.getBoundingClientRect(); return q.bottom > y0 && q.top < y1 })
      .map((el) => el.dataset.laneId ?? '')
    const px = pxRef.current
    setSel(T.boxSelect(tracksRef.current, laneIds, (x0 - r.left) / px, (x1 - r.left) / px, b.base))
  }
  const onLanesPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!boxFrom.current) return
    boxFrom.current = null
    setMarquee(null)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已放 */ }
  }
  // 右键选单：点在选取里 ⇒ 对整批；不在 ⇒ 先只选它（锁了的轨上的不进选取·选单只对它、改动的项灰掉）；轨道空白处右键 ⇒ 只有「贴上」
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  const onClipMenu = (lane: T.Lane, clip: T.TlClip) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation()
    const cur = selRef.current
    if (!lane.locked && !cur.includes(clip.id)) setSel([clip.id])
    setMenu({ x: e.clientX, y: e.clientY, ids: lane.locked ? [clip.id] : T.menuTargets(cur.includes(clip.id) ? cur : groupMembers(tracksRef.current, clip.id), clip.id) })
  }
  const onLanesMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('[data-clip-id],[data-lane-head]')) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, ids: [] })
  }
  const runMenu = (act: T.MenuAct, ids: readonly string[]) => {
    setMenu(null)
    switch (act) {
      case 'copy': copyClips(ids); break
      case 'cut': cutClips(ids); break
      case 'paste': pasteClips(); break
      case 'delete': deleteClips(ids); break
      case 'duplicate': duplicateClips(ids); break
      case 'split': splitClips(ids); break
      case 'detach': detachClips(ids); break
      case 'stems': void clipStems.start(ids); break
      case 'mute': flagClips(ids, 'muted'); break
      case 'disable': flagClips(ids, 'disabled'); break
      case 'replace': setReplaceFor(ids); break
      case 'find': findInMedia(ids); break
      case 'add-chat': addToChat(ids); break
      // 命令化第二期：群组／取消群组＝clip.group／clip.ungroup（＝groupClips／ungroupClips·只送没锁的那几段·同它们自己略过的）
      case 'group': runCmd([{ command: 'clip.group', params: { clips: ids.filter((id) => T.editable(tracksRef.current, id)) } }]); break
      case 'ungroup': runCmd([{ command: 'clip.ungroup', params: { clips: ids.filter((id) => T.editable(tracksRef.current, id)) } }]); break
      case 'subclip': void makeSubClip(ids); break
      case 'merge': void mergeClips(ids); break
      case 'freeze': freezeNow(ids); break
      case 'reverse': reverseNow(ids); break
      case 'mirror': mirrorNow(ids); break
      case 'copy-attr': copyAttrsNow(ids); break
      case 'paste-attr': pasteAttrsNow(ids); break
    }
  }
  useEffect(() => {
    if (!menu) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    const close = () => setMenu(null)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('keydown', esc); window.removeEventListener('blur', close); window.removeEventListener('resize', close) }
  }, [menu])
  // 时间尺按下／拖 ⇒ 播放头跟着走（clientX 一律量到时间尺 0 秒那条边）
  const rulerDrag = useRef(false)
  const rulerRef = useRef<HTMLDivElement>(null)
  const seekAtX = (clientX: number) => {
    followRef.current = true; autoSL.current = null // 点尺规 ⇒ 恢复跟着播放头捲
    const r = rulerRef.current
    if (r) seekTimeline((clientX - r.getBoundingClientRect().left) / pxRef.current)
  }
  // 播放头整条（时间尺到轨道底）都能按住拖：按下那一点与线的距离记住·拖时不跳
  const headGrab = useRef<number | null>(null)
  const onHeadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = rulerRef.current
    headGrab.current = r ? e.clientX - (r.getBoundingClientRect().left + nowRef.current * pxRef.current) : 0
    setSourceMode(false); setPlaying(false)
  }
  // 按住播放头拖到轨道区左／右边外 ⇒ 时间轴自己往那边捲（同 Alt＋滚轮那种直接挪 scrollLeft）·播放头贴在边上跟着走
  const headX = useRef(0)
  const headRaf = useRef(0)
  const headSeek = () => {
    const el = scrollRef.current
    if (headGrab.current === null) return
    if (!el) { seekAtX(headX.current - headGrab.current); return }
    const r = el.getBoundingClientRect()
    seekAtX(Math.min(r.right - 1, Math.max(r.left + LABEL_W, headX.current - headGrab.current)))
  }
  const headTick = () => {
    headRaf.current = 0
    const el = scrollRef.current
    if (headGrab.current === null || !el) return
    const r = el.getBoundingClientRect()
    const d = T.edgeScrollStep(headX.current, r.left + LABEL_W, r.right)
    if (d) { const sl = el.scrollLeft; el.scrollLeft = sl + d; if (el.scrollLeft !== sl) headSeek() }
    headRaf.current = requestAnimationFrame(headTick)
  }
  const onHeadMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (headGrab.current === null) return
    headX.current = e.clientX
    headSeek()
    if (!headRaf.current) headRaf.current = requestAnimationFrame(headTick)
  }
  const onHeadUp = (e: React.PointerEvent<HTMLDivElement>) => {
    headGrab.current = null
    if (headRaf.current) { cancelAnimationFrame(headRaf.current); headRaf.current = 0 }
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已放 */ }
  }

  // ── 时间轴捲动区：Ctrl／触控板捏合＝以游标为锚缩放·两指滑＝原生捲动；播放时跟着播放头捲 ──
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Alt（⌥）＋滚轮＝时间轴左右捲（滚轮行数制换成像素）
      if (e.altKey && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1)
        el.scrollLeft += d
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const old = pxRef.current
      const nx = T.zoomBy(old, T.wheelZoomFactor(e.deltaY, e.deltaMode), floorRef.current) // 滚轮一格只放大缩小约两成
      if (nx === old) return
      const sl = el.scrollLeft
      const cx = e.clientX - el.getBoundingClientRect().left - LABEL_W
      pxRef.current = nx
      setPxPerSec(nx)
      requestAnimationFrame(() => { el.scrollLeft = T.zoomScroll(sl, cx, old, nx) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    const fit = () => setViewW(Math.max(100, el.clientWidth - LABEL_W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => { el.removeEventListener('wheel', onWheel); ro.disconnect() }
  }, [gate])
  // 播放中使用者自己捲了（拖捲轴／滚轮横捲／触控板）⇒ 停止跟随·播放头在画面外照放；再按播放或点尺规 ⇒ 恢复跟随
  const followRef = useRef(true)
  // 上次我们自己捲到哪（读回值·连同当时的缩放）：之后读到的 scrollLeft 跟它对不上 ⇒ 是使用者捲的。
  const autoSL = useRef<{ sl: number; px: number } | null>(null)
  const playingNowRef = useRef(playing)
  playingNowRef.current = playing
  const userMoved = (el: HTMLElement, px: number) => !!autoSL.current && autoSL.current.px === px && T.userScrolled(el.scrollLeft, autoSL.current.sl)
  useEffect(() => {
    if (!playing) return
    followRef.current = true
    const el = scrollRef.current
    autoSL.current = el ? { sl: el.scrollLeft, px: pxRef.current } : null // 按播放那刻当基准（播放头还在画面里时使用者捲走也认得出）
  }, [playing])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // 横向捲到哪记成 CSS 变量（--tl-sl）·播放头／对齐线捲到轨道头底下时照它裁掉（不盖住轨道头）
    const sl = () => el.style.setProperty('--tl-sl', `${el.scrollLeft}px`)
    sl()
    const onScroll = () => { sl(); if (playingNowRef.current && followRef.current && userMoved(el, pxRef.current)) followRef.current = false }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate])
  useEffect(() => {
    const el = scrollRef.current
    if (!playing || !el || !followRef.current) return
    if (userMoved(el, pxPerSec)) { followRef.current = false; return } // 使用者捲过了 ⇒ ⛔ 再拉回来
    if (!autoSL.current || autoSL.current.px !== pxPerSec) autoSL.current = { sl: el.scrollLeft, px: pxPerSec } // 缩放过 ⇒ 换基准
    const next = T.followScroll(now * pxPerSec, el.scrollLeft, el.clientWidth - LABEL_W)
    if (next === null) return
    el.scrollLeft = next
    autoSL.current = { sl: el.scrollLeft, px: pxPerSec } // 读回（浏览器会夹在可捲范围内）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, playing, pxPerSec])
  // 播放器上捏合放大画面·双击回原尺寸
  const playerBoxRef = useRef<HTMLDivElement>(null)
  const [pvScale, setPvScale] = useState(1)
  // 时间轴预览里每份素材的原比例（载入时读）·给 fitLayerCss 撑满舞台（同汇出 containRect）
  const [pvAspect, setPvAspect] = useState<Record<string, number>>({})
  const notePvAspect = useCallback((id: string, w: number, h: number) => { if (w > 0 && h > 0) { const r = w / h; setPvAspect((o) => (o[id] === r ? o : { ...o, [id]: r })) } }, [])
  useEffect(() => {
    const el = playerBoxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setPvScale((s) => T.previewScale(s, e.deltaY)) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gate])

  // ── 播放器「比例」与「全屏」：比例存本机（还没有工程档）·时间轴预览画在这个比例的黑框里（放不满补黑边）·看单份原素材不套 ──
  const [ratioSel, setRatioSel] = useState<RatioSel>({ kind: 'fit' })
  useEffect(() => { try { setRatioSel(parseRatio(window.localStorage.getItem(VEDIT_RATIO_KEY))) } catch { /* 读不到用「适应」 */ } }, [])
  const changeRatio = useCallback((v: RatioSel) => {
    if (aiLockedRef.current) { aiNoteRef.current(); return }
    setRatioSel(v)
    try { window.localStorage.setItem(VEDIT_RATIO_KEY, JSON.stringify(v)) } catch { /* 存不进只影响下次开页 */ }
  }, [])
  // 汇入别家工程（lib/import-project.pure）：素材＝一起选进来、档名对得上的档（素材区已有同名的也算）；整条时间轴换成那份（可按复原退回）·比例照那份
  importOtherRef.current = async (proj, app, rest) => {
    if (aiLockedRef.current) { aiNoteRef.current(); return [] }
    let p
    try { p = importProject(proj.name, await proj.text(), app) } catch (e) {
      setNotice(e instanceof ImportBad && e.code === 'encrypted' ? t('vedit_import_encrypted') : t('vedit_import_bad').replace('{err}', e instanceof Error ? e.message : String(e)))
      return []
    }
    const added = rest.length ? await onPick(rest) : []
    const pool = [...added, ...mediaRef.current.filter((m) => !added.includes(m))]
    const r = importedToTracks(p, (m) => matchByName(m, pool)?.id ?? null, uid)
    const chk = parseProjectIssues({ ratio: p.ratio, tracks: r.tracks, media: mediaRef.current.map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: m.duration, from: 'local' })) })
    if (chk.ok && r.clips) { edit(chk.project.tracks); if (p.ratio.kind !== 'fit') changeRatio(p.ratio) }
    const lines = [t('vedit_import_done').replace('{n}', String(r.clips))]
    if (r.missing.length) lines.push(t('vedit_import_missing').replace('{names}', r.missing.map((m) => m.file).join('、')))
    if (p.notes.length) lines.push(t('vedit_import_notes').replace('{notes}', p.notes.map((n) => importNoteText(n, language)).join('、')))
    setNotice(lines.join(' '))
    return added
  }
  const fitRefId = useMemo(() => fitRefMediaId(tracks, T.MAIN_LANE, (id) => { const k = kindOfMedia(id); return k === 'image' || k === 'video' }), [tracks, kindOfMedia])
  const fitRef = fitRefId ? media.find((m) => m.id === fitRefId) ?? null : null
  // 探到的比例按「素材＋网址」记：网址换了（上传完、换成云盘链接）就重探；网址还没好不探（记成空就永不重探）
  const [aspects, setAspects] = useState<Record<string, number | null>>({})
  const fitKey = fitRef && fitRef.url ? `${fitRef.id}\u0000${fitRef.url}` : null
  useEffect(() => {
    if (!fitRef || !fitKey || fitKey in aspects) return
    let live = true
    void probeAspect(fitRef.url, fitRef.kind).then((a) => { if (live) setAspects((m) => ({ ...m, [fitKey]: a })) })
    return () => { live = false }
  }, [fitRef, fitKey, aspects])
  const [pvBox, setPvBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = playerBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPvBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [gate])
  const fitAspectNow = fitRef ? fitAspectOf(fitKey ? aspects[fitKey] : null, pvAspect[fitRef.id]) : null
  const stageRatio = ratioOf(ratioSel, fitAspectNow)
  stageRatioRef.current = stageRatio
  const playerRef = useRef<HTMLDivElement>(null)
  const [isFull, setIsFull] = useState(false)
  useEffect(() => {
    const on = () => setIsFull(!!playerRef.current && document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = () => {
    const el = playerRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen?.().catch(() => {})
  }

  // ── 剪映快捷键：输入框／对话框打字时不吃键；弹窗开着不吃 ──
  const overlayOpen = importAsk || !!menu || !!replaceFor || licensesOpen || host.overlayOpen()
  /** 键动作 ⇒ 做了没（没做 ⇒ 不吃键：例如有反白文字时 Ctrl+C 照浏览器复制字、没复制过片段时 Ctrl+V 照浏览器贴上） */
  const keyRef = useRef<(a: T.KeyAct) => boolean>(() => false)
  keyRef.current = (a) => {
    const textPicked = () => { try { return !!window.getSelection()?.toString() } catch { return false } }
    if (aiLockedRef.current && AI_LOCK_KEY_ACTS.has(a) && !(a === 'cut' && textPicked())) { aiNoteRef.current(); return true }   // 罩期：改轨道的键挡掉
    switch (a) {
      case 'copy': if (textPicked() || !selRef.current.length) return false; copyClips(selRef.current); break
      case 'copy-attr': if (!selRef.current.length) return false; return copyAttrsNow(selRef.current)
      case 'paste-attr': return pasteAttrsNow(selRef.current)
      case 'cut': if (textPicked() || !selRef.current.length) return false; cutClips(selRef.current); break
      case 'paste': if (!boardRef.current) return false; pasteClips(); break
      case 'play': togglePlay(); break
      case 'frame-prev': step(-1, T.FRAME); break
      case 'frame-next': step(1, T.FRAME); break
      // Alt（⌥）＋←→＝选中片段前后挪一帧（锁了的轨不动·撞到别段或 0 秒就不动）
      case 'nudge-prev': case 'nudge-next': {
        const ids = T.liveSelection(tracksRef.current, selRef.current); if (!ids.length) return false
        const legacy = T.moveGroup(tracksRef.current, [...ids], a === 'nudge-prev' ? -T.FRAME : T.FRAME, 0)
        // 命令化第二期：只挪一段 ⇒ clip.move（重算跟 moveGroup 一样才用命令那份·撞到别段／0 秒不动等照原算法）
        const one = ids.length === 1 ? T.findClip(tracksRef.current, ids[0]) : null
        if (one) editVia([{ command: 'clip.move', params: { clip: one.clip.id, at: Math.max(0, one.clip.start + (a === 'nudge-prev' ? -T.FRAME : T.FRAME)) } }], legacy)
        else edit(legacy)
        break
      }
      case 'sec-prev': step(-1, 1); break
      case 'sec-next': step(1, 1); break
      case 'edge-prev': seekTimeline(T.nextEdge(tracksRef.current, nowRef.current, -1)); break
      case 'edge-next': seekTimeline(T.nextEdge(tracksRef.current, nowRef.current, 1)); break
      case 'split': splitNow(); break
      case 'delete': deletePicked(); break
      case 'undo': undo(); break
      case 'redo': redo(); break
      case 'zoom-in': setPxPerSec((p) => T.zoomBy(p, 1.25, floorRef.current)); break
      case 'zoom-out': setPxPerSec((p) => T.zoomBy(p, 0.8, floorRef.current)); break
      case 'home': seekTimeline(0); break
      case 'end': seekTimeline(T.timelineEnd(tracksRef.current)); break
      case 'add-chat': {
        // 选中片段 ⇒ 片段卡；没选片段但选了时间尺上的标记 ⇒ 标记卡；素材区点着一份（播放器在看原素材）⇒ 素材卡
        if (selRef.current.length) { addToChat(selRef.current); break }
        if (selTransRef.current) { addTransToChat(selTransRef.current); break }   // 选中的转场 ⇒ 转场卡
        if (selMarkerRef.current !== null) { addMarkerToChat(selMarkerRef.current); break }
        if (sourceModeRef.current && selectedRef.current) { addMediaToChat(selectedRef.current); break }
        return false
      }
      // 全选＝时间轴上全部片段（锁了的轨不选）·时间轴空着就照浏览器原样
      case 'select-all': { const all = T.liveSelection(tracksRef.current, T.allClips(tracksRef.current).map((c) => c.id)); if (!all.length) return false; setSel([...all]); setSelTrans(null); break }
      // 剪映工具列单键——A 选择·B 刀片·[ ] 向左／右全选·Q W 向左／右裁剪·M 加标记；Esc：刀片回选择、放掉选中的标记，都没有就不吃键
      case 'tool-select': pickTool('select'); break
      case 'tool-blade': pickTool('blade'); break
      case 'select-left': selectSideNow('left'); break
      case 'select-right': selectSideNow('right'); break
      case 'trim-left': return trimNow('left')
      case 'trim-right': return trimNow('right')
      case 'marker': markerNow(); break
      case 'escape':
        if (toolRef.current === 'blade') { pickTool('select'); break }
        if (selMarkerRef.current !== null) { setSelMarker(null); break }
        return false
    }
    return true
  }
  const overlayRef = useRef(overlayOpen)
  overlayRef.current = overlayOpen
  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const n = target as HTMLElement | null
      return !!n && (n.isContentEditable || !!n.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
    }
    // （刚在属性面板拖缩放滑杆）：焦点停在滑杆／勾选框／色盘这类不打字的框上 ⇒ Ctrl／⌘ 组合键照样归页面（撤销重做、复制贴上）·方向键空白键仍给那个框
    const noTextBox = (target: EventTarget | null) => target instanceof HTMLInputElement && T.NON_TEXT_INPUT.has(target.type)
    const down = (e: KeyboardEvent) => {
      if (overlayRef.current) return
      const a = T.keyAction(e, typing(e.target) && !((e.ctrlKey || e.metaKey) && noTextBox(e.target)))
      if (!a) return
      if (keyRef.current(a)) e.preventDefault()
    }
    // 空白键在按钮上放开会再按一次那颗钮 ⇒ 我们吃了的空白键放开也吃掉
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && !overlayRef.current && !typing(e.target)) e.preventDefault() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // ── AI 对话框（同桌宠窗：没有档·角色存本机）──
  // ── 加進對話：选中的片段（可多选）进右边对话框——输入框上方一张小卡（× 拿掉）；送出时这几段的描述随正文带给角色
  //   （⛔ 另造通道：走右栏现成的上下文行 wire.contextLine ⇒ sendContext·正文头那几行·气泡上藏）；送出后那则讯息上方带同一张卡·点卡 ⇒ 这里把那几段选起来、播放头跳到第一段开头 ──
  // 改成行内小卡——选中的几段＝一颗小卡插在输入框光标处
  //   （能跟字混排、前后挪、退格整颗删）；送出时记号就在正文原位（_lib/vedit-inline.pure buildClipToken）·⛔ 再走输入框上方那张卡／上下文行第二行；
  //   云盘条目拖进输入卡＝插在落点（ComposerAttachContext.inline·只本页给）
  const chat = host.chat
  const addToChat = useCallback((ids: readonly string[]) => {
    if (!ids.length || !chat) return
    // 片段身上的特效、转场也写进卡里那一格
    const token = chat.clipsToken(tracksRef.current, ids, (id) => mediaRef.current.find((m) => m.id === id)?.name)
    if (!token) return
    if (!chat.insert(token)) setNotice(t('vedit_ref_pick_role')) // 还没选角色 ⇒ 小卡先排着·选好角色输入框一挂上就插进去
  }, [chat, t])
  /** 选中的接缝转场 ⇒ 一颗转场卡（点卡＝轨道跳到接缝） */
  const addTransToChat = useCallback((clipId: string) => {
    const f = T.findClip(tracksRef.current, clipId)
    const tr = f?.clip.transIn
    const token = f && tr && chat ? chat.transToken(f.clip.start, tr.tr, tr.length) : null
    if (!token || !chat) return
    if (!chat.insert(token)) setNotice(t('vedit_ref_pick_role'))
  }, [chat, t])
  /** 时间尺上选中的标记 ⇒ 一颗标记卡插在光标处 */
  const addMarkerToChat = useCallback((at: number) => {
    const token = chat ? chat.markerToken(at) : null
    if (!token || !chat) return
    if (!chat.insert(token)) setNotice(t('vedit_ref_pick_role'))
  }, [chat, t])
  /** 素材区选中的那份 ⇒ 一颗素材卡（拖进对话框同一颗） */
  const mediaTokenOf = useCallback((m: Pick<Media, 'id' | 'name' | 'kind'>) => (chat ? chat.mediaToken(m) : null), [chat])
  const addMediaToChat = useCallback((id: string) => {
    const m = mediaRef.current.find((x) => x.id === id)
    const token = m ? mediaTokenOf(m) : null
    if (!token || !chat) return
    if (!chat.insert(token)) setNotice(t('vedit_ref_pick_role'))
  }, [chat, mediaTokenOf, t])
  // 剪辑页那行下面再带一行专案现况（比例、总长、播放头、各轨片段、素材区、选中段）。
  //   停手 250ms 才重算（拖播放头、拖片段时不每帧重画对话框）；播放中不盯播放头（只写「播放中」）
  // 开着的云盘剪辑工程档（下面剪辑工程档那段管·这里先宣告·现况那行要看它）
  const [proj, setProj] = useState<{ id: string; title: string; folderId: string | null } | null>(null)
  const projRef = useRef(proj)
  projRef.current = proj
  // ── 剪辑工程档（檔：跟文件、表格一樣，邊剪邊自動存，雲盤點開就回到上次的樣子；
  //   素材照樣從雲盤引用，本機那份只當加速用」＋「Ai在编辑的时候要能实时看到变化」）：
  //   ?id= 开档 ⇒ 读工程档（素材：本机储存有就用本机·没有用云盘链接·两头都没有标缺素材）；改了停手 1.2 秒自动存（带版本·被别处改过 ⇒ 换成最新）；
  // 每 2 秒问一次版本 ⇒ 角色用 update_video_edit 改了就换上（进复原栈·按复原退得回）。没开档 ⇒ 一动手剪就自动建草稿。──
  const [projState, setProjState] = useState<'none' | 'loading' | 'ready' | 'gone'>('none')
  // 网址 ?id= 那份开页就开不到是哪一种（只在开档那一下置·开着开着被删＝projState 'gone' 那条照旧）——
  //   以前编号不对（?id=abc）／找不到 ⇒ 顶栏一行小字、底下照样一个「未命名剪輯」编辑器（看起来像开了一份新的）；
  //   现在 ⇒ 整页明说（编号不对不打服务端）·⛔ 画编辑器 ⇒ 屏上没有可动手的地方·草稿建档那条（draftNext 见网址带 id 也不建）走不到
  const [urlFail, setUrlFail] = useState<VeditLoadFail | null>(null)
  const projStateRef = useRef(projState)
  projStateRef.current = projState
  // 角色看一帧：开着就接 /api/vedit/relay·出帧的活照汇出那支画法画（vedit-relay-client／vedit-frame-shot）；
  //   同一份开在别的分页、那页是主分页（中继回 primary:false）⇒ 挂「這份剪輯在別的分頁開著」
  const [openElsewhere, setOpenElsewhere] = useState(false)
  useEffect(() => {
    if (gate !== 'ok' || !host.startRelay) return
    return host.startRelay({
      projectId: () => projRef.current?.id ?? null,
      loading: () => projStateRef.current === 'loading',
      env: () => exportEnvRef.current!(), ratio: () => stageRatioRef.current, playhead: () => nowRef.current,
      project: () => (projRef.current ? { id: projRef.current.id, title: projRef.current.title } : null),
      mediaInfo: (id) => { const m = mediaOf(id); return m ? { name: m.name, kind: m.kind } : null },
      onPrimary: (primary) => setOpenElsewhere(!primary),
    })
  }, [gate, mediaOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'held'>('idle')
  const projBaseRef = useRef<string | null>(null)   // 库里那份的版本（存档时带着·对不上 ⇒ 409）
  const projSavedRef = useRef('')                    // 最后存进去／读进来的内容
  const projBusyRef = useRef(false)                  // 正在存／读／改名（问版本那拍让开）
  const projGenRef = useRef(0)                       // 改名一次 +1（问版本那拍回来时变了 ⇒ 不拿它带回的旧名盖掉刚改的）
  // 群組讀寫修復提示獨立於短通知，免得被「已換成最新」同拍蓋掉。關掉後同原因不再刷。
  const [projectGroupNotice, setProjectGroupNotice] = useState<ProjectGroupNotice | null>(null)
  const projectGroupSeenRef = useRef<ProjectGroupNoticeSeen>(new Map())
  const reportProjectGroups = useCallback((projectId: string, drops: unknown) => {
    const next = takeProjectGroupNotice(projectId, drops, projectGroupSeenRef.current)
    if (next) setProjectGroupNotice((prev) => prev?.projectId === projectId
      ? { projectId, repaired: prev.repaired || next.repaired, review: prev.review || next.review } : next)
  }, [])
  const ratioRef = useRef(ratioSel)
  ratioRef.current = ratioSel
  /** 页面现况 ⇒ 工程档内容（用到的上传程序包一并内嵌·换台电脑也找得到·合计超过上限的不嵌） */
  const projectNow = useCallback((): VeditProject => {
    const used = [...new Set(T.allClips(tracksRef.current).map((c) => c.program?.pkg).filter((x): x is string => !!x && x.startsWith('u-')))].sort()
    const programs: Record<string, ProjectProgram> = {}
    let size = 0
    for (const k of used) {
      const b = progBundlesRef.current[k]
      if (!b) continue
      size += b.html.length
      if (size > VEDIT_PROGRAMS_EMBED_MAX) break
      programs[k] = { manifest: b.manifest, html: b.html }
    }
    return buildProject({ ratio: ratioRef.current, tracks: tracksRef.current, media: mediaRef.current, programs })
  }, [])
  /** （照剪映「本地草稿」格子）：这份的卡片＝总长＋封面（第一段画面素材那一格的缩图·同一格只画一次·画不出 ⇒ 没封面＝黑底） */
  const coverCacheRef = useRef<{ key: string; cover: string | null } | null>(null)
  const cardNow = useCallback(async (): Promise<{ duration: number; cover: string | null }> => {
    const tr = tracksRef.current
    const duration = T.timelineEnd(tr)
    const pick = coverPick(tr, (id) => mediaRef.current.find((m) => m.id === id)?.kind)
    const m = pick ? mediaRef.current.find((x) => x.id === pick.mediaId) : undefined
    if (!pick || !m?.url) return { duration, cover: null }
    const key = `${pick.mediaId}@${pick.at.toFixed(2)}@${m.url}`
    const hit = coverCacheRef.current
    if (hit && hit.key === key) return { duration, cover: hit.cover }
    const cover = await makeCover(m.url, pick.kind, pick.at)
    coverCacheRef.current = { key, cover }
    return { duration, cover }
  }, [])
  /** 工程档里的一份素材 ⇒ 页面素材（这页已有 ⇒ 照旧；本机储存有 ⇒ 本机；没有 ⇒ 云盘链接；都没有 ⇒ 缺素材） */
  const mediaFromProject = useCallback(async (pm: ProjectMedia, urls: Record<string, string>, denied: Record<string, string> = {}): Promise<Media> => {
    const have = mediaRef.current.find((m) => m.id === pm.id)
    const remote = pm.driveId ? urls[pm.driveId] : undefined
    const links = { ...(pm.stems ? { stems: pm.stems } : {}), ...(pm.stemOf ? { stemOf: pm.stemOf } : {}) } // 编曲素材分轨
    // 本机储存按内容的键（工程档编号＋云盘档编号·⛔ 只拿素材编号——别份工程也叫 m_vo 的会被读来播）
    const sk = storeKeyOf(pm)
    // 这页已有同编号的、内容也是同一份 ⇒ 照旧；同编号但换了内容（角色把 m_vo 指到别的云盘档）⇒ ⛔ 沿用旧的那份·当新素材重读
    const same = !!have && storeKeyOf(have) === sk
    // ②：别台转好、记进工程档的云盘小档 ⇒ 这页也认（这页刚转好还没存的那份留着）
    const cloud = pm.cloudProxy ?? (have?.cloudProxy && have.cloudProxy.of === pm.driveId ? have.cloudProxy : undefined)
    if (have && !have.missing && same) return { ...(have.driveId || !pm.driveId ? have : { ...have, driveId: pm.driveId, ...(remote ? { remote } : {}) }), ...links, ...(cloud ? { cloudProxy: cloud } : {}) }
    if (have && !same) filesRef.current.delete(pm.id) // 这次开页挑的那份是旧内容
    const orig = await host.media.readOriginal(pm, projRef.current?.id ?? null)
    const px = pm.kind === 'video' ? await readProxy(sk) : null
    const url = px ? blobUrl(px) : orig ? blobUrl(orig) : remote ?? ''
    let duration = pm.duration
    let noPicture = pm.noPicture === true
    if (url && !(duration > 0)) { const pr = await probeMedia(url, pm.kind); duration = pr.duration; noPicture = pr.noPicture }
    return { id: pm.id, name: pm.name, kind: pm.kind, duration: duration > 0 ? duration : 0, url, from: pm.from, ...(pm.driveId ? { driveId: pm.driveId } : {}), ...(remote ? { remote } : {}), stored: !!orig, proxied: !!px, ...(noPicture ? { noPicture } : {}), ...(url ? {} : { missing: true, ...(pm.driveId && denied[pm.driveId] ? { denied: true } : {}) }), ...links, ...(pm.cloudProxy ? { cloudProxy: pm.cloudProxy } : {}) }
  }, [blobUrl, storeKeyOf])
  /** 把一份工程内容换到页面上（素材、内嵌程序包、轨道、比例）：open＝开档（复原栈清空）·remote／local＝进复原栈（⛔ 过主轨磁吸·见 commitRemoteTracks） */
  const loadContent = useCallback(async (p: VeditProject, urls: Record<string, string>, denied: Record<string, string>, mode: 'open' | 'remote' | 'local'): Promise<Media[]> => {
    // 大工程素材多·一份一份等量长度太慢（量不出来的还会一直等）⇒ 一起量（各自有逾时）
    const list: Media[] = await Promise.all(p.media.map((pm) => mediaFromProject(pm, urls, denied)))
    const ids = new Set(list.map((m) => m.id))
    mediaRef.current = [...list, ...mediaRef.current.filter((m) => !ids.has(m.id))]
    setMedia(mediaRef.current)
    // 内嵌的上传程序包 ⇒ 这台没有就收进本机（「我上傳的」也看得到）
    let addedProg = false
    for (const [k, b] of Object.entries(p.programs ?? {})) {
      const pm = parseManifest(b.manifest)
      if (!pm.ok) continue
      const bundle: ProgramBundle = { id: k, manifest: pm.manifest, html: b.html, builtin: false }
      // 同 id 本机已有但版本／内容不同 ⇒ 换成工程档里这份
      if (!embeddedProgramNewer(progBundlesRef.current[k], bundle)) continue
      progBundlesRef.current = { ...progBundlesRef.current, [k]: bundle }
      addedProg = true
      void saveUploadedProgram(bundle).then(() => setUploadedProgs(listUploadedPrograms()))
    }
    if (addedProg) setProgBundles(progBundlesRef.current)
    // 命令化第二期：那批连比例一起换 ⇒ 比例记进比例帐（Ctrl+Z 退掉角色那批时比例一起回）
    if (mode !== 'open') PC.noteRemoteRatio(ratioLedgerRef.current, { tracks: tracksRef.current, ratio: ratioRef.current }, p.ratio)
    if (mode !== 'open') commitRemoteTracks(p.tracks) // 角色／别处改的、回复的历史版本：罩期也要换上（不走人手那道闸）·进复原栈
    else { histRef.current = T.EMPTY_HIST; tracksRef.current = T.pruneLanes(p.tracks); setTracks(tracksRef.current); setHistTick((n) => n + 1) }
    ratioRef.current = p.ratio
    setRatioSel(p.ratio)
    for (const m of list) if (m.url && (!m.proxied || !m.stored)) prepare(m.id)
    for (const m of list) autoUploadIfOn(m.id)
    return list
  }, [mediaFromProject, commitRemoteTracks, prepare, autoUploadIfOn])
  const syncHead = useCallback((d: { id: string; title: string; folder_id: string | null }) => {
    if (projRef.current && (projRef.current.title !== d.title || projRef.current.folderId !== d.folder_id)) setProj({ id: d.id, title: d.title, folderId: d.folder_id })
    projFolderRef.current = d.folder_id
  }, [])
  /** 套一份读回来的工程档（换上之后＝跟库里那份一样）：remote＝角色／别处改的（进复原栈）·否则＝开档（复原栈清空） */
  const applyProject = useCallback(async (d: ProjGet, remote: boolean) => {
    await loadContent(d.project, d.media_urls ?? {}, d.media_denied ?? {}, remote ? 'remote' : 'open')
    projBaseRef.current = d.updated_at
    projSavedRef.current = JSON.stringify(projectNow())
    syncHead(d)
    reportProjectGroups(d.id, d.drops)
  }, [loadContent, projectNow, syncHead, reportProjectGroups])
  // 裁「剪辑页互盖」：手上有没存的改动时收到远端更新 ⇒ ⛔ 自己整份换掉·先问「套用／保留我的／合併」（合得干净才给合併）
  const [remoteAsk, setRemoteAsk] = useState<{ d: ProjGet; canMerge: boolean } | null>(null)
  const remoteAskRef = useRef(remoteAsk)
  remoteAskRef.current = remoteAsk
  const savedProject = (): VeditProject | null => { try { return projSavedRef.current ? (JSON.parse(projSavedRef.current) as VeditProject) : null } catch { return null } }
  /** 命令化第二期：角色改的档撞上手上没存的人手改动 ⇒ 没存的那几笔人手命令在角色版上重放（PC.rebase·同编号）；
   *  成 ⇒ 换上合好的（角色的改动＋人手没存的改动都在·进复原栈一步：Ctrl+Z 退回手上那份＝退掉角色那批）·马上存；不成 ⇒ false（照旧问窗） */
  const rebaseRemote = useCallback(async (d: ProjGet, saved: VeditProject, mine: VeditProject): Promise<boolean> => {
    const rb = PC.rebase(saved, mine, d.project, cmdLogRef.current)
    if (!rb.ok) return false
    setRemoteAsk(null)
    await loadContent(rb.project, d.media_urls ?? {}, d.media_denied ?? {}, 'remote')
    projBaseRef.current = d.updated_at
    projSavedRef.current = JSON.stringify(d.project) // 底＝角色那版（手上多出来的＝重放上去的人手改动·接着存）
    syncHead(d)
    reportProjectGroups(d.id, d.drops)
    setNotice(t('vedit_remote_merged'))
    window.setTimeout(() => { void saveNowRef.current() }, 0)
    return true
  }, [loadContent, syncHead, reportProjectGroups, t]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 读库里那份·照 remoteAction 决定：adopt＝只换版次／apply＝换上／ask＝先问（rebase＝没存的人手命令在远端版上重放成了·不问）；回做了哪一种（null＝没读到·下一拍再问） */
  const reloadProject = useCallback(async (remote: boolean): Promise<'adopt' | 'apply' | 'ask' | 'rebase' | 'same' | null> => {
    const p = projRef.current
    if (!p) return null
    projBusyRef.current = true
    try {
      const r = await host.project.get(p.id)
      if (r.status === 404) { setProjState('gone'); return null }
      if (!r.d) return null
      const d = r.d
      if (remote && d.updated_at === projBaseRef.current) { reportProjectGroups(d.id, d.drops); return 'same' }
      if (!remote) { await applyProject(d, false); return 'apply' }
      const saved = savedProject()
      const mine = projectNow()
      const act = remoteAction(saved, mine, d.project)
      if (act === 'adopt') {
        // 远端内容跟手上一样／远端内容其实没变（例如只改了档名）⇒ 只换版次（手上没存的改动接着用新版次自动存）
        const sameAsMine = remoteAction(null, mine, d.project) === 'adopt'   // 底不给 ⇒ 只有「手上＝远端」才回 adopt
        projBaseRef.current = d.updated_at
        if (sameAsMine) projSavedRef.current = JSON.stringify(mine)
        syncHead(d)
        reportProjectGroups(d.id, d.drops)
        setRemoteAsk(null)
        return 'adopt'
      }
      if (act === 'ask' && saved && await rebaseRemote(d, saved, mine)) return 'rebase'   // 命令化第二期：重放成了 ⇒ 不问
      if (act === 'ask') {
        const m = saved ? mergeProjects(saved, mine, d.project) : null
        setRemoteAsk({ d, canMerge: !!m && m.ok })
        return 'ask'
      }
      setRemoteAsk(null)
      await applyProject(d, true)
      setNotice(t('vedit_proj_remote'))
      return 'apply'
    } catch { return null /* 下一拍再问 */ } finally { projBusyRef.current = false }
  }, [applyProject, projectNow, syncHead, reportProjectGroups, rebaseRemote, t]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 问窗三选一：apply＝套用远端（手上的改动进复原栈·按复原退得回）／mine＝保留我的（用远端的版次把手上这份存回去）／merge＝两边合起来再存 */
  const resolveRemote = useCallback(async (how: 'apply' | 'mine' | 'merge'): Promise<void> => {
    const ask = remoteAskRef.current
    if (!ask) return
    const d = ask.d
    if (how === 'merge') {
      const saved = savedProject()
      const m = saved ? mergeProjects(saved, projectNow(), d.project) : null
      if (!m || !m.ok) { setRemoteAsk({ d, canMerge: false }); setNotice(t('vedit_remote_merge_fail')); return }
      setRemoteAsk(null)
      projBusyRef.current = true
      try {
        await loadContent(m.project, d.media_urls ?? {}, d.media_denied ?? {}, 'remote')
        projBaseRef.current = d.updated_at
        projSavedRef.current = '' // 合好的还没存 ⇒ 马上存
        syncHead(d)
        reportProjectGroups(d.id, d.drops)
      } finally { projBusyRef.current = false }
      setNotice(t('vedit_remote_merged'))
      void saveNowRef.current()
      return
    }
    setRemoteAsk(null)
    if (how === 'apply') {
      projBusyRef.current = true
      try { await applyProject(d, true) } finally { projBusyRef.current = false }
      setNotice(t('vedit_proj_remote'))
      return
    }
    projBaseRef.current = d.updated_at
    projSavedRef.current = '' // 保留我的 ⇒ 用远端的版次马上存回去
    syncHead(d)
    setNotice(t('vedit_remote_kept'))
    void saveNowRef.current()
  }, [applyProject, loadContent, projectNow, syncHead, reportProjectGroups, t])
  // 顶栏「歷史版本」⇒ 列近几版（迁移 395）·选一版回复＝把那版内容换上来（进复原栈）·再照常存成最新一版
  const [historyOpen, setHistoryOpen] = useState(false)
  const restoreVersion = useCallback(async (vid: string): Promise<boolean> => {
    const p = projRef.current
    if (!p) return false
    if (aiLockedRef.current) { aiNoteRef.current(); return false }
    try {
      const r = await host.project.get(p.id, vid)
      if (!r.d) return false
      const d = r.d
      for (let i = 0; projBusyRef.current && i < 100; i++) await new Promise((res) => window.setTimeout(res, 100))
      projBusyRef.current = true
      try { await loadContent(d.project, d.media_urls ?? {}, d.media_denied ?? {}, 'local') } finally { projBusyRef.current = false }
      reportProjectGroups(d.id, d.drops)
      setNotice(t('vedit_history_restored'))
      void saveNowRef.current()
      return true
    } catch { return false }
  }, [loadContent, reportProjectGroups, t]) // eslint-disable-line react-hooks/exhaustive-deps
  /** force＝明确存档（外框汇出／换存放位置前的 flush·游客版照写不比对） */
  const saveNow = useCallback(async (force = false): Promise<void> => {
    const p = projRef.current
    if (!p || projBusyRef.current || remoteAskRef.current) return   // 正在问「远端改了怎么办」⇒ 先别存（存了也是 409）
    const body = projectNow()
    const text = JSON.stringify(body)
    if (text === projSavedRef.current) return
    projBusyRef.current = true
    setSaveState('saving')
    let again = false
    try {
      const card = await cardNow() // 「專案」弹窗那格的封面＋时长·跟着存档一起送
      const r = await host.project.save(p.id, { base_updated_at: projBaseRef.current, project: body, card, title: p.title }, force)
      const j = r.j
      // 云盘空间不够／工程档太大 ⇒ 说原因·不每 5 秒重试（再改一下会再存）
      if (r.status === 413) { setNotice(t(j.code === 'vedit_project_quota' ? 'vedit_proj_quota' : 'vedit_proj_too_large')); setSaveState('error'); return }
      if (r.status === 409) {
        // 版次对不上 ⇒ 读库里那份·手上有没存的 ⇒ 先问（⛔ 原本直接整份换掉）；远端内容其实没变 ⇒ 换好版次马上再存
        projBusyRef.current = false
        const act = await reloadProject(true)
        if (act === 'apply') setNotice(t('vedit_proj_conflict'))
        if (act === 'adopt') window.setTimeout(() => { void saveNowRef.current() }, 0)
        setSaveState(act === 'ask' ? 'idle' : 'saved')
        return
      }
      if (r.status === 404) { setProjState('gone'); setSaveState('error'); return }
      // 外面（用户自己的 AI）改过这份工程 ⇒ 不写、不重试·交给外框问使用者要不要重新载入
      if (r.status === 412) { setSaveState('held'); return }
      if (r.status < 200 || r.status >= 300 || !j.updated_at) throw new Error(`HTTP ${r.status}`)
      projBaseRef.current = j.updated_at
      projSavedRef.current = text
      host.project.dirty(false)
      setSaveState('saved')
      reportProjectGroups(p.id, j.drops)
      again = JSON.stringify(projectNow()) !== text // 存的时候又改了 ⇒ 接着再存一次
    } catch {
      setSaveState('error')
      window.setTimeout(() => { void saveNowRef.current() }, 5000) // 没存成 ⇒ 5 秒后再试
    } finally { projBusyRef.current = false }
    if (again) window.setTimeout(() => { void saveNowRef.current() }, VEDIT_SAVE_DEBOUNCE_MS)
  }, [projectNow, reloadProject, cardNow, reportProjectGroups, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveNowRef = useRef(saveNow)
  saveNowRef.current = saveNow
  /** 外框要汇出／换存放位置／关掉前叫它：回来时工程档里存的就是手上这份。
   *  正在存（或正在读）⇒ 先等那一发做完（saveNow 碰到 busy 会直接回、不能拿它当已存好）；等完手上还有更新的改动 ⇒ 再存一次；
   *  几轮下来仍没存成（出错、正在问远端改了怎么办、一直忙）⇒ 丢错，外框就不拿磁碟上的旧档去汇出、搬家或离开。 */
  const flushProject = useCallback(async (): Promise<void> => {
    const pause = () => new Promise((res) => window.setTimeout(res, 50))
    for (let round = 0; round < 5; round++) {
      for (let i = 0; projBusyRef.current && i < 600; i++) await pause() // 最多等 30 秒
      if (!projRef.current) return
      if (JSON.stringify(projectNow()) === projSavedRef.current) return
      if (projBusyRef.current || remoteAskRef.current) break
      await saveNowRef.current(true)
    }
    throw new Error(t('vedit_guest_flush_fail'))
  }, [projectNow, t])
  const flushProjectRef = useRef(flushProject)
  flushProjectRef.current = flushProject
  useEffect(() => { host.project.registerFlush(() => flushProjectRef.current()); return () => host.project.registerFlush(null) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Desktop app: save before the tab closes (shared/desktop-before-close)
  useEffect(() => registerDesktopBeforeClose(() => flushProjectRef.current()), [])
  // 单机版本机 MCP（tools/agent-mcp.mjs·shared/agent-link.ts）：AI 下的剪辑命令在这页现况上跑（lib/agent-job.pure·同 video_edit_run 那支命令表）；
  //   成了当「角色那批」入账（commitRemoteTracks：一步复原·⛔ 过主轨磁吸）·比例一起换就记比例帐·接着照常停手自动存回工程夹
  const agentJobRef = useRef<(job: AgentJob) => Promise<AgentReply>>(async () => ({ ok: false, error: 'not_ready' }))
  agentJobRef.current = async (job) => {
    if (!projRef.current || projState !== 'ready') return { ok: false, error: 'not_ready', message: 'the video editor has no project open yet' }
    if (aiLockedRef.current) return { ok: false, error: 'busy', message: 'the editor is busy with another change; try again in a moment' }
    const out = videoAgentJob(job, cmdState(), uid)
    if (out.next) {
      if (out.next.ratio) { PC.noteRemoteRatio(ratioLedgerRef.current, { tracks: tracksRef.current, ratio: ratioRef.current }, out.next.ratio); ratioRef.current = out.next.ratio; setRatioSel(out.next.ratio) }
      commitRemoteTracks(out.next.tracks)
    }
    return out.reply
  }
  useEffect(() => (isStandalone() ? startAgentLink({ editor: 'video', project: () => (projRef.current ? { id: projRef.current.id, title: projRef.current.title } : null), handle: (j) => agentJobRef.current(j) }) : undefined), [])
  // 开档
  useEffect(() => {
    if (gate !== 'ok' || projRef.current) return
    const id = host.project.urlId()
    if (!id) return
    // 编号格式不对 ⇒ 不去读·整页明说；开不到 ⇒ 按是哪一种整页明说（失败种类先记·再置 gone）
    if (!host.project.validId(id)) { setUrlFail('bad_id'); setProjState('gone'); return }
    setProjState('loading')
    projBusyRef.current = true
    void (async () => {
      try {
        const r = await host.project.open(id)
        if (!r.ok) { setUrlFail(r.fail); setProjState('gone'); return }
        const d = r.d
        projRef.current = { id: d.id, title: d.title, folderId: d.folder_id }
        setProj(projRef.current)
        await applyProject(d, false)
        if (d.note) setNotice(d.note) // 读档时丢掉／改掉的条目、找不到的素材（游客版：外面改坏 project.json 时）
        setProjState('ready')
      } catch { setUrlFail('failed'); setProjState('gone') } finally { projBusyRef.current = false }
    })()
  }, [gate]) // eslint-disable-line react-hooks/exhaustive-deps
  // 改了停手 1.2 秒自动存（内容真的变了才送·上传进度这类暂时栏位不算）
  const projKey = useMemo(() => (projState === 'ready' ? JSON.stringify(buildProject({ ratio: ratioSel, tracks, media, programs: {} })) + Object.keys(progBundles).join(',') : ''), [projState, ratioSel, tracks, media, progBundles])
  useEffect(() => {
    if (!projKey) return
    if (JSON.stringify(projectNow()) !== projSavedRef.current) host.project.dirty(true)
    const h = window.setTimeout(() => { void saveNowRef.current() }, VEDIT_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(h)
  }, [projKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // 每 2 秒问一次版本（分页在后台不问）⇒ 角色／别的分页改了就换上
  useEffect(() => {
    const head = host.project.head
    if (projState !== 'ready' || !head) return
    const iv = window.setInterval(() => {
      const p = projRef.current
      if (!p || projBusyRef.current || document.hidden) return
      const gen = projGenRef.current
      void head(p.id).then(async (r) => {
        if (r.status === 404) { setProjState('gone'); return }
        if (!r.h) return
        const h = r.h
        if (h.deleted) { setProjState('gone'); return }
        if (h.title && h.title !== projRef.current?.title && gen === projGenRef.current && !projBusyRef.current) setProj((x) => (x ? { ...x, title: h.title! } : x))
        // 正在问「远端改了怎么办」⇒ 远端又变了才重读（问窗换成最新那份）·没变不每 2 秒整份重读
        if (remoteAskRef.current && h.updated_at === remoteAskRef.current.d.updated_at) return
        if (h.updated_at && h.updated_at !== projBaseRef.current && !projBusyRef.current) await reloadProject(true)
      }).catch(() => { /* 下一拍再问 */ })
    }, VEDIT_LIVE_POLL_MS)
    return () => window.clearInterval(iv)
  }, [projState, reloadProject]) // eslint-disable-line react-hooks/exhaustive-deps
  // 游客版：外框报外面改了工程档（手上没未存改动）⇒ 读回换上（进复原栈·按复原退得回）·⛔ 整页重挂（播放头、捲动、面板、复原栈会全部归零）
  //   工程档里拿掉的素材也从素材区拿掉（跟重新开档一样）；读不进来（外面写坏了）⇒ 手上这份不动、说一句（改好再写一次会再读）
  const outsideRef = useRef<() => Promise<void>>(async () => {})
  outsideRef.current = async () => {
    const p = projRef.current
    if (!p || projState !== 'ready') return
    for (let i = 0; projBusyRef.current && i < 100; i++) await new Promise((res) => window.setTimeout(res, 100))
    projBusyRef.current = true
    try {
      const r = await host.project.get(p.id)
      if (!r.d) { setNotice(t('vedit_guest_outside_bad')); return }
      const keep = new Set(r.d.project.media.map((m) => m.id))
      mediaRef.current = mediaRef.current.filter((m) => keep.has(m.id))
      setRemoteAsk(null)
      await applyProject(r.d, true)
      setNotice(t('vedit_guest_outside_applied'))
    } catch { setNotice(t('vedit_guest_outside_bad')) } finally { projBusyRef.current = false }
  }
  useEffect(() => host.project.onOutsideChange?.(() => { void outsideRef.current() }), []) // eslint-disable-line react-hooks/exhaustive-deps
  // ── ──
  //   抄四编辑页那套（components/EditorAIShield＋服务端编辑锁 kind=vedit·档行 user_files·迁移 381）：右栏对角色发话＝记待命轮·角色真写第一笔 ⇒ 罩落；
  //   edit／复原重做／拖片段拉两端／轨道排序／刀片／音量线／改键（AI_LOCK_KEY_ACTS）／比例／改名；预览区不盖罩·画面上的字块贴纸一样拖不动。
  //   罩落那刻手上还没存的改动先存一次（带版次·角色已写过 ⇒ 409 照旧重读）。
  const tracksBoxRef = useRef<HTMLDivElement>(null)
  // 罩落那刻先把已开始的编辑手势作废（退回按下那刻）·再补存
  const aiShield = host.useAiShield({ id: proj?.id, enabled: projState === 'ready', onRelease: async () => { await reloadProject(true) }, containerRef: tracksBoxRef, onLock: () => { gestureRef.current?.abort(); void saveNowRef.current() } })
  const aiLocked = aiShield.locked
  aiLockedRef.current = aiLocked
  aiNoteRef.current = () => setNotice(t('ai_shield_blocked'))
  // ── （的读法：照剪映——一开始动手剪〔加素材、加片段、改轨道等〕就自动在设定里的草稿资料夹
  //   〔没设＝云盘根目录〕开一份草稿工程档·网址换成 ?id=·之后照现有的停手自动存；草稿名「剪輯草稿＋日期时间」）。
  //   原顶栏「存成剪輯檔」钮拿掉（一动手就自动存了·再留一颗「存成」反而让人以为还没存）⇒ 那里改成状态字：动手剪就自动存成草稿／存成草稿中…／没建成（白话＋现在再试）。
  //   规则（算不算动手、该不该建、失败怎么说、多久再试、草稿名）在 _lib/vedit-draft.pure.ts。──
  const draftRef = useRef<DraftState>(DRAFT_IDLE)
  const draftPendingRef = useRef<Promise<void> | null>(null)
  // 还没建草稿就先改了名 ⇒ 先记在这（顶栏显示它）·建草稿时用它当名字
  const [pendingName, setPendingName] = useState<string | null>(null)
  const pendingNameRef = useRef<string | null>(null)
  const [draftView, setDraftView] = useState<{ phase: DraftPhase; fail?: DraftFail }>({ phase: 'idle' })
  const draftSnapNow = useCallback((): DraftSnap => ({ tracks: tracksRef.current, mediaIds: mediaRef.current.map((m) => m.id), ratio: ratioRef.current }), [])
  /** 该建就建（同一页只建一次：正在建 ⇒ 回同一个等待；建好／已开档 ⇒ 不再建）·没建成 ⇒ 改动留在页上、顶栏说原因、过一会自己再试 */
  const ensureDraft = useCallback((force = false): Promise<void> => {
    if (draftPendingRef.current) return draftPendingRef.current
    if (projRef.current) return Promise.resolve() // 已开档（省得每次改动都比一遍）·规则本身在 draftNext
    const st = force && draftRef.current.phase === 'failed' ? { ...draftRef.current, retryAt: 0 } : draftRef.current
    const create = host.project.create
    if (!create) return Promise.resolve()
    const act = draftNext({ hasProject: !!projRef.current, urlId: !!host.project.urlId(), touched: draftTouched(draftBaseRef.current, draftSnapNow()), state: st, now: Date.now() })
    if (act !== 'create') return Promise.resolve()
    draftRef.current = { ...draftRef.current, phase: 'creating' }
    setDraftView({ phase: 'creating' })
    const run = async () => {
      let status: number | null = null
      let code: string | undefined
      try {
        const usedName = pendingNameRef.current
        const r = await create({ folder_id: settingsRef.current.draftFolderId, name: draftCreateName(usedName, language, new Date()) })
        status = r.status
        const j = r.j
        code = j.code
        if (r.status !== null && r.status >= 200 && r.status < 300 && j.id && j.updated_at) {
          host.project.setUrlId(j.id)
          projRef.current = { id: j.id, title: j.title ?? '', folderId: j.folder_id ?? null }
          host.chat?.adopt(j.id)   // 建好前已选的角色记到这份上
          setProj(projRef.current)
          if (pendingNameRef.current === usedName) { pendingNameRef.current = null; setPendingName(null) } // 先改的名已经用上
          projFolderRef.current = j.folder_id ?? null
          projBaseRef.current = j.updated_at
          projSavedRef.current = '' // ⇒ 停手自动存那段马上把现在这些轨道素材存进去（建的过程中又改的也一起）
          setProjState('ready')
          host.drive?.invalidate()
          draftRef.current = { phase: 'done', tries: 0, retryAt: 0 }
          setDraftView({ phase: 'done' })
          return
        }
      } catch { status = null }
      const tries = draftRef.current.tries + 1
      const wait = draftRetryMs(tries)
      draftRef.current = { phase: 'failed', tries, retryAt: Date.now() + wait }
      setDraftView({ phase: 'failed', fail: draftFailKind(status, code) })
      window.setTimeout(() => { void ensureDraftRef.current() }, wait)
    }
    const p = run().finally(() => { draftPendingRef.current = null })
    draftPendingRef.current = p
    return p
  }, [draftSnapNow, language]) // eslint-disable-line react-hooks/exhaustive-deps
  ensureDraftRef.current = ensureDraft
  // 每次改动后问一次「该不该建」（没动手／已开档／正在建 ⇒ 什么都不做）
  useEffect(() => { if (restored) void ensureDraftRef.current() }, [tracks, media, ratioSel, restored])
  // 关页前还有没存的 ⇒ 浏览器问一声
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => {
      const unsaved = projRef.current ? JSON.stringify(projectNow()) !== projSavedRef.current : !host.project.urlId() && draftTouched(draftBaseRef.current, draftSnapNow())
      if (unsaved) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', on)
    return () => window.removeEventListener('beforeunload', on)
  }, [projectNow, draftSnapNow]) // eslint-disable-line react-hooks/exhaustive-deps
  const [projectsOpen, setProjectsOpen] = useState(false)
  const openProject = useCallback((id: string) => { host.project.openOther(id) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ── （顶栏中间的剪辑名）：双击 ⇒ 同样大小的输入框（全选原名）；Enter／失焦 ⇒ 存；Esc ⇒ 取消；
  //   空白／只有空格 ⇒ 恢复原名不存；上限＝建档同一把尺（VEDIT_NAME_MAX）。名字存在云盘工程档的档名「<名>.dvedit」（工程档内容、卡片都没有名字栏）⇒
  // 改名走云盘页改名同一条口 PATCH /api/files/<id>（同层撞名自动加序号·「專案」清单读档名·跟着变）；专案资料夹名不动。
  //   还没建草稿 ⇒ 先记住·建草稿时用它。输入框是 <input> ⇒ 剪辑页全局快捷键那只 typing() 本来就让开；这里另把按键挡在框里（stopPropagation）。──
  const [renaming, setRenaming] = useState<string | null>(null)   // 输入框里的字（null＝没在改）
  const renameEndRef = useRef(true)                               // 这一轮收尾过了（Esc／Enter 之后失焦不再存一次）
  const titleRef = useRef<HTMLSpanElement>(null)
  const [titleBox, setTitleBox] = useState<{ w: number; h: number } | null>(null)
  const shownTitle = proj ? proj.title || t('vedit_untitled') : pendingName ?? t('vedit_untitled')
  const canRename = proj ? projState !== 'gone' : projState === 'none'
  const renameTo = useCallback(async (name: string): Promise<void> => {
    if (!projRef.current && draftPendingRef.current) await draftPendingRef.current.catch(() => {}) // 正在建草稿 ⇒ 等建好再改那份
    const p = projRef.current
    if (!p) { pendingNameRef.current = name; setPendingName(name); return } // 还没建草稿 ⇒ 先记住·建草稿时用
    projGenRef.current++
    const old = p.title
    projRef.current = { ...p, title: name } // 顶栏马上显示新名
    setProj(projRef.current)
    for (let i = 0; projBusyRef.current && i < 100; i++) await new Promise((res) => window.setTimeout(res, 100)) // 正在存／读 ⇒ 等它做完（最多 10 秒）
    projBusyRef.current = true
    try {
      // 改档名会换掉库里那份的版本号 ⇒ ⛔ 直接把改名回的新版本号当成手上这版的（原「先问版本、对得上才换」——问完到改名之间
      //   角色正好写进去 ⇒ 页面拿到的新版本号其实带着角色那份内容·手上还是旧轨道·下一次存档就把角色那份整份盖回旧的）；
      //   版本号不动 ⇒ 问版本那拍读回来：内容跟手上一样／没变 ⇒ 只换版次（不打扰）；角色真的改了 ⇒ 照远端更新那套（没存的先问）
      const r = await host.project.rename(p.id, `${name}${VEDIT_PROJECT_EXT}`)
      const j = r.j
      if (!r.ok || typeof j.name !== 'string') throw new Error(`HTTP ${r.status}`)
      projGenRef.current++
      if (projRef.current?.id === p.id) { projRef.current = { ...projRef.current, title: projectTitle(j.name) }; setProj(projRef.current) } // 同层撞名 ⇒ 服务端加了序号·照它显示
    } catch {
      projGenRef.current++
      if (projRef.current?.id === p.id && projRef.current.title === name) { projRef.current = { ...projRef.current, title: old }; setProj(projRef.current) }
      setNotice(t('vedit_rename_fail'))
    } finally { projBusyRef.current = false }
    void saveNowRef.current() // 改名那几秒里的剪辑改动（自动存让开了）接着存
  }, [t]) // eslint-disable-line react-hooks/exhaustive-deps
  const startRename = () => {
    if (!canRename || renaming !== null || aiLockedRef.current) return
    const el = titleRef.current
    setTitleBox(el ? { w: el.offsetWidth, h: el.offsetHeight } : null)
    renameEndRef.current = false
    setRenaming(shownTitle)
  }
  /** raw＝null ⇒ 取消（Esc） */
  const finishRename = (raw: string | null) => {
    if (renameEndRef.current) return
    renameEndRef.current = true
    setRenaming(null)
    if (raw === null) return
    const v = renameVerdict(raw, shownTitle)
    if (v.save) void renameTo(v.name)
  }

  // 点对话里的小卡（片段卡 ⇒ 弹窗里「在轨道上选起来」；标记卡 ⇒ 播放头跳到标记）：卡怎么画、怎么弹窗在宿主那一格，这里只给要做的事
  const jumpToClips = useCallback((ids: readonly string[], firstAt: number | null) => {
    // 还在的那几段·照时间先后（同一刻照轨道由上到下）排
    const tr = tracksRef.current
    const live = [...new Set(ids)].map((id) => ({ id, f: T.findClip(tr, id) })).filter((x) => !!x.f)
      .sort((a, b) => a.f!.clip.start - b.f!.clip.start || tr.indexOf(a.f!.lane) - tr.indexOf(b.f!.lane))
    setSel(live.map((x) => x.id))
    setSourceMode(false); setPlaying(false)
    const at = live.length ? live[0].f!.clip.start : firstAt
    if (at !== null && Number.isFinite(at)) setNow(T.snapFrame(Math.max(0, at)))
    if (!live.length) setNotice(t('vedit_ref_gone'))
  }, [setNow, t])
  const cardApi = useMemo(() => ({
    tracks: () => tracksRef.current,
    media: () => mediaRef.current,
    jumpToClips,
    jumpToMarker: (at: number) => {
      seekTimelineRef.current(at)
      const hit = markersOf(tracksRef.current).find((m) => Math.abs(m - at) < 0.002)
      if (hit !== undefined) { setSelMarker(hit); setSel([]); setSelTrans(null); return true }
      return false
    },
    notice: (text: string) => setNotice(text),
  }), [jumpToClips])
  // ── 播放时每帧都要重画播放头：跟播放头无关的大块先包好·同一份元素 React 直接跳过不重画 ──
  const chatPane = host.renderChatSlot({ dense: true, title: t('vedit_chat_title'), vedit: {
    tracks, media, ratio: ratioSel, fitAspect: fitAspectNow, playhead: playing ? nowRef.current : now, playing, sel, proj: proj ? { id: proj.id, title: proj.title } : null, api: cardApi,
  } })
  const onDriveMedia = useCallback((f: DriveRef) => { void addDriveMedia(f).then((m) => { if (m) setSelected(m.id) }) }, [addDriveMedia])
  // 播放时每帧重画：「雲端硬碟」那格包好·不跟着播放头重画
  const curDriveId = current?.driveId ?? null
  const driveTree = useMemo(() => host.renderDriveSlot({ variant: 'dark', vedit: { currentDriveId: curDriveId, onMedia: onDriveMedia } }), [host, curDriveId, onDriveMedia])
  // 时间尺刻度跟着缩放换档（缩到整段放得进一屏时一格可能是一分钟）
  const rulerTicks = useMemo(() => {
    const { major, minor } = T.rulerStep(pxPerSec)
    return Array.from({ length: Math.floor(totalSec / minor) + 1 }, (_, i) => {
      const s = i * minor
      const big = s % major === 0
      return (
        <div key={s} className="absolute top-0 h-full pointer-events-none" style={{ left: s * pxPerSec }}>
          <div className={`w-px ${big ? 'h-3 bg-neutral-500' : 'h-1.5 bg-neutral-700'}`} />
          {big && <span className="absolute top-2.5 left-1 text-[9px] text-neutral-500 tabular-nums">{fmtTime(s).slice(s >= 3600 ? 0 : 3, 8)}</span>}
        </div>
      )
    })
  }, [totalSec, pxPerSec])

  // 导出弹窗「匯出並存雲盤」／「用哪台电脑导出」要的——存哪个夹（同素材上传）、云盘档链接、别台导出前先把改动存进工程档
  const projectNowRef = useRef(projectNow)
  projectNowRef.current = projectNow
  const exportDrive = useMemo(() => host.exportDrive({
    folder: async () => {
      if (!settingsRef.current.uploadFolderId) await ensureDraftRef.current()
      return settingsRef.current.uploadFolderId ?? projFolderRef.current
    },
    saveProject: async () => {
      await ensureDraftRef.current()
      // 存档中／正在问远端改动 ⇒ 等一下再存；最多等约 15 秒
      for (let i = 0; i < 30; i++) {
        const p = projRef.current
        if (!p) return null
        if (!projBusyRef.current && !remoteAskRef.current) {
          await saveNowRef.current()
          if (projSavedRef.current && projSavedRef.current === JSON.stringify(projectNowRef.current())) return p.id
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      return null
    },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  // 「合成子素材」「多选合并（有画面）」可选交给家里那台合：
  //   右键选单多列「交给某台」（只在有画面、有在线别台时·本机那两项照旧＝缺省）⇒ 走别台导出同一条路＋范围（range／only）⇒
  //   成品存进素材上传那个夹（同本机合的上传去处）⇒ 接回素材区（合并另替换时间轴那几段·合的期间被改过就只进素材区）。
  const [offloadDevs, setOffloadDevs] = useState<Array<{ deviceId: string; label: string }>>([])
  const loadOffloadDevs = useCallback(() => {
    if (!host.offload) return
    void host.offload.devices().then(setOffloadDevs, () => setOffloadDevs([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const menuOpen = !!menu?.ids.length
  useEffect(() => { if (menuOpen) loadOffloadDevs() }, [menuOpen, loadOffloadDevs]) // 选单一开就问一次谁在线（没有 ⇒ 不列·只走本机）
  const offloadAbort = useRef<AbortController | null>(null)
  useEffect(() => () => offloadAbort.current?.abort(), [])
  const offloadRender = useCallback(async (act: OffloadAct, ids: readonly string[], dev: { deviceId: string; label: string }) => {
    setMenu(null)
    const tr0 = tracksRef.current
    const part = offloadPart(tr0, ids, kindOfMedia)
    const off = host.offload, drive = host.drive
    if (!part || !offloadable(act, tr0, ids, kindOfMedia) || !off || !drive || !exportDrive) return
    if (subBusy) { setNotice(t(act === 'merge' ? 'vedit_merge_busy' : 'vedit_subclip_busy')); return }
    const snap = clipsSnapshot(tr0, ids)
    const say = (k: TKey, extra: Record<string, string> = {}) => Object.entries({ device: dev.label, ...extra }).reduce((s, [a, b]) => s.replace(`{${a}}`, b), t(k) as string)
    const ac = new AbortController()
    offloadAbort.current = ac
    setSubBusy(true); setNotice(say('vedit_offload_busy', { p: '0' }))
    try {
      const r = await off.render({ drive: exportDrive, device: dev.deviceId, part, signal: ac.signal, onProgress: (p) => setNotice(say('vedit_offload_busy', { p: String(Math.round(p)) })) })
      const f = await drive.fileById(r.fileId)
      const m = f ? await addDriveMedia(f) : null
      if (!m) { setNotice(say('vedit_offload_fail', { msg: t('vedit_offload_no_file') })); return }
      setSelected(m.id)
      if (act === 'subclip') { setNotice(say('vedit_offload_done_sub')); return }
      // 合并：选中那几段在合的期间被改过（挪了／剪了／删了）⇒ ⛔ 替换（会盖掉改动）·成品只进素材区
      if (clipsSnapshot(tracksRef.current, ids) !== snap) { setNotice(say('vedit_offload_merge_changed')); return }
      const length = Math.min(T.snapFrame(part.to - part.from), m.duration > 0 ? m.duration : Infinity)
      const out = replaceWithMerged(tracksRef.current, ids, { id: crypto.randomUUID(), mediaId: m.id, start: T.snapFrame(part.from), length, offset: 0 }, crypto.randomUUID(), 'visual')
      edit(out.tracks)
      setSel([out.id])
      setNotice(say('vedit_offload_done_merge'))
    } catch (e) {
      const c = off.errorCode(e)
      if (c === 'cancelled' && ac.signal.aborted) return
      const msg = c === 'unsaved' ? t('vedit_offload_unsaved') : c === 'server_old' ? t('vedit_export_remote_part_server_old') : c === 'ignored' ? t('vedit_export_remote_part_ignored') : String((e as Error).message || e).slice(0, 200)
      setNotice(say('vedit_offload_fail', { msg }))
    } finally {
      if (offloadAbort.current === ac) offloadAbort.current = null
      setSubBusy(false)
    }
  }, [kindOfMedia, subBusy, t, exportDrive, addDriveMedia, edit]) // eslint-disable-line react-hooks/exhaustive-deps

  if (gate === 'checking') return <div className="h-screen bg-neutral-900" data-testid="vedit-gate-checking" />
  if (gate === 'no') return <>{host.renderGateClosed()}</>
  // 网址那份开不到 ⇒ 整页明说是哪种（写明没有新建）·⛔ 画编辑器（不再挂在一个「未命名剪輯」上）
  if (urlFail) return <>{host.renderLoadFail(urlFail, host.project.urlId())}</>

  // ── 轨道一行行：由上到下＝tracks 顺序；拖着要新增一条时灰底那一行插在它将来的位置 ──
  type Row = { lane: T.Lane } | { ghostLane: T.DropPlan }
  const laneRows: Row[] = tracks.map((lane) => ({ lane }))
  if (ghost && ghost.lane === null) laneRows.splice(Math.min(ghost.at, laneRows.length), 0, { ghostLane: ghost })
  // 上区（画面区·各种非音频轨＋主轨·顺序自由）｜音频区——两区分开画、中间一条分界线
  const zoneCut = (() => { const i = laneRows.findIndex((r) => ('lane' in r ? r.lane.kind : r.ghostLane.kind) === 'audio'); return i < 0 ? laneRows.length : i })()
  const noClips = end === 0
  const landSet = new Set(landIds ? landIds.split(',') : []) // 拖位时落点那几段淡掉画（本身另有一份跟着滑鼠走）
  const ghostBox = (g: T.DropPlan) => (
    <div className="absolute top-2 bottom-2 z-20 rounded bg-neutral-400/30 border border-neutral-300/50 pointer-events-none"
      style={{ left: g.start * pxPerSec, width: Math.max(4, g.length * pxPerSec) }} data-testid="vedit-drop-ghost" />
  )
  const renderRow = (row: Row) => {
    if ('ghostLane' in row) {
      return (
        <div key="__ghost" className="flex shrink-0 h-12 border-b border-neutral-800/70" data-lane-ghost="1" data-testid="vedit-lane-ghost">
          <div className="shrink-0 sticky left-0 z-10 bg-neutral-900 flex items-center pl-2 text-neutral-600" style={{ width: LABEL_W }}><LaneIcon name={row.ghostLane.kind} /></div>
          <div className="relative isolate flex-1">{ghostBox(row.ghostLane)}</div>
        </div>
      )
    }
    const ln = row.lane
    const isMain = ln.id === T.MAIN_LANE
    const ctl = T.laneControls(ln, (id) => mediaOf(id)?.kind)
    return (
      <div key={ln.id} className={`flex shrink-0 ${isMain ? 'h-16 border-y border-neutral-700' : 'h-12 border-b border-neutral-800/70'} ${laneLand === ln.id ? 'opacity-40' : ''}`} data-testid="vedit-lane"
        data-lane-id={ln.id} data-lane-kind={ln.kind} data-main={isMain ? '1' : '0'} data-locked={ln.locked ? '1' : '0'} data-hidden={ln.hidden ? '1' : '0'} data-muted={ln.muted ? '1' : '0'}>
        {/* 轨道头：种类小标＋锁＋眼睛（音频轨不放）＋喇叭（没声音的轨不放） */}
        {/* 按住轨道头上下拖＝换轨道顺序（锁了的不拖） */}
        <div data-lane-head="1" data-testid="vedit-lane-head" onPointerDown={onLaneHeadDown(ln)} title={ln.locked || isMain ? undefined : t('vedit_lane_reorder')}
          className={`shrink-0 sticky left-0 z-10 flex items-center gap-1 pl-2 pr-1 border-r border-neutral-800 touch-none ${ln.locked || isMain ? '' : 'cursor-grab active:cursor-grabbing'} ${isMain ? 'bg-neutral-800' : 'bg-neutral-900'}`} style={{ width: LABEL_W }}>
          <span className="text-neutral-400" title={t(LANE_NAME[ln.kind])} data-testid="vedit-lane-kind" data-kind={ln.kind}><LaneIcon name={ln.kind} /></span>
          <span className="ml-auto flex items-center gap-0.5">
            <LaneBtn on={ln.locked} label={t(ln.locked ? 'vedit_lane_unlock' : 'vedit_lane_lock')} testid="vedit-lane-lock" onClick={() => toggleLane(ln.id, 'locked')}><LaneIcon name={ln.locked ? 'lock' : 'unlock'} /></LaneBtn>
            {ctl.eye && <LaneBtn on={ln.hidden} label={t(ln.hidden ? 'vedit_lane_show' : 'vedit_lane_hide')} testid="vedit-lane-eye" onClick={() => toggleLane(ln.id, 'hidden')}><LaneIcon name={ln.hidden ? 'eye-off' : 'eye'} /></LaneBtn>}
            {ctl.speaker && <LaneBtn on={ln.muted} label={t(ln.muted ? 'vedit_lane_unmute' : 'vedit_lane_mute')} testid="vedit-lane-mute" onClick={() => toggleLane(ln.id, 'muted')}><LaneIcon name={ln.muted ? 'vol-off' : 'vol'} /></LaneBtn>}
          </span>
        </div>
        {/* isolate＝片段（选中 z-10）、转场标记都只在这一格里叠·横向捲动时一律压在左边轨道头底下 */}
        <div className={`relative isolate flex-1 ${ln.locked ? 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.03)_6px_12px)]' : ''}`} data-testid={`vedit-track-${ln.kind}`}>
          {isMain && noClips && !ghost && (
            <div className="absolute inset-y-2 left-2 rounded-md border border-dashed border-neutral-700 flex items-center px-4 text-xs text-neutral-500 pointer-events-none" style={{ width: 'min(640px, calc(100% - 16px))' }}>{t('vedit_track_drop')}</div>
          )}
          {ghost && ghost.lane === ln.id && ghostBox(ghost)}
          {ln.clips.map((c) => {
            const m = mediaOf(c.mediaId)
            const on = sel.includes(c.id)
            // 音频轨上的片段（含影片分离出来的声音）一律绿色
            const stk = c.sticker ? stickerById(c.sticker.sticker) : null
            const flc = c.filter ? filterById(c.filter.filter) : null
            const prb = c.program ? programBundleOf(c.program.pkg) : null
            const tone = c.text ? 'bg-amber-700/85' : c.sticker ? 'bg-pink-700/85' : c.filter ? 'bg-indigo-700/85' : c.adjust ? 'bg-sky-700/85' : c.program ? 'bg-teal-700/85' : c.shape ? 'bg-rose-700/85' : c.solid ? 'bg-neutral-600/85' : c.bgfx ? 'bg-violet-800/85' : ln.kind === 'audio' || m?.kind === 'audio' ? 'bg-emerald-800/85' : m?.kind === 'image' ? 'bg-violet-800/85' : 'bg-cyan-800/85'
            const loud = sounding(c) // 有声音的片段（影片、音频·声音没分离出去）才画波形与音量线
            const g = T.clipGain(c)
            const wPx = Math.max(4, c.length * pxPerSec)
            return (
              <div key={c.id} data-testid="vedit-clip" data-kind={c.text ? 'text' : c.sticker ? 'sticker' : c.filter ? 'filter' : c.adjust ? 'adjust' : c.program ? 'program' : c.shape ? 'shape' : c.solid ? 'solid' : c.bgfx ? 'bgfx' : m?.kind} data-clip-id={c.id} data-picked={on ? '1' : '0'}
                data-muted={c.muted ? '1' : '0'} data-disabled={c.disabled ? '1' : '0'} data-detached={c.detached ? '1' : '0'} data-group={c.group ?? ''}
                onPointerDown={onClipDown(ln, c, 'move')} onContextMenu={onClipMenu(ln, c)} onPointerDownCapture={tool === 'blade' ? onBladeDown(ln, c) : undefined}
                className={`group isolate absolute top-2 bottom-2 rounded overflow-hidden flex items-center text-[11px] touch-none ${ln.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${ln.hidden || c.disabled || landSet.has(c.id) ? 'opacity-40' : ''} ${landSet.has(c.id) ? 'outline-dashed outline-1 outline-white/70' : ''} ${tone} ${on ? 'ring-2 ring-white z-10' : ''}`} data-landing={landSet.has(c.id) ? '1' : undefined}
                style={{ left: c.start * pxPerSec, width: wPx }} title={c.text ? c.text.content : stk ? stk.name[language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'] : flc ? flc.name[language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'] : m?.name}>
                {m?.kind === 'image' && <img crossOrigin={MEDIA_CORS} src={m.url} alt="" className="h-full w-auto shrink-0 opacity-70 pointer-events-none" draggable={false} />}
                {/*  影片片段铺一条缩图（垫在最底下·isolate 让它压在片段底色之上、字与小标之下） */}
                {m?.kind === 'video' && m.url && !m.missing && !showNoPicture(m) && <div className="absolute inset-0 -z-10"><VeditFilmstrip mediaId={storeKeyOf(m)} url={m.url} offset={c.offset} srcLen={c.length * T.speedOf(c)} widthPx={wPx} duration={m.duration} reverse={!!c.reverse} sprite={m.thumbs} /></div>}
                {stk && <img src={stickerSrc(stk)} alt="" className="h-full w-auto shrink-0 p-1 pointer-events-none" draggable={false} />}
                {flc && <img src={filterThumb(flc.id)} alt="" className="h-full w-auto shrink-0 p-1 rounded pointer-events-none" draggable={false} />}
                {c.program && <span className="relative shrink-0 pl-1.5 text-[11px] text-teal-200 pointer-events-none" aria-hidden>{'</>'}</span>}
                {/* 身上有特效 ⇒ 右上角一个小标（✦几个） */}
                {/* 组里的段左上角一个小链子（同组的一起选、一起拖） */}
                {c.group && <span data-testid="vedit-clip-group" data-group={c.group} title={t('vedit_clip_grouped')} className="absolute top-0.5 left-1 z-[1] px-0.5 rounded bg-black/55 text-[10px] leading-4 text-sky-200 pointer-events-none">⛓</span>}
                {!!c.fx?.length && <span data-testid="vedit-clip-fx" data-fx={c.fx.map((x) => x.fx).join(',')} title={c.fx.map((x) => fxName(x.fx, language as FxLang)).join('、')}
                  className="absolute top-0.5 right-2.5 z-[1] px-1 rounded bg-black/55 text-[10px] leading-4 text-amber-200 pointer-events-none">✦{c.fx.length}</span>}
                {/*  曲线变速：左下角小标；关键帧：选中的段在条上画小菱形（剪映同）·点一下播放头跳过去 */}
                {c.curve && <span data-testid="vedit-clip-curve" data-curve={c.curve.id} title={t('vedit_ci_sub_speed_curve')} className="absolute bottom-0.5 left-1 z-[1] px-0.5 rounded bg-black/55 text-[10px] leading-4 text-cyan-200 pointer-events-none">∿{Math.round(T.speedOf(c) * 10) / 10}x</span>}
                {on && c.kf && clipKfTimes(c).map((kt) => (
                  <button key={kt} type="button" data-testid="vedit-clip-kf" data-t={kt} title={t('vedit_ci_kf')} aria-label={t('vedit_ci_kf')}
                    onPointerDown={(e) => { e.stopPropagation(); seekTimeline(kt) }}
                    className="absolute top-0.5 z-[2] -translate-x-1/2 w-3 h-3 flex items-center justify-center text-[#ffffff] hover:text-cyan-300" style={{ left: (kt - c.start) * pxPerSec }}>
                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" aria-hidden><path d="M6 1l5 5-5 5-5-5z" fill="currentColor" stroke="#0a0a0a" strokeWidth={1} /></svg>
                  </button>
                ))}
                {/* 声音波形＋音量线：下面七成那块画波形·横线高度＝这段音量（100% 在四分之三高·按分贝走）；拖上拖下调·双击回 100%·拖时旁边即时显示数字 */}
                {loud && (
                  <div className="absolute inset-x-2 bottom-0 top-[28%]" data-testid="vedit-clip-audio">
                    <ClipWave peaks={peaks[c.mediaId]} offset={c.offset} length={c.length * T.speedOf(c)} widthPx={wPx} gain={g} fadeIn={c.length > 0 ? (c.fadeIn ?? 0) / c.length : 0} fadeOut={c.length > 0 ? (c.fadeOut ?? 0) / c.length : 0} />
                    {/* 有淡入淡出 ⇒ 音量线照剪映画成曲线（高度按分贝·同横线）；拖的那条横线照旧在中段 */}
                    {((c.fadeIn ?? 0) > 0 || (c.fadeOut ?? 0) > 0) && (
                      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" aria-hidden data-testid="vedit-clip-vol-curve">
                        <path d={volumeEnvelope(c, g).map(([x, gg], i) => `${i ? 'L' : 'M'}${x} ${(1 - T.gainToFrac(gg)).toFixed(4)}`).join('')} fill="none" stroke="#ffffff" strokeOpacity={0.75} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
                      </svg>
                    )}
                    <div style={{ top: `${(1 - T.gainToFrac(g)) * 100}%` }} data-testid="vedit-clip-vol" data-gain={g.toFixed(2)}
                      title={`${T.volumeLabel(g)} · ${t('vedit_vol_hint')}`}
                      {...(ln.locked ? {} : { onPointerDown: onVolDown(c), onPointerMove: onVolMove, onPointerUp: onVolUp, onPointerCancel: onVolUp, onDoubleClick: onVolReset(c) })}
                      className={`group/vol absolute inset-x-0 h-2 -translate-y-1/2 ${ln.locked ? 'pointer-events-none' : 'cursor-ns-resize'}`}>
                      <div className={`absolute top-1/2 h-px bg-[#ffffff]/60 group-hover/vol:bg-[#ffffff] group-hover/vol:h-0.5 ${(c.fadeIn ?? 0) > 0 || (c.fadeOut ?? 0) > 0 ? 'opacity-0 group-hover/vol:opacity-100' : ''}`} style={{ left: 0, right: 0 }} />
                    </div>
                    {volDrag?.clip === c.id && (
                      <span className="absolute right-0 -translate-y-full rounded bg-black/75 px-1 text-[10px] leading-4 tabular-nums text-[#ffffff] pointer-events-none" style={{ top: `${(1 - T.gainToFrac(g)) * 100}%` }} data-testid="vedit-clip-vol-label">{T.volumeLabel(volDrag.g)}</span>
                    )}
                  </div>
                )}
                {/* 停用／静音／声音已分离：片段左上小标 */}
                {(c.disabled || c.muted || c.detached || (loud && g !== 1) || (loud && m?.noSound)) && (
                  <span className={`relative ml-1 shrink-0 flex items-center gap-0.5 text-neutral-200 pointer-events-none ${loud ? 'self-start mt-0.5' : ''}`} data-testid="vedit-clip-flags">
                    {c.disabled && <span className="px-1 rounded bg-black/40 text-[9px]">{t('vedit_clip_disabled')}</span>}
                    {loud && m?.noSound && <span className="px-1 rounded bg-amber-900/80 text-[9px] text-amber-200" title={t('vedit_audio_decode_fail').replace('{name}', m.name)} data-testid="vedit-clip-no-sound">⚠ {t('vedit_no_sound_badge')}</span>}
                    {(c.muted || c.detached) && <LaneIcon name="vol-off" />}
                    {loud && g !== 1 && <span className="px-1 rounded bg-black/40 text-[9px] tabular-nums" data-testid="vedit-clip-vol-badge">{T.volumeLabel(g)}</span>}
                  </span>
                )}
                <span className={`relative px-2 truncate pointer-events-none ${loud ? 'self-start leading-4 mt-0.5' : ''} ${c.disabled ? 'line-through' : ''}`}>{c.text ? `T ${c.text.content}` : stk ? stk.name[language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'] : flc ? `${flc.name[language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw']} ${Math.round((filterLive?.id === c.id ? filterLive.strength : c.filter!.strength) * 100)}%` : c.program ? (prb ? l10n(prb.manifest.name, language as ProgLang) : t('vedit_lane_program')) : c.adjust ? `◐ ${t('vedit_adjust_layer')}` : c.shape ? `◇ ${t(SHAPE_LABEL[c.shape.shape])}` : c.solid ? `■ ${t('vedit_solid')} ${c.solid.color}` : c.bgfx ? `✦ ${t(BGFX_LABEL[c.bgfx.kind])}` : m?.name}</span>
                {/* 拉两端修剪；锁了的轨不给拉 */}
                {!ln.locked && <>
                  <div data-testid="vedit-clip-trim-l" onPointerDown={onClipDown(ln, c, 'l')}
                    className={`absolute left-0 inset-y-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/60 ${on ? 'bg-white/50' : ''}`} />
                  <div data-testid="vedit-clip-trim-r" onPointerDown={onClipDown(ln, c, 'r')}
                    className={`absolute right-0 inset-y-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/60 ${on ? 'bg-white/50' : ''}`} />
                </>}
              </div>
            )
          })}
          {/* 接缝上的转场＝横跨切点的小标记（宽＝转场长短）·点一下选中（转场页签上方调长短／拿掉·Delete 删） */}
          {ln.kind === 'visual' && laneSeams(ln).map((sm) => {
            const L = trLive?.id === sm.id ? trLive.length : sm.length
            return (
              <button key={`tr-${sm.id}`} type="button" data-testid="vedit-trans-mark" data-clip-id={sm.id} data-tr={sm.tr} data-picked={selTrans === sm.id ? '1' : '0'} title={fxName(sm.tr, language as FxLang)}
                onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSel([]); setSelTrans(sm.id); setTopTab('transition') }}
                className={`absolute top-1/2 -translate-y-1/2 z-20 h-5 rounded-sm border text-[10px] leading-none flex items-center justify-center overflow-hidden ${selTrans === sm.id ? 'bg-amber-300 border-white text-neutral-900' : 'bg-neutral-900/85 border-amber-300 text-amber-200 hover:bg-neutral-800'}`}
                data-head={sm.head ? '1' : '0'} style={{ left: (sm.head ? sm.cut : sm.cut - L / 2) * pxPerSec, width: Math.max(12, L * pxPerSec) }}>⧓</button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-neutral-950 text-neutral-200 select-none" data-testid="vedit-page">
      {projectsOpen && host.renderProjectsDialog?.({ currentId: proj?.id ?? null, onOpen: openProject, onClose: () => setProjectsOpen(false) })}
      {historyOpen && proj && host.renderHistoryDialog?.({ projectId: proj.id, onRestore: restoreVersion, onClose: () => setHistoryOpen(false) })}
      {remoteAsk && <VeditRemoteAskDialog canMerge={remoteAsk.canMerge} onPick={(how) => { void resolveRemote(how) }} />}
      {exportOpen && exportEnvRef.current && <VeditExportDialog env={exportEnvRef.current()} ratio={stageRatio} title={shownTitle} end={end} cloud={arrangeCloud} onClose={() => setExportOpen(false)} sel={sel} now={now} drive={exportDrive} />}
      {settingsOpen && host.renderSettingsDialog({ value: settings, onChange: changeSettings, onClose: () => setSettingsOpen(false) })}
      {licensesOpen && <LicensesDialog onClose={() => setLicensesOpen(false)} />}
      {upDialog && (() => {
        const um = media.find((x) => x.id === upDialog.id)
        const close = () => setUpDialog(null)
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4" onClick={close} data-testid="vedit-up-dialog">
            <div className="w-full max-w-sm rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-semibold text-neutral-100 mb-1">{t('vedit_up_title')}</div>
              <div className="text-xs text-neutral-400 truncate mb-3" title={um?.name}>{um?.name ?? ''}</div>
              {!um ? null : um.driveId ? (
                <div className="text-sm text-emerald-400 mb-3" data-testid="vedit-up-done">{t('vedit_up_done')}</div>
              ) : !um.up ? (
                <div className="text-sm text-neutral-400 mb-3" data-testid="vedit-up-stopped">{t('vedit_up_stopped')}</div>
              ) : upDialog.confirm ? (
                <div className="text-sm text-amber-300 mb-3 leading-relaxed" data-testid="vedit-up-confirm">{t('vedit_up_cancel_warn')}</div>
              ) : (
                <div className="mb-3">
                  <div className="h-2 rounded-full bg-neutral-800 overflow-hidden"><div className="h-full bg-cyan-500 transition-[width]" style={{ width: `${Math.round(um.up.p * 100)}%` }} /></div>
                  <div className="mt-1 text-xs text-neutral-400 tabular-nums" data-testid="vedit-up-pct">{Math.round(um.up.p * 100)}%</div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                {um?.up && !upDialog.confirm && (
                  <button type="button" data-testid="vedit-up-cancel" onClick={() => setUpDialog({ id: upDialog.id, confirm: true })}
                    className="h-8 px-3 rounded-md text-sm text-red-300 hover:bg-neutral-800">{t('vedit_up_cancel')}</button>
                )}
                {um?.up && upDialog.confirm ? (
                  <>
                    <button type="button" onClick={() => setUpDialog({ id: upDialog.id, confirm: false })} className="h-8 px-3 rounded-md text-sm text-neutral-300 hover:bg-neutral-800">{t('vedit_up_keep')}</button>
                    <button type="button" data-testid="vedit-up-cancel-ok" onClick={() => { cancelUpload(upDialog.id); close() }}
                      className="h-8 px-3 rounded-md text-sm bg-red-600 hover:bg-red-500 text-white">{t('vedit_up_cancel_ok')}</button>
                  </>
                ) : (
                  <button type="button" onClick={close} className="h-8 px-3 rounded-md text-sm bg-neutral-700 hover:bg-neutral-600 text-neutral-100">{t('vedit_set_close')}</button>
                )}
              </div>
            </div>
          </div>
        )
      })()}
      {/* 顶栏 */}
      <div className="relative h-11 shrink-0 flex items-center justify-between px-4 border-b border-neutral-800">
        {/* 角色在改这份工程档 ⇒ 顶栏正中（同四编辑页） */}
        {host.renderAiShieldPill(aiShield)}
        <div className="flex items-center gap-3">
          {/* 照首页顶栏——麒麟图标＋「堤麟AI」·点了回首页 */}
          {host.renderHomeBrand({ tone: 'dark', testId: 'vedit-home' })}
          {/* （样子同設定钮） */}
          {host.renderProjectsDialog && host.has(VEDIT_FEATURES.projects) && <button type="button" data-testid="vedit-projects-btn" onClick={() => setProjectsOpen(true)}
            className="h-7 px-2.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 flex items-center gap-1">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden><path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75ZM3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Z" /></svg>
            {t('vedit_projects')}
          </button>}
          <button type="button" data-testid="vedit-settings-btn" onClick={() => { setSettingsOpen(true); host.drive?.ensureLoaded() }}
            className="h-7 px-2.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 flex items-center gap-1">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden><path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" /></svg>
            {t('vedit_settings')}
          </button>
          {/* 第三方授權（编码器等元件的授权全文·游客版） */}
          {host.has(VEDIT_FEATURES.licenses) && (
            <button type="button" data-testid="vedit-licenses-open" onClick={() => setLicensesOpen(true)}
              className="h-7 px-2.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200">{t('vedit_guest_licenses')}</button>
          )}
        </div>
        {/* 开着云盘工程档 ⇒ 剪辑名＋存档状态；没开 ⇒ 草稿状态（原「存成剪輯檔」钮拿掉·一动手就自动存成草稿） */}
        <div className="flex items-center gap-2 min-w-0" data-testid="vedit-proj">
          {/* 双击 ⇒ 同样大小的输入框（全选原名）·Enter／失焦存·Esc 取消 */}
          {renaming !== null ? (
            <input autoFocus data-testid="vedit-proj-title-input" value={renaming} maxLength={VEDIT_NAME_MAX} aria-label={t('vedit_rename_hint')}
              onChange={(e) => setRenaming(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                e.stopPropagation() // 空格、b／a、Delete、←→、Ctrl+Z 等只给输入框（全局快捷键那只 typing() 也认得 input·双保险）
                if (e.nativeEvent.isComposing) return // 中文输入法选字的 Enter 不算
                if (e.key === 'Enter') { e.preventDefault(); finishRename(e.currentTarget.value) } else if (e.key === 'Escape') { e.preventDefault(); finishRename(null) }
              }}
              onBlur={(e) => finishRename(e.currentTarget.value)}
              style={titleBox ? { width: Math.max(titleBox.w, 96), height: titleBox.h } : undefined}
              className="text-sm text-neutral-100 bg-neutral-800 rounded-sm px-0 py-0 border-0 outline-none ring-1 ring-cyan-500 max-w-[40vw] min-w-0" />
          ) : (
            <span ref={titleRef} className={`text-sm text-neutral-300 truncate max-w-[40vw] ${canRename ? 'cursor-text hover:text-neutral-100' : ''}`} data-testid="vedit-proj-title"
              title={canRename ? t('vedit_rename_hint') : undefined} onDoubleClick={startRename}>{shownTitle}</span>
          )}
          {proj ? (
            <span className="text-[11px] text-neutral-500 shrink-0" data-testid="vedit-proj-save" data-state={projState === 'gone' ? 'gone' : remoteAsk || saveState === 'held' ? 'ask' : saveState}>
              {projState === 'gone' ? t('vedit_proj_gone') : remoteAsk || saveState === 'held' ? t('vedit_remote_pending') : saveState === 'saving' ? t('vedit_proj_saving') : saveState === 'error' ? t('vedit_proj_save_fail') : t('vedit_proj_saved')}
            </span>
          ) : null}
          {proj && projState !== 'gone' && host.renderHistoryDialog && host.has(VEDIT_FEATURES.history) ? (
            <button type="button" data-testid="vedit-history-btn" onClick={() => setHistoryOpen(true)}
              className="h-6 px-2 rounded-md bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 shrink-0">{t('vedit_history')}</button>
          ) : null}
          {proj ? null : projState === 'loading' ? (
            <span className="text-[11px] text-neutral-500 shrink-0">{t('vedit_proj_loading')}</span>
          ) : projState === 'gone' ? (
            <span className="text-[11px] text-amber-400 shrink-0" data-testid="vedit-proj-save" data-state="gone">{t('vedit_proj_load_fail')}</span>
          ) : draftView.phase === 'failed' ? (
            <>
              <span className="text-[11px] text-amber-400 truncate" data-testid="vedit-draft-state" data-state="failed" data-fail={draftView.fail}>
                {t(draftView.fail === 'login' ? 'vedit_draft_fail_login' : draftView.fail === 'full' ? 'vedit_draft_fail_full' : draftView.fail === 'net' ? 'vedit_draft_fail_net' : 'vedit_draft_fail_other')}
              </span>
              <button type="button" data-testid="vedit-draft-retry" onClick={() => { void ensureDraft(true) }}
                className="h-6 px-2 rounded-md bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-200 shrink-0">{t('vedit_draft_retry')}</button>
            </>
          ) : (
            <span className="text-[11px] text-neutral-500 shrink-0" data-testid="vedit-draft-state" data-state={draftView.phase} title={t('vedit_draft_idle_hint')}>
              {draftView.phase === 'creating' ? t('vedit_draft_creating') : t('vedit_draft_idle')}
            </span>
          )}
        </div>
        {/* 顶栏右段跟右栏同宽（对在角色名正上方）·左边两页签、右边匯出 */}
        <div className="shrink-0 -mr-2.5 flex items-center justify-between gap-2" style={{ width: shown.chatW }} data-testid="vedit-side-bar">
          <div role="tablist" aria-label={t('vedit_side_tabs')} className="self-stretch flex items-stretch gap-1">
            {SIDE_TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={sideTab === k} data-testid={`vedit-side-${k}`} onClick={() => pickSideTab(k)} onMouseDown={(e) => e.preventDefault()}
                className={`px-3 text-sm border-b-2 ${sideTab === k ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}>{t(k === 'ai' ? 'vedit_side_ai' : 'vedit_side_manual')}</button>
            ))}
          </div>
          <button type="button" onClick={() => setExportOpen(true)} data-testid="vedit-export-open" className="px-3 py-1 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-sm">{t('vedit_export')}</button>
        </div>
      </div>

      <VeditProjectGroupNotice notice={projectGroupNotice} projectId={proj?.id ?? null} t={t} onClose={() => setProjectGroupNotice(null)} />
      {/* 同一份剪辑在别的分页开着、那页是主分页 ⇒ 这页不接角色的活·挂一条提示（宿主没给中继＝游客版 ⇒ 不挂） */}
      {openElsewhere && (
        <div className="shrink-0 px-4 py-1 text-xs text-neutral-100 bg-amber-950/90 border-b border-amber-700" data-testid="vedit-elsewhere-bar">
          {t('vedit_open_elsewhere')}
        </div>
      )}
      {/* 主体：上排三格＋横拉条＋轨道 */}
      <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col p-1.5" data-testid="vedit-body">
      <div className="shrink-0 min-h-0 flex" style={{ height: `${shown.topFrac * 100}%` }} data-testid="vedit-top-row">
        {/* 左：素材区 */}
        <div className="shrink-0 flex flex-col rounded-md bg-neutral-900 overflow-hidden" style={{ width: shown.mediaW }} data-testid="vedit-media-pane">
          {/* 小顶 bar：素材｜文本｜特效｜转场｜字幕｜技能 */}
          <div className="h-12 shrink-0 flex items-stretch gap-1 px-1.5 border-b border-neutral-800 overflow-x-auto">
            {TOP_TABS.map((k) => (
              <button key={k} type="button" onClick={() => setTopTab(k)} data-testid={`vedit-top-${k}`}
                className={`w-14 shrink-0 flex flex-col items-center justify-center gap-0.5 text-[11px] border-b-2 ${topTab === k ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}>
                {/* 识别字幕在背景跑时「字幕」页签换成转圈＋「識別中」·点回来看进度 */}
                {k === 'caption' && asrPhase.kind !== 'idle' ? <AsrSpinner className="w-4 h-4" /> : isAssetTab(k) ? <AssetTabIcon tab={k} /> : k === 'arrange'
                  ? <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden><path d="M16 2.5v10.25a2.75 2.75 0 1 1-1.5-2.45V6.06L8 7.4v7.35a2.75 2.75 0 1 1-1.5-2.45V4.5L16 2.5Z" /></svg>
                  : k === 'media'
                  ? <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909-.48-.48a.75.75 0 0 0-1.06 0L6.53 11.06l-4.03-4.03v4.03Z" clipRule="evenodd" /></svg>
                  : <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684Z" /></svg>}
                <span data-asr-busy={k === 'caption' && asrPhase.kind !== 'idle' ? '1' : undefined}>{k === 'arrange' ? t('bf_varr_tab') : t(k === 'caption' && asrPhase.kind !== 'idle' ? 'vedit_asr_badge' : isAssetTab(k) ? ASSET_TAB_SPEC[k].label : k === 'media' ? 'vedit_top_media' : 'vedit_top_skill')}</span>
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" multiple accept={`video/*,audio/*,image/*,${MEDIA_ACCEPT_EXTS},.fcpxml,.xml,.json,.edl,.otio,.srt,.vtt,.ass,.ssa`} className="hidden" onChange={(e) => { void onPick(e.target.files); e.target.value = '' }} />
          {topTab === 'arrange' ? (
            <VeditArrangePane lang={arrLang(language)} onExport={exportArrange} onAddMedia={addArrangeMedia} cloud={arrangeCloud ?? undefined} shell={host.shell ? { devices: mediaDevs, put: shellPut, api: host.shell, stems: songStems } : undefined} asr={host.asr} creditUrl={host.arrangeCreditUrl} />
          ) : topTab === 'skill' ? (
            <p className="flex-1 p-4 text-xs text-neutral-500 text-center leading-relaxed" data-testid="vedit-skill-pane">{t('vedit_skill_empty')}</p>
          ) : isAssetTab(topTab) ? (
            <VeditAssetPane tab={topTab} sideW={shown.driveW} notice={notice} fancy={{ onPick: pickFancy, active: fancyActive }} textNew={{ onDefault: addPlainText, onImport: (f) => { void importSubtitles(f) } }}
                asr={<VeditAsrPane host={{ avail: asrAvailability({ webgpu: asrGpu, host: asrModelSrc }), phase: asrPhase, hasSel: asrHasSel, onStart: (s, l) => { void startAsr(s, l) }, onCancel: cancelAsr, ...(host.shell ? { shell: { devices: mediaDevs, phase: shellAsr, onRun: (d, s, l) => { void startShellAsr(d, s, l) }, onCancel: cancelShellAsr, picker: host.shell.renderPicker } } : {}), ...(cloudAsr ? { cloud: { quota: cloudLeft, phase: cloudPhase, estimate: cloudEstimate, onRun: (s, l, x) => { void startCloudAsr(s, l, x) }, onCancel: cancelCloudAsr } } : {}) }} />} vector={{ onShape: (k) => pickVector(newShapeClip(crypto.randomUUID(), k)), onSolid: (col) => pickVector(newSolidClip(crypto.randomUUID(), col)), onBgfx: (k) => pickVector(newBgfxClip(crypto.randomUUID(), k, bgfxSeed(Math.random()))) }} sticker={{ onPick: pickSticker, favs: favs.sticker, onFav: (id) => flipFav('sticker', id) }}
              filter={{ onPick: pickFilter, favs: favs.filter, onFav: (id) => flipFav('filter', id), selected: selFilter, onStrength: onFilterStrength }}
              fx={{ ...fxHost, favs: favs.fx, onFav: (id) => flipFav('fx', id) }} transition={{ ...trHost, favs: favs.transition, onFav: (id) => flipFav('transition', id) }}
              program={{ builtins: BUILTIN_PROGRAMS, uploaded: uploadedProgs, onPick: pickProgramClick, onUpload: uploadProgram, selected: selProgram, onParam: onProgramParam }} splitter={<Splitter dir="col" label={t('vedit_resize')} testid="vedit-split-asset" {...splitProps('drive')} />} audio={audioLib} />
          ) : (
            <div className="flex-1 min-h-0 flex">
              {/* 左窄栏（照剪映）：匯入｜雲端硬碟——点「雲端硬碟」整格展开／再点收起·树就长在窄栏里 */}
              <div className="shrink-0 min-h-0 flex flex-col py-2 border-r border-neutral-800" style={{ width: shown.driveW }} data-testid="vedit-side">
                <div className="mx-1.5 px-2 py-1.5 rounded text-left text-xs bg-neutral-800 text-cyan-400 truncate" data-testid="vedit-tab-import">{t('vedit_tab_import')}</div>
                <div className="mx-1.5 mt-1 flex items-center gap-0.5">
                <button type="button" onClick={() => setDriveOpen((o) => !o)} data-testid="vedit-tab-drive" aria-expanded={driveOpen}
                  className={`flex-1 min-w-0 flex items-center gap-1 px-1 py-1.5 rounded text-left text-xs hover:bg-neutral-800 ${driveOpen ? 'text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}`}>
                  <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 transition-transform ${driveOpen ? 'rotate-90' : ''}`} aria-hidden><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" /></svg>
                  <span className="truncate">{host.driveSlotLabel ?? t('vedit_tab_drive')}</span>
                </button>
                {/* 眼睛钮——闭眼＝只列影片／音频／图片·睁眼＝全部种类 */}
                {host.has(VEDIT_FEATURES.driveAll) && host.renderDriveEye?.()}
                </div>
                {driveOpen && (
                  <div className="flex-1 min-h-0 mt-1" data-testid="vedit-drive-tree">{driveTree}</div>
                )}
              </div>
              <Splitter dir="col" label={t('vedit_resize')} testid="vedit-split-drive" {...splitProps('drive')} />
              {/* 右：素材格（只放素材）·电脑的档与云盘树的影音图档都能拖进来 */}
              <div className={`relative flex-1 min-w-0 overflow-auto ${dropping ? 'ring-2 ring-inset ring-cyan-500 bg-cyan-500/5' : ''}`} data-testid="vedit-media-grid" data-dropping={dropping ? '1' : '0'}
                onDragOver={(e) => { if (!acceptsMediaDrop(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropping) setDropping(true) }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false) }}
                onDrop={onMediaDrop}>
                {notice && (
                  <div className="sticky top-0 z-10 mx-2 mt-2 rounded bg-neutral-800 px-2 py-1 text-[11px] text-amber-300" role="status" data-testid="vedit-media-notice">{notice}
                    {noticeRetry && noticeRetry.text === notice && (
                      <button type="button" data-testid="vedit-media-notice-retry" className="ml-2 underline text-cyan-300 hover:text-cyan-200"
                        onClick={() => { const r = noticeRetry; setNoticeRetry(null); setNotice(null); soundWarned.current.delete(r.id); peaksAsked.current.delete(r.id); if (r.what === 'fetch') prepare(r.id); else setPeaksNudge((n) => n + 1) }}>{t('vedit_audio_retry')}</button>
                    )}
                  </div>
                )}
                {media.length === 0 ? (
                  <div className="p-3 space-y-3">
                    <button type="button" onClick={openImport} data-testid="vedit-import"
                      className="w-full h-24 rounded-lg bg-neutral-800 hover:bg-neutral-700 flex flex-col items-center justify-center gap-1">
                      <span className="text-sm text-neutral-100">＋ {t('vedit_import_btn')}</span>
                      <span className="text-xs text-neutral-400">{t('vedit_import_hint')}</span>
                    </button>
                    {host.webShot && (
                      <button type="button" onClick={() => setWebShotOpen(true)} data-testid="vedit-webshot"
                        className="w-full h-9 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-100">{t('vedit_ws_btn')}</button>
                    )}
                    <p className="text-xs text-neutral-500 text-center leading-relaxed">{t('vedit_media_empty')}</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-2">
                    {/* 有素材 ⇒ 「匯入」缩成左上小钮（照剪映）·右边搜寻框与排序 */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                    <button type="button" onClick={openImport} data-testid="vedit-import" data-size="small"
                      className="h-7 px-2.5 rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1 text-xs text-neutral-100">
                      <span className="w-4 h-4 rounded-full bg-cyan-500 text-white flex items-center justify-center text-[11px] leading-none">＋</span>
                      {t('vedit_import_btn')}
                    </button>
                    {host.webShot && (
                      <button type="button" onClick={() => setWebShotOpen(true)} data-testid="vedit-webshot" data-size="small" title={t('vedit_ws_title')}
                        className="h-7 px-2.5 rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1 text-xs text-neutral-100">{t('vedit_ws_btn')}</button>
                    )}
                    <input type="search" value={mediaQ} onChange={(e) => setMediaQ(e.target.value)} placeholder={t('vedit_media_search')} aria-label={t('vedit_media_search')} data-testid="vedit-media-search"
                      className="flex-1 min-w-20 h-7 rounded-md bg-neutral-800 border border-neutral-700 focus:border-cyan-600 outline-none px-2 text-xs text-neutral-100 placeholder:text-neutral-500" />
                    <select value={mediaSort} onChange={(e) => setMediaSort(e.target.value as MediaSort)} aria-label={t('vedit_media_sort')} title={t('vedit_media_sort')} data-testid="vedit-media-sort"
                      className="h-7 rounded-md bg-neutral-800 border border-neutral-700 px-1 text-xs text-neutral-200 outline-none">
                      {MEDIA_SORTS.map((s) => <option key={s} value={s}>{t(MEDIA_SORT_LABEL[s])}</option>)}
                    </select>
                    <button type="button" onClick={() => setMediaDesc((d) => !d)} aria-pressed={mediaDesc} data-testid="vedit-media-sort-dir" title={t(mediaDesc ? 'vedit_media_sort_desc' : 'vedit_media_sort_asc')} aria-label={t(mediaDesc ? 'vedit_media_sort_desc' : 'vedit_media_sort_asc')}
                      className="h-7 w-7 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300">{mediaDesc ? '↓' : '↑'}</button>
                    </div>
                    {mediaQ.trim() && !mediaListView(media.filter((m) => !m.stemOf), mediaQ, mediaSort).length && <p className="text-xs text-neutral-500 text-center py-4" data-testid="vedit-media-search-empty">{t('vedit_media_search_empty')}</p>}
                    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(104px,1fr))]">
                      {mediaListView(media.filter((m) => !m.stemOf), mediaQ, mediaSort, mediaDesc).map((m) => (
                        <div key={m.id} onContextMenu={m.stems?.length ? (e) => { e.preventDefault(); setSelected(m.id); setMediaMenu({ x: e.clientX, y: e.clientY, id: m.id }) } : undefined} data-stems={m.stems?.length ?? 0} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_MIME, m.id); const tk = mediaTokenOf(m); if (tk) e.dataTransfer.setData('text/plain', tk) /* 拖到对话框＝一颗素材卡 */ }} onClick={() => { setSelected(m.id); setSourceMode(true); setPlaying(false) }} onDoubleClick={() => appendToTrack(m)}
                          className={`rounded-md overflow-hidden cursor-grab bg-neutral-800 border ${selected === m.id ? 'border-cyan-500' : 'border-transparent'} ${findFlash === m.id ? 'ring-2 ring-cyan-300 animate-pulse' : ''}`} data-testid="vedit-media-item" data-media-id={m.id}>
                          <div className="relative aspect-video bg-neutral-700 flex items-center justify-center overflow-hidden">
                            {m.noSound && !m.missing && <span className="absolute inset-x-0 bottom-0 z-10 px-1 py-0.5 bg-amber-900/85 text-[10px] text-amber-100 text-center truncate" title={t('vedit_audio_decode_fail').replace('{name}', m.name)} data-testid="vedit-media-no-sound">⚠ {t('vedit_no_sound_badge')}</span>}
                            {m.missing && <span className="absolute inset-x-0 bottom-0 z-10 px-1 py-0.5 bg-red-900/85 text-[10px] text-red-100 text-center truncate" data-testid="vedit-media-missing" title={m.denied ? t('vedit_proj_denied') : undefined}>{t(m.denied ? 'vedit_proj_denied' : 'vedit_proj_missing')}</span>}
                            {!!m.stems?.length && <span className="absolute left-1 top-1 z-10 px-1 rounded bg-violet-600/90 text-[10px] leading-4 text-white" title={t('vedit_media_multi_hint')} data-testid="vedit-media-multi">{t('vedit_media_multi').replace('{n}', String(m.stems.length))}</span>}
                            {m.up && (
                              /* 背景上传中 ⇒ 右上角转圈（外圈照进度填）·点开看进度、可取消 */
                              <button type="button" data-testid="vedit-media-upload" data-p={m.up.p.toFixed(2)} title={t('vedit_up_title')} aria-label={t('vedit_up_title')}
                                onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); setUpDialog({ id: m.id, confirm: false }) }}
                                className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center"
                                style={{ background: `conic-gradient(#22d3ee ${Math.round(m.up.p * 360)}deg, rgba(0,0,0,0.6) 0deg)` }}>
                                <span className="w-[18px] h-[18px] rounded-full bg-neutral-900 flex items-center justify-center">
                                  <span className="w-3 h-3 rounded-full border-2 border-cyan-300 border-t-transparent animate-spin" />
                                </span>
                              </button>
                            )}
                            {m.kind === 'image' ? <img crossOrigin={MEDIA_CORS} src={m.url} alt="" className="w-full h-full object-cover" />
                              : showNoPicture(m) ? <span className="px-1.5 text-[10px] leading-snug text-amber-300 text-center" title={noPictureBody(m)} data-testid="vedit-media-no-picture">⚠ {t('vedit_no_picture_card')}</span>
                              : m.kind === 'video' ? <video crossOrigin={MEDIA_CORS} src={m.url} muted preload="metadata" className="w-full h-full object-cover" />
                                : <span className="text-2xl">♪</span>}
                          </div>
                          <div className="px-1.5 py-1 text-[11px] text-neutral-300 truncate" title={m.name}>{m.name}</div>
                          <div className="px-1.5 pb-1 flex items-center gap-1 text-[10px] text-neutral-500">
                            <span className="tabular-nums">{fmtTime(m.duration)}</span>
                            {m.work ? (
                              <span className="truncate text-cyan-400" data-testid="vedit-media-work">{t(WORK_KEY[m.work.what]).replace('{p}', String(Math.round((m.work.p ?? 0) * 100)))}</span>
                            ) : m.shellPx ? (
                              <span className="truncate text-cyan-400" data-testid="vedit-media-shell-proxy" title={t('vedit_work_shell_hint').replace('{device}', proxyDevCache.current?.dev?.name ?? '')}>{m.shellPx.wait ? t('vedit_work_shell_wait') : t('vedit_work_shell').replace('{p}', String(Math.round(m.shellPx.p * 100)))}</span>
                            ) : host.drive && m.from === 'local' && !m.driveId ? (
                              <span className="px-1 rounded bg-neutral-700 text-neutral-300" title={t('vedit_local_hint')}>{t('vedit_local_badge')}</span>
                            ) : null}
                            <span className="ml-auto flex items-center gap-0.5">
                              {host.drive && host.has(VEDIT_FEATURES.drive) && m.from === 'local' && !m.driveId && !m.work && !m.up && (
                                <button type="button" title={t('vedit_save_drive')} aria-label={t('vedit_save_drive')} data-testid="vedit-media-save-drive"
                                  onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); void saveToDrive(m.id) }}
                                  className="h-4 w-4 flex items-center justify-center rounded text-neutral-400 hover:text-cyan-400 hover:bg-neutral-700">☁</button>
                              )}
                              {!m.work && (
                                <button type="button" title={t('vedit_remove')} aria-label={t('vedit_remove')} data-testid="vedit-media-remove"
                                  onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); removeMedia(m.id) }}
                                  className="h-4 w-4 flex items-center justify-center rounded text-neutral-400 hover:text-red-400 hover:bg-neutral-700">×</button>
                              )}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <Splitter dir="col" label={t('vedit_resize')} testid="vedit-split-media" {...splitProps('media')} />

        {/* 中：预览·捏合放大画面 */}
        <div ref={playerRef} className="flex-1 min-w-0 flex flex-col rounded-md bg-neutral-900 overflow-hidden" data-testid="vedit-player" data-full={isFull ? '1' : '0'} data-mode={sourceMode && current ? 'source' : 'timeline'}>
          <div className="h-9 shrink-0 px-3 flex items-center justify-between text-xs text-neutral-400 border-b border-neutral-800">
            <span className="min-w-0 truncate">{t('vedit_player')}{sourceMode && current ? ` · ${current.name}` : ''}
              {/* 时间轴预览时写明现在放的是哪份档（预览档／原档·转到几成）·倍速太高时写「跳格预览」 */}
              {!(sourceMode && current) && (() => {
                const hc = topVisual?.hit?.clip, pm = hc ? mediaOf(hc.mediaId) : undefined
                if (!hc || !pm || pm.kind !== 'video') return null
                const sp = T.speedOf(hc)
                const src = pm.proxied ? t('vedit_pv_proxy') : pm.work?.what === 'proxy' ? t('vedit_pv_orig_making').replace('{p}', String(Math.round((pm.work.p ?? 0) * 100)))
                  : pm.shellPx && !pm.shellPx.wait ? t('vedit_pv_orig_shell').replace('{p}', String(Math.round(pm.shellPx.p * 100))) : t('vedit_pv_orig')
                return <span className="ml-2 text-neutral-500" data-testid="vedit-pv-src" data-proxied={pm.proxied ? '1' : '0'} data-scrub={sp > T.SCRUB_RATE ? '1' : '0'}>· {src}{sp > T.SCRUB_RATE ? ` · ${t('vedit_pv_scrub').replace('{x}', String(Math.round(sp * 10) / 10))}` : ''}</span>
              })()}
            </span>
            {pvScale !== 1 && <button type="button" onClick={() => setPvScale(1)} className="px-1.5 rounded bg-neutral-800 hover:bg-neutral-700 tabular-nums" title={t('vedit_zoom_reset')}>{Math.round(pvScale * 100)}%</button>}
          </div>
          <div ref={playerBoxRef} className="flex-1 min-h-0 overflow-hidden bg-[#141414]" onDoubleClick={() => setPvScale(1)}>
            <div className="relative w-full h-full flex items-center justify-center" style={{ transform: pvScale !== 1 ? `scale(${pvScale})` : undefined }}>
            {/* 黑框＝成片画面；看单份原素材或「适应」但轨道上还没画面 ⇒ 不框、整块黑底 */}
            {(() => { const sb = !(sourceMode && current) && stageRatio !== null ? stageBox(pvBox.w, pvBox.h, stageRatio) : null
              // 四角透视：同汇出那个矩阵（pinMatrix）换成 CSS matrix3d·套在这一层整层上（舞台 px 大小）
              const pinCss = (c: T.TlClip | null | undefined): string | null => { const H3 = c ? pinMatrix(lookOf(c, now).pin) : null; const w = sb?.w ?? pvBox.w, h = sb?.h ?? pvBox.h; return H3 && w > 0 && h > 0 ? pinCssMatrix(H3, w, h) : null }
              // 运动跟踪：文字／贴纸整层跟着路径走（followAt 同汇出）·套在四角透视外面；回 null＝不变形
              const tsCss = (c: T.TlClip): string | null => { const w = sb?.w ?? pvBox.w, h = sb?.h ?? pvBox.h; const fo = w > 0 && h > 0 ? followAt(tracks, c, now, w / h) : null; const pn = pinCss(c); const a = [fo ? followCssMatrix(fo, w, h) : '', pn ?? ''].filter(Boolean).join(' '); return a || null }
              return (
            <div data-testid="vedit-stage" data-ratio={sb ? stageRatio!.toFixed(4) : ''} onPointerDown={(e) => (mosaicRecRef.current ? onMosaicDown(e) : onPicDown(e))} data-mosaic-rec={mosaicRec ? '1' : '0'} data-mt-sel={mtSel ? '1' : '0'} data-push-sel={pushSel ? '1' : '0'} className={`${mosaicRec || mtSel || pushSel ? 'cursor-crosshair ' : ''}relative shrink-0 overflow-hidden bg-black flex items-center justify-center`}
              style={{ ...(sb && sb.w > 0 ? { width: sb.w, height: sb.h } : { width: '100%', height: '100%' }), containerType: 'size' }}>
              {sourceMode && current ? (
                current.kind === 'image' ? <img crossOrigin={MEDIA_CORS} src={current.url} alt="" className="max-w-full max-h-full object-contain" />
                  : current.kind === 'video'
                    ? <>
                      <video key={current.id} ref={(el) => { sourceRef.current = el }} crossOrigin={MEDIA_CORS} src={current.url} className="max-w-full max-h-full" onTimeUpdate={(e) => setSrcNow(e.currentTarget.currentTime)} onSeeked={(e) => setSrcNow(e.currentTarget.currentTime)} />
                      {showNoPicture(current) && noPictureNote(current)}
                    </>
                    : <audio key={current.id} ref={(el) => { sourceRef.current = el }} crossOrigin={MEDIA_CORS} src={current.url} controls onTimeUpdate={(e) => setSrcNow(e.currentTarget.currentTime)} onSeeked={(e) => setSrcNow(e.currentTarget.currentTime)} />
              ) : (
                <>
                  {/* 每条轨一层·由下往上叠（上面的画面轨盖下面的）；隐藏的轨那层不画（元素也停掉·不出声） */}
                  {[...layers].reverse().map((s) => {
                    if (s.lane.kind === 'audio') return (   // 每段自己一个播放器（接下来那段先备好）
                      <Fragment key={s.lane.id}>{T.prerollClips(s.lane.clips, now).map((c) => <audio key={c.id} ref={clipElRef(c.id)} crossOrigin={MEDIA_CORS} preload="auto" data-testid="vedit-tl-audio" data-lane-id={s.lane.id} data-clip-id={c.id} data-active={c.id === s.hit?.clip.id ? '1' : '0'} className="hidden" />)}</Fragment>
                    )
                    if (s.lane.kind === 'text') {
                      // 文字轨：这一刻那段字叠在画面上·字高＝画面高×size（cqh）；停着时能拖、拉角、双击改字
                      const c = s.hit?.clip
                      if (!c?.text || !s.show || matteLanesAt(tracks, now).has(s.lane.id)) return <div key={s.lane.id} className="hidden" data-testid="vedit-tl-text-layer" data-lane-id={s.lane.id} data-show="0" />
                      const tb0 = textDrag?.id === c.id ? textDrag.body : textBodyAt(c, now) ?? c.text // 文字关键帧照播放头
                      // 「人工」面板拖着时即时看（textLive）·属性照 resolveTextLook 画（汇出 vedit-text-draw.ts 同一份）
                      const tb = textLive && textLive.ids.includes(c.id) ? applyTextPatch(tb0, textLive.patch) : tb0
                      const lk = resolveTextLook(tb)
                      // 文字动画：这一刻的姿势（入场出场按这段自己的秒·循环按接着播的秒）·汇出 drawTextBody 同一份；拖着、改字时不动
                      const pz = textDrag?.id === c.id || textEdit?.id === c.id ? null : textAnimPose(tb.anim, s.hit!.local - c.offset, c.length, s.hit!.local)
                      const pa = pz && !poseIdle(pz) ? pz : null
                      const alpha = lk.opacity * (pa?.alpha ?? 1)
                      const shownChars = pa && pa.reveal < 1 ? visibleChars(tb.content, pa.reveal) : undefined
                      const pcs = pz ? charPoses(tb.anim, charCount(displayText(tb)), s.hit!.local - c.offset, c.length) : null // 逐字动画·汇出同一份
                      const on = sel.includes(c.id)
                      const still = !playing && !s.lane.locked && !aiLocked
                      return (
                        <div key={s.lane.id} className="absolute inset-0 pointer-events-none" data-testid="vedit-tl-text-layer" data-lane-id={s.lane.id} data-show="1" data-pin={pinCss(liveClip(c, s.lane.kind)) ? '1' : '0'} data-follow={c.follow && followAt(tracks, c, now) ? '1' : '0'} style={tsCss(liveClip(c, s.lane.kind)) ? { transform: tsCss(liveClip(c, s.lane.kind))! } : undefined}>
                          <div data-testid="vedit-text" data-clip-id={c.id} data-fancy={tb.fancy ?? ''} data-x={tb.x.toFixed(3)} data-y={tb.y.toFixed(3)} data-size={tb.size.toFixed(3)} title={t('vedit_text_edit_hint')}
                            onPointerDown={onTextDown(s.lane, c, 'move')} onDoubleClick={(e) => { e.stopPropagation(); if (still) setTextEdit({ id: c.id, value: tb.content }) }}
                            className={`absolute whitespace-pre select-none pointer-events-auto ${still || playing ? 'cursor-move' : ''} ${on ? 'outline outline-1 outline-white/80 outline-offset-2' : ''}`}
                            style={{ left: `${tb.x * 100}%`, top: `${tb.y * 100}%`, transform: `translate(-50%, -50%)${pa && (pa.tx || pa.ty) ? ` translate(${pa.tx}em, ${pa.ty}em)` : ''}${lk.rotate + (pa?.rot ?? 0) ? ` rotate(${lk.rotate + (pa?.rot ?? 0)}deg)` : ''}${pa && (pa.sx !== 1 || pa.sy !== 1) ? ` scale(${pa.sx}, ${pa.sy})` : ''}`, fontSize: `${lk.fontScale * 100}cqh`, ...(alpha < 1 ? { opacity: alpha } : {}) }}>
                            {textEdit?.id === c.id ? (
                              /* 字可以多行（人工面板改字框能换行）⇒ 双击改字也用多行框：Enter＝改好·Shift+Enter＝换行 */
                              <textarea autoFocus value={textEdit.value} data-testid="vedit-text-input" aria-label={t('vedit_text_edit_hint')} rows={Math.max(1, textEdit.value.split('\n').length)}
                                onChange={(e) => setTextEdit({ id: c.id, value: e.target.value })} onPointerDown={(e) => e.stopPropagation()}
                                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit() } else if (e.key === 'Escape') setTextEdit(null) }} onBlur={commitTextEdit}
                                className="block bg-black/60 text-white text-center outline-none rounded px-1 resize-none overflow-hidden" style={{ fontSize: '1em', lineHeight: lk.lineHeight, width: `${Math.max(4, ...textEdit.value.split('\n').map((l) => l.length + 2))}em` }} />
                            ) : <VeditFancyText text={displayText(tb)} fancy={lk.style} look={lk} reveal={shownChars !== undefined && shownChars < charCount(displayText(tb)) ? shownChars : undefined} perChar={pcs?.map(charCss)} />}
                            {on && still && textEdit?.id !== c.id && (
                              <span data-testid="vedit-text-resize" onPointerDown={onTextDown(s.lane, c, 'size')} className="absolute -right-2 -bottom-2 w-3 h-3 rounded-sm bg-white border border-neutral-900 cursor-nwse-resize" />
                            )}
                          </div>
                        </div>
                      )
                    }
                    if (s.lane.kind === 'sticker') {
                      // 贴纸轨：这一刻那张贴纸叠在画面上·长边＝画面高×size（cqh）·照原始比例；停着时能拖、拉角改大小
                      const c = s.hit?.clip
                      const it = stickerById(c?.sticker?.sticker)
                      if (!c?.sticker || !it || !s.show || matteLanesAt(tracks, now).has(s.lane.id)) return <div key={s.lane.id} className="hidden" data-testid="vedit-tl-sticker-layer" data-lane-id={s.lane.id} data-show="0" />
                      const sb = stickerDrag?.id === c.id ? stickerDrag.body : c.sticker
                      const box = stickerBox(it, sb.size)
                      const on = sel.includes(c.id)
                      const still = !playing && !s.lane.locked && !aiLocked
                      // 贴纸动画：姿势同汇出（stickerPose·拖着时不叠动画·免得手下那张跑掉）
                      const sp = stickerDrag?.id === c.id ? null : stickerPose(sb, clipAnimPose(c, now))
                      return (
                        <div key={s.lane.id} className="absolute inset-0 pointer-events-none" data-testid="vedit-tl-sticker-layer" data-lane-id={s.lane.id} data-show="1" data-pin={pinCss(liveClip(c, s.lane.kind)) ? '1' : '0'} data-follow={c.follow && followAt(tracks, c, now) ? '1' : '0'} style={tsCss(liveClip(c, s.lane.kind)) ? { transform: tsCss(liveClip(c, s.lane.kind))! } : undefined}>
                          <div data-testid="vedit-sticker" data-clip-id={c.id} data-sticker-id={it.id} data-x={sb.x.toFixed(3)} data-y={sb.y.toFixed(3)} data-size={sb.size.toFixed(3)} title={t('vedit_sticker_edit_hint')}
                            onPointerDown={onStickerDown(s.lane, c, 'move')}
                            className={`absolute select-none ${playing ? 'pointer-events-none' : 'pointer-events-auto'} ${still ? 'cursor-move' : ''} ${on ? 'outline outline-1 outline-white/80 outline-offset-2' : ''}`}
                            style={{ left: `${sb.x * 100}%`, top: `${sb.y * 100}%`, width: `${box.w * 100}cqh`, height: `${box.h * 100}cqh`, transform: sp ? stickerPoseCss(sp) : 'translate(-50%, -50%)', ...(sp && sp.alpha < 1 ? { opacity: sp.alpha } : {}) }}>
                            <img src={stickerSrc(it)} alt="" draggable={false} className="w-full h-full object-contain pointer-events-none" />
                            {on && still && (
                              <span data-testid="vedit-sticker-resize" onPointerDown={onStickerDown(s.lane, c, 'size')} className="absolute -right-2 -bottom-2 w-3 h-3 rounded-sm bg-white border border-neutral-900 cursor-nwse-resize" />
                            )}
                          </div>
                        </div>
                      )
                    }
                    if (s.lane.kind === 'program') {
                      // 程序轨：这一刻那段程序叠在画面上（沙盒 iframe·按片段自己的秒叫 render·剪开的后段接着播）；包不在 ⇒ 角落写一句
                      const c = s.hit?.clip
                      const pg = c?.program
                      if (!c || !pg || !s.show) return <div key={s.lane.id} className="hidden" data-testid="vedit-tl-program-layer" data-lane-id={s.lane.id} data-show="0" />
                      const b = programBundleOf(pg.pkg)
                      const params = progLive?.id === c.id ? { ...pg.params, [progLive.key]: progLive.v } : pg.params
                      return (
                        <div key={s.lane.id} className="absolute inset-0 pointer-events-none" data-testid="vedit-tl-program-layer" data-lane-id={s.lane.id} data-show="1" data-pkg={pg.pkg}>
                          {b ? <VeditProgramFrame key={`${s.lane.id}:${pg.pkg}`} html={b.html} t={programTime(c, s.hit!.local)} params={effectiveParams(b.manifest, params)} clipId={c.id} />
                            : <span className="absolute left-2 top-2 px-1.5 py-0.5 rounded bg-black/60 text-[11px] text-amber-300" data-testid="vedit-program-missing">{t('vedit_prog_missing')}</span>}
                        </div>
                      )
                    }
                    if (s.lane.kind === 'filter') {
                      // 滤镜轨：本身不画东西·底下的画面轨各自套色（filterOverLayer）
                      return <div key={s.lane.id} className="hidden" data-testid="vedit-tl-filter-layer" data-lane-id={s.lane.id} data-show={s.show && s.hit?.clip.filter ? '1' : '0'} data-filter-id={s.show ? s.hit?.clip.filter?.filter ?? '' : ''} />
                    }
                    if (s.lane.kind === 'visual' && (s.hit?.clip.shape || s.hit?.clip.solid || s.hit?.clip.bgfx)) {
                      // 形状／纯色：同汇出 drawVectorClip（VeditVectorCanvas 只是把它画进一张铺满预览的画布）
                      return <div key={s.lane.id} className="absolute inset-0 pointer-events-none" data-testid="vedit-tl-vector-layer" data-lane-id={s.lane.id} data-show={s.show ? '1' : '0'}>{s.show && <VeditVectorCanvas clip={s.hit!.clip} t={now} />}</div>
                    }
                    const m = layerMedia(s)
                    const flt = s.show && m ? filterOverLayer(layers, s.lane.id) : null
                    // 这段身上的特效＋接缝窗内的转场（WebGL·VeditFxCanvas）；滤镜再套在它上面
                    const fxSt = s.show && m?.url ? fxStateAt(s.lane, now) : null
                    const fxEffects = fxSt ? fxSt.effects.map((e) => (fxLive && fxLive.clipId === fxSt.clip.id && fxLive.fx === e.fx ? { ...e, strength: fxLive.strength, amount: (e.strength > 0 ? e.amount / e.strength : 0) * fxLive.strength } : e)) : []
                    const fxOm = fxSt?.trans ? mediaOf(fxSt.trans.other.clip.mediaId) : null
                    const fxOther: FxOther = fxSt?.trans?.head ? { url: '', kind: 'blank', time: 0 } : fxSt?.trans && fxOm?.url ? { url: fxOm.url, kind: fxOm.kind === 'image' ? 'image' : 'video', time: fxOm.kind === 'image' ? 0 : Math.min(Math.max(0, fxSt.trans.other.source), Math.max(0, fxOm.duration - 0.04)) } : null
                    const fltStrength = flt ? (filterLive && layers.some((x) => x.hit?.clip.id === filterLive.id && x.hit?.clip.filter === flt.body) ? filterLive.strength : flt.strength) : 0
                    // 这段的画面属性（位置大小／旋转／混合／不透明度＋动画姿势）·蒙版（SVG 遮罩）·调整（SVG 滤镜·暗角颗粒也在里面·只落在这段自己的画面上）
                    const vc = s.hit ? liveClip(s.hit.clip, s.lane.kind) : null
                    const lk = vc ? lookOf(vc, now) : null // 关键帧照播放头取值
                    const ls0 = vc && lk ? lookStyle(lk, clipAnimPose(vc, now)) : null
                    const pinTf = pinCss(vc) // 四角透视在最外（先照位置／旋转摆好再整层投影·同汇出）
                    const ls = ls0 && pinTf ? { ...ls0, transform: ls0.transform === 'none' ? pinTf : `${pinTf} ${ls0.transform}` } : ls0
                    // 素材在这层里占的那块（暗角、蒙版对着它画）：读元素排好的框（offset·不受这层的变形影响）；还没排好 ⇒ 照比例算；都没有 ⇒ 当整层
                    const frEl = lk && (lk.mask || lk.adj.vignette || lk.crop || lk.corner || lk.border || lk.mblur) ? (m?.kind === 'image' ? imgEls.current.get(s.lane.id) : laneEls.current.get(s.lane.id) as HTMLVideoElement | undefined) : undefined
                    const frBox = frEl?.offsetParent instanceof HTMLElement && frEl.offsetWidth > 0 && frEl.offsetParent.clientWidth > 0
                      ? { x: frEl.offsetLeft / frEl.offsetParent.clientWidth, y: frEl.offsetTop / frEl.offsetParent.clientHeight, w: frEl.offsetWidth / frEl.offsetParent.clientWidth, h: frEl.offsetHeight / frEl.offsetParent.clientHeight } : null
                    const fr = frBox ?? frameIn(stageRatio ?? 16 / 9, frEl ? (frEl instanceof HTMLImageElement ? frEl.naturalWidth / frEl.naturalHeight : frEl.videoWidth / frEl.videoHeight) : null)
                    const adjBody = lk ? adjustFilterBody(lk.adj, fr) : ''
                    const adjId = vc && adjBody ? `vedit-adj-${vc.id.replace(/[^A-Za-z0-9_-]/g, '')}` : null
                    const mUrl = lk?.masks.length ? masksUrl(lk.masks, lk.maskOp, stageRatio ?? 16 / 9, fr) : null // 多蒙版（同汇出 masksSvg）
                    const mtOp = vc && s.show ? matteOpOf(tracks, now, s.lane.id, vc) : undefined // 轨道遮罩（同汇出 drawMatteOps）
                    const mtUrl = mtOp ? matteCssUrl(mtOp, now, tracks, stageRatio ?? 16 / 9) : null
                    const blendOuter = blendHost() === 'outer' && ls && ls.mixBlendMode !== 'normal' ? ls.mixBlendMode : null // 混合挂外框（跟文字层同一叠层）
                    const cropCss = lk?.crop || lk?.corner ? cropClipPath(fr, lk.crop, lk.corner, stageRatio ?? 16 / 9) : null // 裁剪（对着素材那块）·圆角
                    // 调色／抠像＋盖在上面的调节层 ⇒ 一张 3D 查表（同汇出）·WebGL 画布画在原元素上面
                    const grades = lk && vc ? [lookGrade(lk), ...adjustLayersOver(layers, s.lane.id, now)] : []
                    const gradeOn = s.show && !!m?.url && grades.some(gradeActive)
                    const gradeLut = gradeOn ? bakeGradeLut(grades) : null
                    const mbMode = s.show && m?.url && (m.kind === 'video' || m.kind === 'image') ? mblurModeOf(lk?.mblur, m.kind) : null
                    const mbOn = s.show && m?.kind === 'video' && !!m.url && mblurActive(lk?.mblur) && mbMode === 'frames' // 运动模糊·和前几格混（只对影片）
                    // 方向性快门模糊（影片、图片）：样本同汇出 mblurDirSamples·叠法同汇出 drawDirSamples
                    const dirPlan = mbMode === 'dir' && vc && lk?.mblur ? (() => { const c0 = vc, mb0 = lk.mblur, fr0 = fr, lk0 = lk
                      const pose = (tt: number) => lookXform(lookOf(c0, tt), clipAnimPose(c0, tt))
                      return (tn: number) => { const smp = mblurDirSamples(mb0, pose, tn); return smp ? { samples: smp, xf: pose(tn), fr: fr0, crop: lk0.crop, corner: lk0.corner, border: lk0.border } : null } })() : null
                    const ring = lk ? borderRing(fr, lk.crop, lk.corner, lk.border, stageRatio ?? 16 / 9) : null // 描边（同汇出 paintFramed）
                    const glowF = s.show && lk ? glowCss(lk.glow) : null // 外发光（同汇出 glowLayer）
                    return (
                      <Fragment key={s.lane.id}>
                      {/*  背景填充垫在这一层底下·铺满不跟着变形 */}
                      {lk?.bg && s.show && m?.url && <VeditBgFill bg={lk.bg} source={layerSource(s.lane.id)} />}
                      {/*  阴影：外框 drop-shadow（偏移不跟着里面那层的变形转·同汇出）·没阴影也留着这层框（免得开关阴影时影片元素重挂） */}
                      <div className="absolute inset-0 pointer-events-none" data-testid="vedit-tl-shadow" data-on={lk?.shadow ? '1' : '0'} data-matte={mtOp ? mtOp.laneId : ''} data-blend={blendOuter ?? ''} style={{ ...(lk?.shadow && s.show ? { filter: shadowCss(lk.shadow) } : {}), ...(blendOuter ? { mixBlendMode: blendOuter } : {}), ...(mtUrl ? { maskImage: mtUrl, WebkitMaskImage: mtUrl, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' } : {}) }}>
                      {/*  外发光：阴影框里面再一层框（filter 串 drop-shadow·不跟着变形转·同汇出）·没开也留着（免得影片元素重挂） */}
                      <div className="absolute inset-0 pointer-events-none" data-testid="vedit-tl-glow" data-on={glowF ? '1' : '0'} style={glowF ? { filter: glowF } : undefined}>
                      <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${s.show ? '' : 'invisible'}`} data-testid="vedit-tl-layer" data-lane-id={s.lane.id} data-show={s.show ? '1' : '0'}
                        data-look={vc?.look ? '1' : '0'} data-transform={ls?.transform ?? 'none'} data-mask={lk?.mask?.shape ?? ''} data-adj={adjId ? '1' : '0'}
                        style={{ ...(ls && ls.transform !== 'none' ? { transform: ls.transform } : {}), ...(ls && ls.opacity < 1 ? { opacity: ls.opacity } : {}), ...(ls && ls.mixBlendMode !== 'normal' && !blendOuter ? { mixBlendMode: ls.mixBlendMode } : {}),
                          ...(adjId ? { filter: `url(#${adjId})` } : {}), ...(cropCss ? { clipPath: cropCss } : {}), ...(mUrl ? { maskImage: mUrl, WebkitMaskImage: mUrl, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' } : {}) }}>
                        {adjId && <svg width="0" height="0" className="absolute" aria-hidden><filter id={adjId} colorInterpolationFilters="sRGB" primitiveUnits="objectBoundingBox" x="0" y="0" width="1" height="1" dangerouslySetInnerHTML={{ __html: adjBody }} /></svg>}
                        {/* 雲端素材也須以 CORS 載入，調色／抠像才可讀像素；在預捲設定 src 前就帶上。 */}
                        {/* 每段影片自己一个播放器·正在放的那个露出来·接下来那段在后面备好（藏着） */}
                        {T.prerollClips(s.lane.clips, now).filter((c) => mediaOf(c.mediaId)?.kind === 'video').map((c) => (
                          <video key={c.id} ref={clipElRef(c.id)} crossOrigin="anonymous" playsInline preload="auto" data-testid="vedit-tl-video" data-clip-id={c.id} data-active={c.id === s.hit?.clip.id ? '1' : '0'}
                            className={c.id === s.hit?.clip.id && m?.kind === 'video' ? 'max-w-full max-h-full' : 'hidden'} onLoadedMetadata={(e) => notePvAspect(c.mediaId, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
                            style={{ ...fitLayerCss(pvAspect[c.mediaId]), ...(c.id === s.hit?.clip.id && gradeOn ? GRADE_HIDE : {}) }} />
                        ))}
                        {/* 按素材换元素（key）——换 src 时浏览器会挂着上一张直到新图载好·换成新元素则没载好就空着、不冒充 */}
                        {m?.kind === 'image' && !!m.url && <img key={`img:${m.id}`} ref={imgElRef(s.lane.id, m.id)} crossOrigin="anonymous" src={m.url} alt="" decoding="sync" data-testid="vedit-tl-image" className="max-w-full max-h-full object-contain"
                          onLoad={(e) => notePvAspect(m.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} style={{ ...fitLayerCss(pvAspect[m.id]), ...(gradeOn ? GRADE_HIDE : {}) }} />}
                        {gradeLut && <VeditGradeCanvas key={`grade:${s.lane.id}`} source={rawSource(s.lane.id)} lut={gradeLut} lutKey={gradeKey(grades)} canvasRef={gradeCanvasRef(s.lane.id)} />}
                        {mbOn && lk?.mblur && <VeditMotionBlurCanvas key={`mb:${s.lane.id}`} source={gradedSource(s.lane.id)} clock={timelineClock} mb={lk.mblur} canvasRef={mbCanvasRef(s.lane.id)} />}
                        {fxSt && <VeditFxCanvas key={`fx:${s.lane.id}`} source={layerSource(s.lane.id)} effects={fxEffects} trans={fxSt.trans} other={fxOther} t={now} canvasRef={fxCanvasRef(s.lane.id)} />}
                        {flt && <VeditFilterCanvas key={`${s.lane.id}:${m?.id}`} source={layerFxSource(s.lane.id)} params={flt.item.params} strength={fltStrength} filterId={flt.item.id} />}
                        {m && s.show && showNoPicture(m) && noPictureNote(m)}
                        {ring && s.show && <div className="absolute pointer-events-none" data-testid="vedit-tl-border" style={borderCss(ring)} />}
                      </div>
                      {dirPlan && <VeditDirBlurCanvas key={`db:${s.lane.id}`} source={gradedSource(s.lane.id)} clock={timelineClock} plan={dirPlan} transform={pinTf} opacity={ls?.opacity} blend={ls?.mixBlendMode} />}
                      </div>
                      </div>
                      </Fragment>
                    )
                  })}
                  {!topVisual && end === 0 && <span className="relative text-xs text-neutral-600">{t('vedit_no_media')}</span>}
                  {/* 四角透视：选中一段画面片段且开着四角透视 ⇒ 四颗角点可拖（拖着即时看·放手写进一步复原·打过关键帧的在播放头补一颗） */}
                  {/* 运动跟踪：框选中／框好了 ⇒ 画出那个框 */}
                  {pushBox && clipState.kind === 'clip' && <div className="absolute border-2 border-dashed border-fuchsia-400 pointer-events-none z-30" data-testid="vedit-push-box-overlay" style={{ left: `${(pushBox.x - pushBox.w / 2) * 100}%`, top: `${(pushBox.y - pushBox.h / 2) * 100}%`, width: `${pushBox.w * 100}%`, height: `${pushBox.h * 100}%` }} />}
                  {mtBox && (mtSel || (clipState.kind === 'clip' && clipState.media === 'video')) && <div className="absolute border-2 border-dashed border-amber-400 pointer-events-none z-30" data-testid="vedit-mt-box-overlay" style={{ left: `${(mtBox.x - mtBox.w / 2) * 100}%`, top: `${(mtBox.y - mtBox.h / 2) * 100}%`, width: `${mtBox.w * 100}%`, height: `${mtBox.h * 100}%` }} />}
                  {((clipState.kind === 'clip' && clipState.lane === 'visual') || tsSel) && (() => {
                    const ts = !(clipState.kind === 'clip' && clipState.lane === 'visual')
                    const pc = ts ? liveClip(tsSel!.clip, tsSel!.lane.kind) : liveClip((clipState as Extract<typeof clipState, { kind: 'clip' }>).clip, 'visual')
                    const onClipPatch = ts ? onTsPatch : onClipPatchV // 文字／贴纸走 onTsPatch（同一套 look.pin）
                    const pin = lookOf(pc, now).pin
                    if (!pin) return null
                    const fo = ts ? followAt(tracks, pc, now, stageRatioRef.current ?? 16 / 9) : null // 跟着运动跟踪走的那层：角点也照同一个变换画·拖的位移除掉缩放
                    const q = pinQuad(pin).map(([x, y]) => followPoint(fo, x, y))
                    const fk = fo?.k || 1
                    const drag = (i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
                      e.stopPropagation(); e.preventDefault()
                      const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                      const x0 = e.clientX, y0 = e.clientY, bx = pin[`x${i}` as keyof ClipPin], by = pin[`y${i}` as keyof ClipPin]
                      const val = (ev: PointerEvent) => ({ [`x${i}`]: bx + (ev.clientX - x0) / box.width / fk, [`y${i}`]: by + (ev.clientY - y0) / box.height / fk }) as Partial<ClipPin>
                      const mv = (ev: PointerEvent) => onClipPatch({ look: { pin: val(ev) } }, false)
                      const up = (ev: PointerEvent) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onClipPatch({ look: { pin: val(ev) } }, true) }
                      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
                    }
                    return (
                      <div className="absolute inset-0 pointer-events-none z-50" data-testid="vedit-pin-handles">
                        <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden><polygon points={q.map((p) => p.join(',')).join(' ')} fill="none" stroke="#22d3ee" strokeWidth={1} vectorEffect="non-scaling-stroke" /></svg>
                        {q.map(([x, y], i) => (
                          <div key={i} role="slider" aria-label={t(['vedit_ci_pin_tl', 'vedit_ci_pin_tr', 'vedit_ci_pin_br', 'vedit_ci_pin_bl'][i])} data-testid="vedit-pin-handle" data-corner={i} onPointerDown={drag(i)}
                            className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-cyan-400 border border-white pointer-events-auto cursor-move" style={{ left: pinHandlePos(x), top: pinHandlePos(y) }} />
                        ))}
                      </div>
                    )
                  })()}
                  {/* 画面里拖字块／贴纸吸住对齐线 ⇒ 浅蓝辅助线（竖＝gx·横＝gy）·放开就消失 */}
                  {stageGuides?.gx != null && <div className="absolute top-0 bottom-0 w-px -translate-x-1/2 pointer-events-none z-20" style={{ left: `${stageGuides.gx * 100}%`, background: SNAP_LINE_COLOR }} data-testid="vedit-stage-guide" data-axis="x" />}
                  {stageGuides?.gy != null && <div className="absolute left-0 right-0 h-px -translate-y-1/2 pointer-events-none z-20" style={{ top: `${stageGuides.gy * 100}%`, background: SNAP_LINE_COLOR }} data-testid="vedit-stage-guide" data-axis="y" />}
                  {/* 追踪打码：这一刻的打码框（模糊＝背景模糊·像素块预览先用模糊加格线代·汇出才是真像素块·纯色＝填色）·记的时候画跟着滑鼠的框 */}
                  {(() => {
                    const shown = clipLive ? tracks.map((l) => ({ ...l, clips: l.clips.map((c) => liveClip(c, l.kind)) })) : tracks
                    const boxes = mosaicsAt(shown, now)
                    const live = mosaicLive ? [{ id: 'live', clipId: '', x: mosaicLive.x, y: mosaicLive.y, ...mosaicLive.style, mode: 'solid' as const, strength: 50, color: '#22d3ee' }] : []
                    if (!boxes.length && !live.length) return null
                    return (
                      <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden" data-testid="vedit-mosaic-layer">
                        {[...boxes, ...live].map((b, i) => {
                          const radius = b.shape === 'ellipse' ? '50%' : b.shape === 'round' ? `${MOSAIC_ROUND * 100}%` : '0'
                          const box = { left: `${(b.x - b.w / 2) * 100}%`, top: `${(b.y - b.h / 2) * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, borderRadius: radius }
                          if (b.id === 'live') return <div key="live" className="absolute border-2 border-cyan-300 bg-cyan-300/20" style={box} data-testid="vedit-mosaic-live" />
                          const blk = mosaicBlock(b.strength) * 100
                          const st: React.CSSProperties = b.mode === 'solid' ? { ...box, background: b.color }
                            : b.mode === 'blur' ? { ...box, backdropFilter: `blur(${(mosaicBlur(b.strength) * 100).toFixed(2)}cqh)`, WebkitBackdropFilter: `blur(${(mosaicBlur(b.strength) * 100).toFixed(2)}cqh)` }
                              : { ...box, backdropFilter: `blur(${(blk * 0.6).toFixed(2)}cqh)`, WebkitBackdropFilter: `blur(${(blk * 0.6).toFixed(2)}cqh)`, backgroundImage: 'linear-gradient(rgba(0,0,0,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.12) 1px, transparent 1px)', backgroundSize: `${blk.toFixed(2)}cqh ${blk.toFixed(2)}cqh` }
                          return <div key={`${b.clipId}:${b.id}:${i}`} className={`absolute ${b.id === mosaicActive ? 'outline outline-1 outline-cyan-300/70' : ''}`} style={st} data-testid="vedit-mosaic-box" data-mode={b.mode} />
                        })}
                      </div>
                    )
                  })()}
                  {/*  安全区（只是辅助线·不进成片） */}
                  {safeMode !== 'off' && (
                    <div className="absolute inset-0 pointer-events-none z-20" data-testid="vedit-safe-zone" data-mode={safeMode}>
                      {safeRects(safeMode).map((r, i) => (
                        <div key={i} data-kind={r.kind} className={`absolute ${r.kind === 'cover' ? 'bg-black/45' : 'border border-dashed border-amber-300/80'}`} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
                          {r.label && <span className="absolute left-0.5 top-0.5 px-1 rounded bg-black/50 text-[9px] leading-3 text-amber-200">{t(SAFE_LABEL[r.label])}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            ) })()}
            </div>
          </div>
          {/* 看单份影音原素材时·播放器底下一条进度条（点／拖跳秒） */}
          {/* 同一个 VeditScrubBar——看原素材那条照旧；全屏看时间轴也给一条（非全屏底下有轨道时间尺·不重复放） */}
          {sourceMode && current && (current.kind === 'video' || current.kind === 'audio') ? (() => {
            const dur = sourceRef.current?.duration && Number.isFinite(sourceRef.current.duration) ? sourceRef.current.duration : current.duration
            return (
              <div className="shrink-0 px-3 pt-1 border-t border-neutral-800" data-testid="vedit-src-bar-wrap">
                <VeditScrubBar dur={dur} value={srcNow} testid="vedit-src-bar" label={t('vedit_scrub')} valueText={`${fmtTime(srcNow)} / ${fmtTime(dur)}`}
                  getPlaying={() => !!sourceRef.current && !sourceRef.current.paused}
                  onSeek={(s) => { const el = sourceRef.current; if (!el) return; el.currentTime = s; setSrcNow(el.currentTime) }}
                  onPlaying={(p) => { const el = sourceRef.current; if (!el) return; if (p) { if (el.paused) void el.play().catch(() => {}) } else if (!el.paused) el.pause() }} />
              </div>
            )
          })() : isFull && !(sourceMode && current) && (
            <div className="shrink-0 px-3 pt-1 border-t border-neutral-800" data-testid="vedit-full-bar-wrap">
              <VeditScrubBar dur={end} value={now} testid="vedit-full-bar" label={t('vedit_scrub')} valueText={`${fmtTime(now)} / ${fmtTime(end)}`}
                getPlaying={() => playingRef.current}
                onSeek={(s) => seekTimeline(Math.min(end, s))}
                onPlaying={(p) => setPlaying(p && end > 0 && nowRef.current < end)} />
            </div>
          )}
          <div className="h-9 shrink-0 px-3 grid grid-cols-[1fr_auto_1fr] items-center text-[11px] tabular-nums text-neutral-500 border-t border-neutral-800">
            <span data-testid="vedit-time"><span className="text-cyan-400">{fmtTime(sourceMode && current ? srcNow : now)}</span>&nbsp;/&nbsp;{fmtTime(sourceMode && current ? current.duration : end)}</span>
            <div className="flex items-center gap-1">
              <ToolBtn label={t('vedit_tool_frame_prev')} onClick={() => step(-1, T.FRAME)} testid="vedit-frame-prev">⏮</ToolBtn>
              <button type="button" onClick={togglePlay} onMouseDown={(e) => e.preventDefault()} data-testid="vedit-play" data-playing={playing ? '1' : '0'}
                title={t(playing ? 'vedit_tool_pause' : 'vedit_tool_play')} aria-label={t(playing ? 'vedit_tool_pause' : 'vedit_tool_play')}
                className="h-7 w-9 flex items-center justify-center rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-100">{playing ? '❚❚' : '▶'}</button>
              <ToolBtn label={t('vedit_tool_frame_next')} onClick={() => step(1, T.FRAME)} testid="vedit-frame-next">⏭</ToolBtn>
            </div>
            <div className="justify-self-end flex items-center gap-1.5">
              {/* 「快捷键」按钮拿掉·说明搬进左上角「设定」弹窗 */}
              {/* 照剪映：「比例」选单＋「全屏」 */}
              <VeditRatioMenu value={ratioSel} onChange={changeRatio} />
              {/*  安全区（关→电视标准→抖音竖屏→关） */}
              <ToolBtn label={`${t('vedit_safe')}：${t(SAFE_MODE_LABEL[safeMode])}`} onClick={() => setSafeMode(nextSafeMode(safeMode))} testid="vedit-safe-btn" active={safeMode !== 'off'}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4" aria-hidden><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><rect x="5.5" y="6.5" width="9" height="7" strokeDasharray="2 1.5" /></svg>
              </ToolBtn>
              <ToolBtn label={t(isFull ? 'vedit_fullscreen_exit' : 'vedit_fullscreen')} onClick={toggleFull} testid="vedit-fullscreen">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
                  {isFull ? <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" /> : <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" />}
                </svg>
              </ToolBtn>
            </div>
          </div>
        </div>

        <Splitter dir="col" label={t('vedit_resize')} testid="vedit-split-chat" {...splitProps('chat')} />

        {/* 右：AI 对话框（整组搬编辑页那套·区块缩小）；顶栏页签切到「人工」⇒ 盖上人工面板（对话框照样挂着·切回来对话还在） */}
        {/* 整页 select-none（拖轨道不反白）会套进对话框 ⇒ 对话框这块开回 select-text；人工面板（滑杆一堆）照旧不反白 */}
        <div className="relative shrink-0 rounded-md overflow-hidden bg-white select-text" style={{ width: shown.chatW }} data-testid="vedit-chat" data-side={sideTab}>
          {chatPane}
          {sideTab === 'manual' && <div className="absolute inset-0 z-10 select-none"><VeditManualPane host={manualHost} /></div>}
        </div>
      </div>

      <Splitter dir="row" label={t('vedit_resize')} testid="vedit-split-rows" {...splitProps('rows')} />

      {/* 底：多轨道 */}
      <div ref={tracksBoxRef} className="relative flex-1 min-h-0 flex flex-col rounded-md bg-neutral-900 overflow-hidden" data-testid="vedit-tracks" data-ai-locked={aiLocked ? '1' : '0'}>
        <div className="h-9 shrink-0 px-2 flex items-center justify-between border-b border-neutral-800">
          {/* 游标（选择／分割／向左全选／向右全选）｜复原｜重做｜分割｜向左裁剪｜向右裁剪｜删除｜加标记（照剪映·VeditToolbar.tsx） */}
          {/*  罩期：这排改轨道的工具整排点不到（右边缩放照常） */}
          <div inert={aiLocked} className={`flex items-center ${aiLocked ? 'opacity-40' : ''}`} data-testid="vedit-toolbar-wrap">
          <VeditToolbar tool={tool} onTool={pickTool} onSelectSide={selectSideNow} mac={isMac}
            canUndo={!!histRef.current.past.length} onUndo={undo} canRedo={!!histRef.current.future.length} onRedo={redo}
            canSplit={end > 0} onSplit={splitNow} canTrim={trimTargets(tracks, sel, now).length > 0} onTrim={(side) => { trimNow(side) }}
            canDelete={!!sel.length || !!selTrans || selMarker !== null} onDelete={deletePicked} onMarker={markerNow}
            ops={{ canFreeze: !!freezeTarget(tracks, sel, now), onFreeze: () => freezeNow(), canReverse: sel.some((id) => { const f = T.findClip(tracks, id); return !!f && canReverse(f.lane, f.clip, kindOfMedia(f.clip.mediaId)) }), onReverse: () => reverseNow(),
              canMirror: sel.some((id) => { const f = T.findClip(tracks, id); return !!f && f.lane.kind === 'visual' && !f.lane.locked && !!f.clip.mediaId }), onMirror: () => mirrorNow(), onSolid: (k) => { void solidNow(k) }, onAdjust: adjustLayerNow }} />
          </div>
          {tool === 'blade' && <BladeCursorStyle />}
          <div className="flex items-center gap-1">
            {/* （照剪映时间轴右上：左＝主轨磁吸、右＝自动吸附）·开着＝青色底 */}
            <TlToggle on={tlPrefs.magnet} onClick={toggleMagnet} label={t('vedit_magnet')} hint={t('vedit_magnet_hint')} state={t(tlPrefs.magnet ? 'vedit_switch_on' : 'vedit_switch_off')} testid="vedit-magnet">
              <path d="M2.5 6.5h4v7h-4z" fill="currentColor" /><path d="M17.5 10H9.5M12.5 7l-3 3 3 3" />
            </TlToggle>
            <TlToggle on={tlPrefs.snap} onClick={toggleSnap} label={t('vedit_snap')} hint={t('vedit_snap_hint')} state={t(tlPrefs.snap ? 'vedit_switch_on' : 'vedit_switch_off')} testid="vedit-snap">
              <path d="M5.5 7.5h9v5h-9z" /><path d="M10 3v14M3 4l2 2M17 4l-2 2M3 16l2-2M17 16l-2-2" />
            </TlToggle>
            <div className="mx-1 h-4 w-px bg-neutral-700" aria-hidden />
            <ToolBtn label={t('vedit_tool_zoom_out')} onClick={() => setPxPerSec((p) => T.zoomBy(p, 0.8, zoomFloor))} testid="vedit-zoom-out">－</ToolBtn>
            {/* 拉杆按对数走：拉到最左＝看得到整段 */}
            <input type="range" min={Math.log(zoomFloor)} max={Math.log(T.ZOOM_MAX)} step="any" value={Math.log(Math.max(zoomFloor, pxPerSec))}
              onChange={(e) => setPxPerSec(T.zoomBy(Math.exp(Number(e.target.value)), 1, zoomFloor))} className="w-28 accent-cyan-500" aria-label={t('vedit_tool_zoom_in')} data-testid="vedit-zoom" />
            <ToolBtn label={t('vedit_tool_zoom_in')} onClick={() => setPxPerSec((p) => T.zoomBy(p, 1.25, zoomFloor))} testid="vedit-zoom-in">＋</ToolBtn>
            <ToolBtn label={t('vedit_zoom_fit')} onClick={() => { setPxPerSec(T.zoomFit(end, viewW)); if (scrollRef.current) scrollRef.current.scrollLeft = 0 }} disabled={end <= 0} testid="vedit-zoom-fit">⤢</ToolBtn>
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" data-testid="vedit-tl-scroll">
          <div ref={canvasRef} style={{ width: totalSec * pxPerSec + LABEL_W, minWidth: '100%' }} className="relative min-h-full flex flex-col" data-testid="vedit-tl-canvas" data-seconds={totalSec}>
            {/* 时间尺：按下／拖动 ⇒ 播放头跟着走 */}
            <div className="sticky top-0 z-20 h-6 shrink-0 flex bg-neutral-900 border-b border-neutral-800">
              <div className="shrink-0 sticky left-0 z-10 bg-neutral-900" style={{ width: LABEL_W }} />
              <div ref={rulerRef} className="relative flex-1 cursor-pointer" data-testid="vedit-ruler"
                onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); rulerDrag.current = true; seekAtX(e.clientX) }}
                onPointerMove={(e) => { if (rulerDrag.current) seekAtX(e.clientX) }}
                onPointerUp={(e) => { rulerDrag.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已放 */ } }}
                onPointerCancel={() => { rulerDrag.current = false }}>
                {rulerTicks}
                {/* 标记＝时间尺上的小旗——点一下跳过去并选中（Delete 删）·右键直接删 */}
                {markers.map((m) => (
                  <div key={m} role="button" tabIndex={-1} data-testid="vedit-marker" data-time={m.toFixed(3)} data-picked={selMarker === m ? '1' : '0'}
                    title={t('vedit_marker_tip').replace('{t}', fmtTime(m))} style={{ left: m * pxPerSec - 5 }}
                    onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); seekTimeline(m); setSelMarker(m); setSel([]); setSelTrans(null) }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); runCmd([{ command: 'marker.remove', params: { at: m } }]) }}
                    className={`absolute top-0 z-[1] w-[11px] h-3.5 cursor-pointer [clip-path:polygon(0_0,100%_0,100%_65%,50%_100%,0_65%)] ${selMarker === m ? 'bg-amber-300' : 'bg-sky-400 hover:bg-sky-300'}`} />
                ))}
              </div>
            </div>
            {/* 轨道区：上半格（画面／文字轨·由下往上长）＋下半格（音频轨·由上往下长）；
                分界改成「上区｜音频区」——主轨在上区里、跟别的上区轨一样能上下拖（不再固定在正中）；
                上下两片空白也收拖放（拖到最上／最下＝新增一条）；拖着时「即将占位」处画灰底 */}
            <div className="flex-1 flex flex-col" onDragOver={onLanesDragOver} onDragLeave={onLanesDragLeave} onDrop={(e) => { void onLanesDrop(e) }} data-testid="vedit-lanes"
              onPointerDown={onLanesPointerDown} onPointerMove={onLanesPointerMove} onPointerUp={onLanesPointerUp} onPointerCancel={onLanesPointerUp} onContextMenu={onLanesMenu}
              onMouseMove={tool === 'blade' ? onBladeHover : undefined} onMouseLeave={onBladeLeave}>
              <div className="flex-1 min-h-[24px] flex flex-col justify-end" data-lane-edge="top" data-testid="vedit-lanes-top">
                {laneRows.slice(0, zoneCut).map(renderRow)}
              </div>
              <div className="flex-1 min-h-[24px] flex flex-col justify-start border-t border-neutral-600" data-lane-edge="bottom" data-testid="vedit-lanes-bottom">
                {laneRows.slice(zoneCut).map(renderRow)}
              </div>
            </div>
            {/* 框选框 */}
            {marquee && <div className="absolute z-20 rounded-sm border border-cyan-300/80 bg-cyan-300/10 pointer-events-none" style={marquee} data-testid="vedit-marquee" />}
            {/* 刀片模式：滑鼠在片段上 ⇒ 这条线标出会切在哪（onBladeHover 直接改位置） */}
            {tool === 'blade' && <div ref={bladeLineRef} className="absolute top-6 bottom-0 z-20 w-px bg-amber-300/90 pointer-events-none" style={{ display: 'none' }} data-testid="vedit-blade-line" />}
            {/* 拖片段／拉两端／拖素材进来吸住对齐线 ⇒ 那条位置画一条贯穿轨道区的浅蓝竖线（盖在播放头上面）·放开或离开就消失 */}
            {snapLine !== null && <div className="absolute top-0 bottom-0 z-[31] w-px pointer-events-none" style={{ left: LABEL_W + snapLine * pxPerSec, background: SNAP_LINE_COLOR, clipPath: T.underHeadClip(LABEL_W + snapLine * pxPerSec, LABEL_W) }} data-testid="vedit-snap-line" data-time={snapLine.toFixed(3)} />}
            {/* 播放头：竖线贯穿时间尺与轨道·整条都能按住左右拖——命中区＝线左右各 4 像素（共 9 像素）·滑鼠移上去出现左右双箭头；
                只占线两旁这一窄条·片段其余部分照样能点选、拖位、拉两端 */}
            <div className="group absolute top-0 bottom-0 z-30 w-[9px] cursor-ew-resize touch-none" style={{ left: LABEL_W + now * pxPerSec - 4, clipPath: T.underHeadClip(LABEL_W + now * pxPerSec - 4, LABEL_W), pointerEvents: dndOn ? 'none' : undefined }}
              onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}
              data-testid="vedit-playhead" data-time={now.toFixed(3)}>
              <div className="absolute top-0 bottom-0 left-1 w-px bg-white group-hover:bg-cyan-300 pointer-events-none" />
              <div className="absolute top-0 -left-px w-[11px] h-3 bg-white group-hover:bg-cyan-300 pointer-events-none [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]" />
            </div>
          </div>
        </div>
        {/* 角色在改这份工程档 ⇒ 轨道区盖玻璃罩（只是一层·看得见、滚得动·挡改靠上面各道闸） */}
        {host.renderAiShield(aiShield)}
      </div>
      </div>
      {webShotOpen && host.webShot && (
        <VeditWebShotDialog host={host.webShot} onClose={() => setWebShotOpen(false)}
          onDone={async (f, truncated) => { setTopTab('media'); await onPick([f]); if (truncated) setNotice(t('vedit_ws_truncated')) }} />
      )}
      {importAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setImportAsk(false)} data-testid="vedit-import-ask">
          <div role="dialog" aria-modal="true" aria-label={t('vedit_import_ask_title')} onClick={(e) => e.stopPropagation()}
            className="w-72 rounded-xl bg-neutral-800 p-4 shadow-xl border border-neutral-700">
            <p className="text-sm text-neutral-100 mb-3">{t('vedit_import_ask_title')}</p>
            <div className="space-y-2">
              <button type="button" data-testid="vedit-import-local" onClick={() => { setImportAsk(false); fileRef.current?.click() }}
                className="w-full px-3 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-left text-sm text-neutral-100">{t('vedit_import_local')}</button>
              <button type="button" data-testid="vedit-import-drive" onClick={() => { setImportAsk(false); setTopTab('media'); setDriveOpen(true); setNotice(t('vedit_import_drive_hint')) }}
                className="w-full px-3 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-left text-sm text-neutral-100">{t('vedit_import_drive')}</button>
            </div>
            <button type="button" onClick={() => setImportAsk(false)} className="mt-3 w-full py-1.5 text-xs text-neutral-400 hover:text-neutral-200">{t('vedit_cancel')}</button>
          </div>
        </div>
      )}
      {mediaMenu && (
        // 素材区对编曲素材点右键 ⇒「合成单一音频」
        <div className="fixed inset-0 z-[60]" onPointerDown={() => setMediaMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMediaMenu(null) }} data-testid="vedit-media-menu-backdrop">
          <div role="menu" onPointerDown={(e) => e.stopPropagation()} data-testid="vedit-media-menu" className="absolute w-48 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl"
            style={{ left: Math.max(4, Math.min(mediaMenu.x, window.innerWidth - 200)), top: Math.max(4, Math.min(mediaMenu.y, window.innerHeight - 50)) }}>
            <button type="button" role="menuitem" onClick={() => { void mixdown(mediaMenu.id) }} onMouseDown={(e) => e.preventDefault()} data-testid="vedit-media-mixdown"
              className="w-full h-7 px-3 text-left text-xs text-neutral-200 hover:bg-neutral-700 hover:text-[#ffffff]">{t('vedit_media_mixdown')}</button>
          </div>
        </div>
      )}
      {menu && (() => {
        // 右键选单：每项右边标快捷键（Mac ⌘／⌥·Windows Ctrl／Alt·没快捷键的不标）；轨道空白处只有「贴上」
        const all = T.clipMenu(tracks, menu.ids, { kindOf: kindOfMedia, canPaste: !!boardRef.current, playhead: now, canGroup: canGroup(tracks, menu.ids), canUngroup: canUngroup(tracks, menu.ids), canPasteAttr: !!attrBoardRef.current })
        // 加進對話要角色对话那一格（游客版没有）
        const items = (menu.ids.length ? all : all.filter((it) => it.act === 'paste')).filter((it) => it.act !== 'add-chat' || !!host.chat)
        const W = 210
        const left = Math.max(4, Math.min(menu.x, window.innerWidth - W - 8))
        const seps = items.filter((it, i) => i > 0 && items[i - 1].group !== it.group).length
        const remoteRows = items.filter((it) => (it.act === 'subclip' || it.act === 'merge') && it.enabled && offloadDevs.length && offloadable(it.act, tracks, menu.ids, kindOfMedia)).length * offloadDevs.length // 「交给某台」多出的行
        const top = Math.max(4, Math.min(menu.y, window.innerHeight - ((items.length + remoteRows) * 28 + seps * 9 + 10) - 8)) // 放不下 ⇒ 往上挪（每项 28·分隔线 9）
        return (
          <div className="fixed inset-0 z-[60]" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} onWheel={() => setMenu(null)} data-testid="vedit-menu-backdrop">
            <div role="menu" aria-label={t('vedit_menu_title')} onPointerDown={(e) => e.stopPropagation()} style={{ left, top, width: W }} data-testid="vedit-clip-menu" data-count={menu.ids.length}
              className="absolute rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl">
              {items.map((it, i) => {
                const key = T.shortcutLabel(it.act, isMac)
                const label = it.on && MENU_LABEL_ON[it.act] ? MENU_LABEL_ON[it.act]! : MENU_LABEL[it.act]
                return (
                  <Fragment key={it.act}>
                    {i > 0 && items[i - 1].group !== it.group && <div className="my-1 h-px bg-neutral-700" />}
                    <button type="button" role="menuitem" disabled={!it.enabled || (it.act === 'stems' && clipStems.busy)} onClick={() => runMenu(it.act, menu.ids)} onMouseDown={(e) => e.preventDefault()}
                      data-testid={`vedit-menu-${it.act}`} data-on={it.on ? '1' : '0'}
                      className="w-full h-7 flex items-center justify-between gap-4 px-3 text-left text-xs text-neutral-200 hover:bg-neutral-700 hover:text-[#ffffff] disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-neutral-200">
                      <span className="truncate">{t(label)}</span>
                      {key && <span className="shrink-0 text-[11px] text-neutral-500 tabular-nums" data-testid="vedit-menu-key">{key}</span>}
                    </button>
                    {/* 有画面的合成子素材／合并 ⇒ 另列「交给某台」（本机那项照旧在上面＝缺省；没有在线别台 ⇒ 不列） */}
                    {(it.act === 'subclip' || it.act === 'merge') && it.enabled && offloadable(it.act, tracks, menu.ids, kindOfMedia) && offloadDevs.map((d) => (
                      <button key={`${it.act}-${d.deviceId}`} type="button" role="menuitem" disabled={subBusy} onClick={() => { void offloadRender(it.act as OffloadAct, menu.ids, d) }} onMouseDown={(e) => e.preventDefault()}
                        data-testid={`vedit-menu-${it.act}-remote`} data-device={d.deviceId}
                        className="w-full h-7 flex items-center px-3 pl-6 text-left text-xs text-neutral-300 hover:bg-neutral-700 hover:text-[#ffffff] disabled:opacity-35 disabled:hover:bg-transparent">
                        <span className="truncate">{t(it.act === 'merge' ? 'vedit_menu_merge_remote' : 'vedit_menu_subclip_remote').replace('{device}', d.label)}</span>
                      </button>
                    ))}
                  </Fragment>
                )
              })}
            </div>
          </div>
        )
      })()}
      {replaceFor && (() => {
        // 替换素材：挑一份换上去·位置长度不变；画面轨上的只列影片／图片·音频轨上的只列有声音的
        const kinds = new Set(replaceFor.map((id) => T.findClip(tracks, id)?.lane.kind).filter(Boolean))
        const list = media.filter((m) => (kinds.has('visual') ? m.kind !== 'audio' : true) && (kinds.has('audio') ? m.kind !== 'image' : true))
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setReplaceFor(null)} data-testid="vedit-replace-ask">
            <div role="dialog" aria-modal="true" aria-label={t('vedit_replace_title')} onClick={(e) => e.stopPropagation()}
              className="w-80 max-h-[70vh] flex flex-col rounded-xl bg-neutral-800 p-4 shadow-xl border border-neutral-700">
              <p className="text-sm text-neutral-100">{t('vedit_replace_title')}</p>
              <p className="mt-1 mb-3 text-[11px] text-neutral-400">{t('vedit_replace_hint')}</p>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                {list.length ? list.map((m) => (
                  <button key={m.id} type="button" onClick={() => replaceWith(m)} data-testid="vedit-replace-item"
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-neutral-700/60 hover:bg-neutral-600 text-left text-xs text-neutral-100">
                    <span className="w-4 shrink-0 text-center text-neutral-400">{m.kind === 'audio' ? '♪' : m.kind === 'image' ? '▣' : '▶'}</span>
                    <span className="flex-1 truncate">{m.name}</span>
                    {m.kind !== 'image' && <span className="shrink-0 text-[10px] text-neutral-400 tabular-nums">{fmtTime(m.duration)}</span>}
                  </button>
                )) : <p className="text-xs text-neutral-500">{t('vedit_replace_none')}</p>}
              </div>
              <button type="button" onClick={() => setReplaceFor(null)} className="mt-3 w-full py-1.5 text-xs text-neutral-400 hover:text-neutral-200">{t('vedit_cancel')}</button>
            </div>
          </div>
        )
      })()}
      <ClipStemsPanel job={clipStems.job} onCancel={clipStems.cancel} />
      {topTab !== 'arrange' && <ClipStemsPanel job={songStems.runner.asClipJob()} onCancel={songStems.runner.cancel} />}
    </div>
  )
}
