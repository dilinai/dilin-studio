'use client'
// 窄屏判定（直板机宽度以下）：首帧照桌面算，挂上后才量，免得伺服器端与浏览器端画得不一样。

import { useState, useEffect } from 'react'


export interface ResponsiveLayout {
  canvasDisabled: boolean
  isNarrow: boolean
  isMedium: boolean
  ready: boolean
}

function onMqlChange(mql: MediaQueryList, fn: () => void): () => void {
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', fn)
    return () => mql.removeEventListener('change', fn)
  }
  mql.addListener(fn)
  return () => mql.removeListener(fn)
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [canvasDisabled, setCanvasDisabled] = useState(false)
  const [isNarrow, setIsNarrow] = useState(false)
  const [isMedium, setIsMedium] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setReady(true)
      return
    }
    const wideEnough = window.matchMedia('(min-width: 1024px)')
    const narrow = window.matchMedia('(max-width: 767px)')
    const medium = window.matchMedia('(min-width: 768px) and (max-width: 1023px)')
    const compute = () => {
      setCanvasDisabled(!wideEnough.matches)
      setIsNarrow(narrow.matches)
      setIsMedium(medium.matches)
    }
    compute()
    setReady(true)
    const offWide = onMqlChange(wideEnough, compute)
    const offNarrow = onMqlChange(narrow, compute)
    const offMedium = onMqlChange(medium, compute)
    return () => {
      offWide()
      offNarrow()
      offMedium()
    }
  }, [])

  return { canvasDisabled, isNarrow, isMedium, ready }
}
