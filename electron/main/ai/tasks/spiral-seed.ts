import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult } from '../shared-types'
import type { SpiralSeedResult } from '../spiral/types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { resolveProjectBootstrapPromptParts } from '../prompts/bootstrap-strategies'

const handler: TaskHandler = {
  name: 'spiral-seed',
  outputType: 'json',
  defaultCapabilities: ['settings', 'worldview', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const { genreLabel, lengthLabel, strategyBlock } = resolveProjectBootstrapPromptParts(context)
    return {
      system: `${capabilityPreamble.system}\n\n你是小说项目核心设计师。你的任务是从故事前提出发，提炼出主角的核心矛盾、故事主线方向和最小世界规则。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n请基于以下信息，为小说项目设计核心骨架。

项目标题：${String(context.projectTitle ?? '')}
项目题材：${genreLabel}
作品长度：${lengthLabel}
小说简介：${String(context.projectPremise ?? '')}

题材与长度策略：
${strategyBlock}

要求：
1. protagonist：设计主角，包含 name（姓名）、coreDesire（核心欲望——他最想要什么）、coreFlaw（核心缺陷——什么性格弱点会阻碍他）、innerConflict（内在矛盾——欲望和缺陷如何互相撕扯）
2. mainArc：故事主线，包含 premise（一句话核心前提）、centralQuestion（故事要回答的核心问题）、endingDirection（结局走向，不需要具体结局，只需方向感）
3. worldRules：2-3条最小世界规则，每条包含 type（地理/法则/物种/势力/历史）、title、content
4. 主角的核心欲望必须能驱动整个故事前进
5. 核心缺陷必须与欲望形成张力——正是这个缺陷让故事有冲突
6. 世界规则只保留直接服务于主角矛盾和主线冲突的设定，不做泛泛扩展
7. ${writingStyle}

返回格式：{"protagonist":{"name":"","coreDesire":"","coreFlaw":"","innerConflict":""},"mainArc":{"premise":"","centralQuestion":"","endingDirection":""},"worldRules":[{"type":"","title":"","content":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<SpiralSeedResult>
    const protagonist = parsed.protagonist ?? {} as any
    const mainArc = parsed.mainArc ?? {} as any
    const worldRules = Array.isArray(parsed.worldRules)
      ? parsed.worldRules.slice(0, 3).map((r) => ({
          type: r.type?.trim() || '法则',
          title: r.title?.trim() || '世界规则',
          content: r.content?.trim() || 'AI 未返回有效内容'
        }))
      : []
    return {
      protagonist: {
        name: protagonist.name?.trim() || '主角',
        coreDesire: protagonist.coreDesire?.trim() || '待设定',
        coreFlaw: protagonist.coreFlaw?.trim() || '待设定',
        innerConflict: protagonist.innerConflict?.trim() || '待设定'
      },
      mainArc: {
        premise: mainArc.premise?.trim() || '待设定',
        centralQuestion: mainArc.centralQuestion?.trim() || '待设定',
        endingDirection: mainArc.endingDirection?.trim() || '待设定'
      },
      worldRules
    } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as unknown as SpiralSeedResult
    return Boolean(
      r.protagonist?.name?.trim() &&
      r.protagonist?.coreDesire?.trim() &&
      r.mainArc?.premise?.trim() &&
      r.worldRules?.length > 0
    )
  }
}
export default handler
