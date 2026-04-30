// 解析当前页面 URL 的查询参数，用于判断窗口类型
const query = new URLSearchParams(window.location.search)

// 窗口类型：主窗口或助手窗口
export type CharacterArcWindowKind = 'main' | 'assistant'

// 根据 URL 参数 ?window=assistant 判断当前窗口类型，默认为主窗口
export const characterArcWindowKind: CharacterArcWindowKind =
  query.get('window') === 'assistant' ? 'assistant' : 'main'

// 便捷布尔值，供组件直接判断是否运行在助手窗口中
export const isAssistantWindow = characterArcWindowKind === 'assistant'
