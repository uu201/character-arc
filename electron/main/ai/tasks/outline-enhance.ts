import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, OutlineResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'

const handler: TaskHandler = {
  name: 'outline-enhance',
  outputType: 'json',
  defaultCapabilities: ['settings', 'outline', 'worldview', 'characters', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const currentForm = context.currentForm as Record<string, unknown> | undefined
    const mode = context.mode as string | undefined

    if (mode === 'volume') {
      return {
        system: `${capabilityPreamble.system}\n\n你是小说分卷规划增强助手。用户正在编辑一个分卷信息，请根据已有内容和项目上下文对每个字段进行补充或优化。对于空字段，生成合适的内容；对于已有内容的字段，在保留作者意图的基础上扩展和完善。请只返回 JSON 对象，不要返回 Markdown。必须同时返回 title、wordTarget、summary 三个字段。`,
        user: `${capabilityPreamble.user}\n\n当前表单状态：\n- 分卷标题：${String(currentForm?.title ?? '')}\n- 目标字数：${String(currentForm?.wordTarget ?? '')}\n- 分卷摘要：${String(currentForm?.summary ?? '')}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有分卷：${JSON.stringify(context.volumeTitles ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n\n要求：\n1. title：体现本卷核心主题；若已有则可微调\n2. wordTarget：使用纯数字格式如 "50000"\n3. summary：80-180字概括本卷主线、冲突和情绪走向；若已有则在原文基础上扩展完善\n4. ${writingStyle}\n\n返回格式：{"title":"","wordTarget":"","summary":""}`
      }
    }

    return {
      system: `${capabilityPreamble.system}\n\n你是小说剧情大纲增强助手。用户正在编辑一个大纲节点，请根据已有内容和项目上下文对每个字段进行补充或优化。对于空字段，生成合适的内容；对于已有内容的字段，在保留作者意图的基础上扩展和完善。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n当前表单状态：\n- 节点标题：${String(currentForm?.title ?? '')}\n- 预估字数：${String(currentForm?.wordTarget ?? '')}\n- 核心冲突：${String(currentForm?.conflict ?? '')}\n- 剧情描述：${String(currentForm?.summary ?? '')}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n所属分卷：${String(context.volumeTitle ?? '')}\n分卷摘要：${String(context.volumeSummary ?? '')}\n已有大纲节点：${JSON.stringify(context.outlineTitles ?? [])}\n当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n\n要求：\n1. title：体现与前后节点的承接关系；若已有则可微调\n2. wordTarget：使用纯数字格式如 "3000"\n3. conflict：一句话概括核心冲突；若已有则可优化\n4. summary：80-180字描述剧情推进；若已有则在原文基础上扩展完善\n5. 与分卷目标和已有大纲保持连续\n6. ${writingStyle}\n\n返回格式：{"title":"","wordTarget":"","conflict":"","summary":""}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<OutlineResult>
    return {
      title: parsed.title?.trim() || '',
      wordTarget: parsed.wordTarget?.trim() || '',
      conflict: parsed.conflict?.trim() || '',
      summary: parsed.summary?.trim() || ''
    } as OutlineResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as OutlineResult
    return Boolean(r.title?.trim() && r.summary?.trim())
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const r = result as OutlineResult
    const errors: string[] = []
    if (!r.title?.trim()) errors.push('缺少 title：必须返回分卷或节点标题。')
    if (!r.summary?.trim()) errors.push('缺少 summary：必须返回分卷摘要或剧情描述。')
    return errors.length ? errors : ['结构不完整：title 或 summary 至少需要有效内容。']
  }
}
export default handler
