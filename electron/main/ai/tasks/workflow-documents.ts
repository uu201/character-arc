import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, WorkflowDocumentsResult } from '../shared-types'

/** 创作记忆生成任务：为项目当前阶段生成对应的创作记忆内容 */
const handler: TaskHandler = {
  name: 'workflow-documents',
  outputType: 'json',
  defaultCapabilities: ['settings', 'workflow', 'import-export'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input
    const stageId = String(context.stageId ?? 'reference')
    const stageLabel = String(context.stageLabel ?? '选题与参考')
    const requestedDocuments = Array.isArray(context.requestedDocuments) ? JSON.stringify(context.requestedDocuments) : '[]'
    const selectedReferenceWorks = Array.isArray(context.selectedReferenceWorks)
      ? JSON.stringify(context.selectedReferenceWorks)
      : '[]'
    const referenceSelectionMode = String(context.referenceSelectionMode ?? 'auto')
    return {
      system: `${capabilityPreamble.system}\n\n你是小说项目创作记忆整理助手。请只返回 JSON 对象，不要返回 Markdown 代码块，不要解释。只生成本阶段要求的创作记忆字段，字段值必须是 markdown 文本字符串。`,
      user: `${capabilityPreamble.user}\n\n请基于以下项目信息，只为当前阶段生成对应的创作记忆内容。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n项目目标平台：${String(context.projectPlatform ?? '未指定')}\n项目当前阶段 ID：${stageId}\n项目当前阶段：${stageLabel}\n本阶段要求生成的记忆字段：${requestedDocuments}\n本次勾选参考书模式：${referenceSelectionMode === 'manual' ? '用户手动勾选' : '未勾选，允许自动判断'}\n本次参考书输入：${selectedReferenceWorks}\n当前世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n当前角色参考：${JSON.stringify(context.characters ?? [])}\n当前关系参考：${JSON.stringify(context.characterRelationships ?? [])}\n当前大纲参考：${JSON.stringify(context.outlineItems ?? [])}\n当前章节参考：${JSON.stringify(context.chapters ?? [])}\n当前已有创作记忆：${JSON.stringify(context.workflowDocuments ?? [])}\n当前项目启用 skills：\n${skillsBlock || '暂无'}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n1. 只生成 requestedDocuments 里列出的字段\n2. 每个字段都必须贴当前小说项目\n3. 如果用户勾选了参考书，优先基于这些书的拆书结果生成\n4. 如果用户没有勾选参考书，可以综合项目现有资料与已沉淀参考资产自行判断\n5. 如果当前已有创作记忆里已经存在有效内容，要优先延续和整合\n6. 不要输出空壳模板\n\n返回示例：{"task_plan":"","findings":""}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<WorkflowDocumentsResult>
    const n = (value: unknown, fallback: string) => String(value ?? '').trim() || fallback
    return {
      task_plan: n(parsed.task_plan, '# 创作计划\n\n- 待补充。'),
      findings: n(parsed.findings, '# 灵感与发现\n\n- 待补充。'),
      progress: n(parsed.progress, '# 写作进度\n\n- 待补充。'),
      current_status: n(parsed.current_status, '# 项目概况\n\n- 待补充。'),
      novel_setting: n(parsed.novel_setting, '# 世界与设定\n\n- 待补充。'),
      character_relationships: n(parsed.character_relationships, '# 人物关系\n\n- 待补充。'),
      pending_hooks: n(parsed.pending_hooks, '# 伏笔悬念\n\n- 待补充。'),
      resource_ledger: n(parsed.resource_ledger, '# 素材清单\n\n- 待补充。')
    } as WorkflowDocumentsResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as WorkflowDocumentsResult
    return Boolean(r.task_plan?.trim() && r.findings?.trim() && r.progress?.trim() && r.current_status?.trim() && r.novel_setting?.trim() && r.character_relationships?.trim() && r.pending_hooks?.trim() && r.resource_ledger?.trim())
  }
}
export default handler
