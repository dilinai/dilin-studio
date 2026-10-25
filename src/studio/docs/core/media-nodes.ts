// Image / video / audio block nodes for the document editor. Schema and HTML shape are shared; each host
// passes its own React node view (the full editor has upload, signing and transcoding; the guest editor
// reads files from the project's assets/ folder).
//
// Stored markdown lines:
//   ![alt](src)  or  <img src="…" alt="…" width="320">
//   <video src="…" data-display-mode="card|text|preview" data-name="…" data-size="…" data-thumbnail="…" width="…" data-ratio="…" controls></video>
//   <audio src="…" data-display-mode="card|text|preview" data-name="…" data-size="…" controls></audio>
// Video also keeps originalSrc / jobId / transcoding so documents written by the full editor round-trip.

import { Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import Image from '@tiptap/extension-image'
import type { ComponentType } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyView = ComponentType<any>

export type VideoDisplayMode = 'text' | 'card' | 'preview'
export const VIDEO_DISPLAY_MODES: VideoDisplayMode[] = ['text', 'card', 'preview']
export type AudioDisplayMode = 'text' | 'card' | 'preview'
export const AUDIO_DISPLAY_MODES: AudioDisplayMode[] = ['text', 'card', 'preview']

function parseVideoDisplayMode(v: string | null): VideoDisplayMode {
  return v === 'text' || v === 'preview' || v === 'card' ? v : 'card'
}
function parseAudioDisplayMode(v: string | null): AudioDisplayMode {
  return v === 'text' || v === 'preview' || v === 'card' ? v : 'card'
}
function parseSize(el: HTMLElement): number | null {
  const raw = el.getAttribute('data-size')
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function makeVideoBlockNode(View: AnyView): TiptapNode {
  return TiptapNode.create({
    name: 'videoBlock',
    group: 'block',
    atom: true,
    addAttributes() {
      return {
        src:         { default: '', parseHTML: el => el.getAttribute('src') || '' },
        displayMode: { default: 'card' as VideoDisplayMode, parseHTML: el => parseVideoDisplayMode(el.getAttribute('data-display-mode')) },
        name:        { default: '', parseHTML: el => el.getAttribute('data-name') || '' },
        size:        { default: null, parseHTML: el => parseSize(el) },
        thumbnail:   { default: null, parseHTML: el => el.getAttribute('data-thumbnail') || null },
        originalSrc: { default: '', parseHTML: el => el.getAttribute('data-original-src') || el.getAttribute('src') || '' },
        width:       { default: null, parseHTML: el => el.getAttribute('width') ? parseInt(el.getAttribute('width')!) : null },
        ratio:       { default: 16 / 9, parseHTML: el => Number(el.getAttribute('data-ratio')) || 16 / 9 },
        jobId:       { default: null, parseHTML: el => el.getAttribute('data-job-id') || null },
        transcoding: { default: false, parseHTML: el => el.getAttribute('data-transcoding') === 'true' },
      }
    },
    parseHTML() { return [{ tag: 'video[src]' }] },
    renderHTML({ node }) {
      const attrs: Record<string, unknown> = { src: node.attrs.src, controls: true }
      attrs['data-display-mode'] = node.attrs.displayMode || 'card'
      if (node.attrs.name) attrs['data-name'] = node.attrs.name
      if (node.attrs.size != null) attrs['data-size'] = String(node.attrs.size)
      if (node.attrs.thumbnail) attrs['data-thumbnail'] = node.attrs.thumbnail
      if (node.attrs.originalSrc) attrs['data-original-src'] = node.attrs.originalSrc
      if (node.attrs.width) attrs.width = node.attrs.width
      if (node.attrs.ratio) attrs['data-ratio'] = node.attrs.ratio
      if (node.attrs.jobId) attrs['data-job-id'] = node.attrs.jobId
      if (node.attrs.transcoding) attrs['data-transcoding'] = 'true'
      return ['video', mergeAttributes(attrs)]
    },
    addNodeView() { return ReactNodeViewRenderer(View) },
  })
}

export function makeAudioBlockNode(View: AnyView): TiptapNode {
  return TiptapNode.create({
    name: 'audioBlock',
    group: 'block',
    atom: true,
    addAttributes() {
      return {
        src:         { default: '', parseHTML: el => el.getAttribute('src') || '' },
        displayMode: { default: 'card' as AudioDisplayMode, parseHTML: el => parseAudioDisplayMode(el.getAttribute('data-display-mode')) },
        name:        { default: '', parseHTML: el => el.getAttribute('data-name') || '' },
        size:        { default: null, parseHTML: el => parseSize(el) },
      }
    },
    parseHTML() { return [{ tag: 'audio[src]' }] },
    renderHTML({ node }) {
      const attrs: Record<string, unknown> = { src: node.attrs.src, controls: true }
      attrs['data-display-mode'] = node.attrs.displayMode || 'card'
      if (node.attrs.name) attrs['data-name'] = node.attrs.name
      if (node.attrs.size != null) attrs['data-size'] = String(node.attrs.size)
      return ['audio', mergeAttributes(attrs)]
    },
    addNodeView() { return ReactNodeViewRenderer(View) },
  })
}

/** Block image with a persisted `width` (px) attribute. */
export function makeResizableImage(View: AnyView) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        width: { default: null, parseHTML: el => el.getAttribute('width') ? parseInt(el.getAttribute('width')!) : null },
      }
    },
    renderHTML({ node, HTMLAttributes }) {
      const attrs: Record<string, unknown> = { ...HTMLAttributes }
      if (node.attrs.width) attrs.width = node.attrs.width
      return ['img', mergeAttributes(attrs)]
    },
    addNodeView() { return ReactNodeViewRenderer(View) },
  })
}
