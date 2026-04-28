export const FAST_PERSIST_DELAY_MS = 300
const LIVE_AUTO_SAVE_DELAY_MS = 800

export const autoSaveOptions = [
  { label: '实时保存', value: 'live' },
  { label: '每 5 分钟', value: '5m' },
  { label: '每 10 分钟', value: '10m' }
] as const

export function resolveAutoSaveDelayMs(interval: string): number {
  switch (interval) {
    case 'live':
      return LIVE_AUTO_SAVE_DELAY_MS
    case '10m':
      return 10 * 60 * 1000
    case '5m':
    default:
      return 5 * 60 * 1000
  }
}

export function formatAutoSaveIntervalLabel(interval: string): string {
  const option = autoSaveOptions.find((item) => item.value === interval)
  return option?.label ?? '每 5 分钟'
}

export function isLiveAutoSaveInterval(interval: string): boolean {
  return interval === 'live'
}
