export interface SelectionPromptParts {
  selection: string
  instruction: string
}

export function parseSelectionPrompt(content: string): SelectionPromptParts | null {
  const match = content.match(/^\s*【选中内容】\s*\n([\s\S]*?)\n+\s*【用户指令】\s*\n([\s\S]*?)\s*$/)
  if (!match) return null

  const selection = match[1]?.trim() ?? ''
  const instruction = match[2]?.trim() ?? ''
  return selection && instruction ? { selection, instruction } : null
}
