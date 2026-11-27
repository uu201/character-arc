export type ToolInputSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: ToolInputSchema
}

export type ToolContext = {
  signal: AbortSignal
  projectId: string
}

export type ToolHandlerResult = {
  content: string
  isError?: boolean
  /** 仅技能加载工具返回，用于记录规范 ID、补选回执与后续流程授权。 */
  loadedSkill?: { id: string; name: string }
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolHandlerResult>

export type Tool = {
  definition: ToolDefinition
  handler: ToolHandler
}
