/** 长正文任务不主动传输出 token 上限。 */
export function shouldOmitMaxTokens(taskName: string): boolean {
  return taskName === 'chapter-first-draft'
}
