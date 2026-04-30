// 快速持久化延迟（毫秒），用于节流高频操作如输入事件
export const FAST_PERSIST_DELAY_MS = 300
// 实时自动保存的防抖延迟（毫秒），平衡响应速度与性能开销
const LIVE_AUTO_SAVE_DELAY_MS = 800

// 自动保存间隔选项列表，供设置界面下拉选择使用
export const autoSaveOptions = [
  { label: '实时保存', value: 'live' },
  { label: '每 5 分钟', value: '5m' },
  { label: '每 10 分钟', value: '10m' }
] as const

// 根据用户选择的保存间隔字符串，解析为对应的毫秒数
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

// 将保存间隔值转为用户友好的显示标签，未匹配时回退到"每 5 分钟"
export function formatAutoSaveIntervalLabel(interval: string): string {
  const option = autoSaveOptions.find((item) => item.value === interval)
  return option?.label ?? '每 5 分钟'
}

// 判断当前保存间隔是否为实时保存模式
export function isLiveAutoSaveInterval(interval: string): boolean {
  return interval === 'live'
}
