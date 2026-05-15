import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult } from '../shared-types'
import type { SpiralExpandResult, SpiralSeedResult } from '../spiral/types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { resolveProjectBootstrapPromptParts } from '../prompts/bootstrap-strategies'

const handler: TaskHandler = {
  name: 'spiral-expand',
  outputType: 'json',
  defaultCapabilities: ['settings', 'worldview', 'characters', 'outline', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const { genreLabel, lengthLabel, strategyBlock } = resolveProjectBootstrapPromptParts(context)
    const seedResult = context.spiralSeedResult as SpiralSeedResult | undefined
    const seedBlock = seedResult
      ? `主角：${seedResult.protagonist.name}
核心欲望：${seedResult.protagonist.coreDesire}
核心缺陷：${seedResult.protagonist.coreFlaw}
内在矛盾：${seedResult.protagonist.innerConflict}
故事前提：${seedResult.mainArc.premise}
核心问题：${seedResult.mainArc.centralQuestion}
结局方向：${seedResult.mainArc.endingDirection}
已有世界规则：${seedResult.worldRules.map((r) => `${r.title}（${r.type}）：${r.content}`).join('\n')}`
      : '（无第一圈结果）'

    return {
      system: `${capabilityPreamble.system}\n\n你是小说项目展开设计师。基于已确定的核心骨架（主角矛盾+主线方向+世界规则），展开配角、大纲节拍和补充设定。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n项目标题：${String(context.projectTitle ?? '')}
项目题材：${genreLabel}
作品长度：${lengthLabel}
小说简介：${String(context.projectPremise ?? '')}

题材与长度策略：
${strategyBlock}

【第一圈已确定的核心骨架】
${seedBlock}

请基于以上核心骨架，展开以下内容：

1. supportingCharacters：2-3个配角，每个包含 name、role（短语定位）、relationToProtagonist（与主角的关系和冲突点）、motivation（自身动机，不能只是服务主角）
2. outlineBeats：3-5个大纲节拍，每个包含 title、conflict（本节拍的核心冲突）、characterDriven（哪个角色的什么选择驱动了这段情节）、summary、wordTarget（"预估 xxxx字"格式）
3. expandedWorldview：1-2条补充世界设定，服务于配角动机或大纲冲突需要

关键原则：
- 配角必须有独立动机，不是主角的工具人
- 每个大纲节拍必须由角色选择驱动，不是外部事件硬推
- 配角的动机要能与主角的欲望/缺陷产生碰撞
- 大纲节拍之间要有因果递进，不是并列罗列
- ${writingStyle}

返回格式：{"supportingCharacters":[{"name":"","role":"","relationToProtagonist":"","motivation":""}],"outlineBeats":[{"title":"","conflict":"","characterDriven":"","summary":"","wordTarget":""}],"expandedWorldview":[{"type":"","title":"","content":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<SpiralExpandResult>
    const supportingCharacters = Array.isArray(parsed.supportingCharacters)
      ? parsed.supportingCharacters.slice(0, 3).map((c) => ({
          name: c.name?.trim() || '配角',
          role: c.role?.trim() || '待设定',
          relationToProtagonist: c.relationToProtagonist?.trim() || '待设定',
          motivation: c.motivation?.trim() || '待设定'
        }))
      : []
    const outlineBeats = Array.isArray(parsed.outlineBeats)
      ? parsed.outlineBeats.slice(0, 5).map((b) => ({
          title: b.title?.trim() || '剧情节拍',
          conflict: b.conflict?.trim() || '待设定',
          characterDriven: b.characterDriven?.trim() || '待设定',
          summary: b.summary?.trim() || '待设定',
          wordTarget: b.wordTarget?.trim() || '预估 3000字'
        }))
      : []
    const expandedWorldview = Array.isArray(parsed.expandedWorldview)
      ? parsed.expandedWorldview.slice(0, 2).map((r) => ({
          type: r.type?.trim() || '法则',
          title: r.title?.trim() || '补充设定',
          content: r.content?.trim() || 'AI 未返回有效内容'
        }))
      : []
    return { supportingCharacters, outlineBeats, expandedWorldview } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as unknown as SpiralExpandResult
    return Boolean(
      r.supportingCharacters?.length > 0 &&
      r.outlineBeats?.length > 0
    )
  }
}
export default handler
