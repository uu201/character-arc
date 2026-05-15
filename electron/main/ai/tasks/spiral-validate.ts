import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult } from '../shared-types'
import type { SpiralValidateResult, SpiralSeedResult, SpiralExpandResult } from '../spiral/types'

const handler: TaskHandler = {
  name: 'spiral-validate',
  outputType: 'json',
  defaultCapabilities: ['settings', 'worldview', 'characters', 'outline'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const seedResult = context.spiralSeedResult as SpiralSeedResult | undefined
    const expandResult = context.spiralExpandResult as SpiralExpandResult | undefined

    const seedBlock = seedResult
      ? `主角：${seedResult.protagonist.name}
核心欲望：${seedResult.protagonist.coreDesire}
核心缺陷：${seedResult.protagonist.coreFlaw}
内在矛盾：${seedResult.protagonist.innerConflict}
故事前提：${seedResult.mainArc.premise}
核心问题：${seedResult.mainArc.centralQuestion}
结局方向：${seedResult.mainArc.endingDirection}
世界规则：${seedResult.worldRules.map((r) => `${r.title}：${r.content}`).join('\n')}`
      : '（无）'

    const expandBlock = expandResult
      ? `配角：${expandResult.supportingCharacters.map((c) => `${c.name}（${c.role}）- 动机：${c.motivation}`).join('\n')}
大纲节拍：${expandResult.outlineBeats.map((b, i) => `${i + 1}. ${b.title} - 冲突：${b.conflict} - 驱动：${b.characterDriven}`).join('\n')}
补充设定：${expandResult.expandedWorldview.map((r) => `${r.title}：${r.content}`).join('\n')}`
      : '（无）'

    return {
      system: `${capabilityPreamble.system}\n\n你是小说项目一致性校验专家。你的任务是检查角色弧线、情节因果链和世界设定之间的一致性，发现缺口并提供修补建议。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n请校验以下小说项目设计的内在一致性。

【核心骨架】
${seedBlock}

【展开内容】
${expandBlock}

校验维度：
1. arcValidation（角色弧线完整性）：主角的欲望→缺陷→矛盾→成长路径是否形成闭环？配角动机是否能持续制造压力？
2. plotCausalChain（情节因果链）：大纲节拍之间是否有因果递进？每个节拍是否由角色选择驱动而非巧合？
3. settingConsistency（设定一致性）：世界规则是否与情节需求矛盾？是否有情节需要但缺失的设定？

4. patches（修补建议）：
   - characterAdjustments：需要调整的角色字段（name、field、before、after）
   - outlineAdjustments：需要调整的大纲字段（title、field、before、after）
   - worldviewAdditions：需要补充的世界设定（type、title、content）

原则：
- 只报告真正的问题，不要为了凑数而挑刺
- patches 只在发现实际缺口时才填写，没问题就留空数组
- 关注"角色动机能否支撑情节推进"这个核心问题

返回格式：{"arcValidation":{"isComplete":true,"gaps":[]},"plotCausalChain":{"isSound":true,"breaks":[]},"settingConsistency":{"isConsistent":true,"contradictions":[]},"patches":{"characterAdjustments":[],"outlineAdjustments":[],"worldviewAdditions":[]}}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<SpiralValidateResult>
    const arcValidation = parsed.arcValidation ?? { isComplete: true, gaps: [] }
    const plotCausalChain = parsed.plotCausalChain ?? { isSound: true, breaks: [] }
    const settingConsistency = parsed.settingConsistency ?? { isConsistent: true, contradictions: [] }
    const patches = parsed.patches ?? {}
    return {
      arcValidation: {
        isComplete: Boolean(arcValidation.isComplete),
        gaps: Array.isArray(arcValidation.gaps) ? arcValidation.gaps.map(String) : []
      },
      plotCausalChain: {
        isSound: Boolean(plotCausalChain.isSound),
        breaks: Array.isArray(plotCausalChain.breaks) ? plotCausalChain.breaks.map(String) : []
      },
      settingConsistency: {
        isConsistent: Boolean(settingConsistency.isConsistent),
        contradictions: Array.isArray(settingConsistency.contradictions) ? settingConsistency.contradictions.map(String) : []
      },
      patches: {
        characterAdjustments: Array.isArray(patches.characterAdjustments)
          ? patches.characterAdjustments.map((a) => ({
              name: String(a.name ?? ''),
              field: String(a.field ?? ''),
              before: String(a.before ?? ''),
              after: String(a.after ?? '')
            }))
          : [],
        outlineAdjustments: Array.isArray(patches.outlineAdjustments)
          ? patches.outlineAdjustments.map((a) => ({
              title: String(a.title ?? ''),
              field: String(a.field ?? ''),
              before: String(a.before ?? ''),
              after: String(a.after ?? '')
            }))
          : [],
        worldviewAdditions: Array.isArray(patches.worldviewAdditions)
          ? patches.worldviewAdditions.map((r) => ({
              type: String(r.type ?? '法则').trim(),
              title: String(r.title ?? '').trim(),
              content: String(r.content ?? '').trim()
            }))
          : []
      }
    } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as unknown as SpiralValidateResult
    return Boolean(r.arcValidation && r.plotCausalChain && r.settingConsistency)
  }
}
export default handler
