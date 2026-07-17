/** 清理模型把思考过程包在章节正文中的常见标记。 */
export function stripReasoningMarkup(value: string): string {
  return value
    .replace(/<think(?:ing)?[^>]*>[\s\S]*?<\/(?:think|thinking)>/gi, '')
    .replace(/<analysis[^>]*>[\s\S]*?<\/analysis>/gi, '')
    .replace(/\[think(?:ing)?\][\s\S]*?\[\/(?:think|thinking)\]/gi, '')
    .replace(/\[analysis\][\s\S]*?\[\/analysis\]/gi, '')
    .replace(/^\s*(?:思考过程|分析过程|推理过程)\s*[:：]?\s*[\s\S]*?(?=正文|最终答案|章节正文)[:：]?/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
