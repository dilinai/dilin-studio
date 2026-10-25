'use client'
// 等候态占位（转圈＋一句话；失败时换成失败字）。

export function LoadingPlaceholder({ label, failed = false, failedLabel, onRetry, testId = 'loading-placeholder' }: {
  label: string
  failed?: boolean
  failedLabel?: string
  onRetry?: () => void
  testId?: string
}) {
  if (failed) {
    const text = failedLabel ?? label
    return (
      <div data-testid={testId} data-state="failed" aria-live="polite" className="flex w-full flex-1 items-center justify-center py-8">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E5E4] bg-white px-3 py-1 text-[11px] text-gray-500 hover:bg-[#F5EFDC] hover:text-[#4A3528]"
          >
            <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-[#C96442] border-t-transparent" aria-hidden />
            {text}
          </button>
        ) : (
          <span className="text-[11px] text-gray-500">{text}</span>
        )}
      </div>
    )
  }
  return (
    <div data-testid={testId} data-state="loading" aria-live="polite" aria-busy="true" className="flex w-full flex-1 items-center justify-center py-8 pointer-events-none">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E5E4] bg-white px-2.5 py-0.5">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#C96442] border-t-transparent" />
        <span className="text-[11px] text-gray-500">{label}</span>
      </span>
    </div>
  )
}

export default LoadingPlaceholder
