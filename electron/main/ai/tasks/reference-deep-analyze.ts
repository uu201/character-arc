import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, ChapterAssistantResult } from '../shared-types'

/**
 * 深度拆书 task。
 *
 * 不像 `reference-style-analysis` 单次产出一份 JSON，本 task 走 agent loop：
 *   1. 模型先用 skill_load("story-long-analyze") 拿拆书方法论
 *   2. 按需 skill_read_reference 拉阶段说明（stage1-golden-chapters.md / stage4-characters-settings.md）
 *   3. 对用户提供的参考小说原文逐维度拆解，每个维度（总纲 / 角色 / 故事线 / 场景）调一次
 *      knowledge_save_document 落库
 *   4. 全部存完后给一句确认文案就结束
 *
 * 不输出 JSON——拆书结果都通过 knowledge_save_document 工具落库；模型最后的 text 仅用作确认。
 * agent/index.ts 会把 collect 到的 AiKnowledgeDocumentDraft[] 挂在 meta.producedKnowledgeDocuments，
 * renderer 接收 ai-run-event 时自动 merge 进 knowledgeDocuments。
 */
const handler: TaskHandler = {
  name: 'reference-deep-analyze',
  outputType: 'text',
  defaultCapabilities: ['settings', 'analysis', 'writing-style', 'project-skills'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input

    const referenceTitle = String(context.referenceTitle ?? '').trim() || '未命名参考作品'
    const referenceGenre = String(context.referenceGenre ?? '').trim() || '未指明'
    const referenceFileName = String(context.referenceFileName ?? '').trim() || ''
    const sourceText = String(context.sourceText ?? '').trim()
    const targetGenre = String(context.projectGenre ?? '').trim() || '未指明'
    const targetTitle = String(context.projectTitle ?? '').trim() || '当前项目'

    return {
      system: `${capabilityPreamble.system}

你是一个**拆书 agent**，工作在 CharacterArc 的"知识中心"管线里。
本次任务：把一本参考小说**深度拆解**为多份结构化知识文档，落库后供后续写作时检索复用。

## 强制工作流程

1. **优先调用** \`skill_load("story-long-analyze")\` 加载拆书方法论。如果返回错误说该 skill 不存在，
   再 fallback 到你自己掌握的网文拆书框架。
2. 按需 \`skill_read_reference("story-long-analyze", "references/stage1-golden-chapters.md")\` 等加载阶段说明。
   不要一次性把所有 reference 都拉下来，只拉你接下来一步要用的。
3. 对当前任务给出的"参考小说原文"逐**维度**拆解。**每完成一个维度立即调用
   \`knowledge_save_document\` 落库**，不要堆到最后才一次性产出。

## 必须产出的维度（每个一份独立 knowledge_save_document）

| 维度 | sourceType | 标题示例 |
|---|---|---|
| 整体拆书总纲（风格 / 视角 / 节奏 / 题材定位 / 卖点） | reference-summary | 《xxx》｜深度拆书总纲 |
| 主角画像（动机 / 弱点 / 成长弧） | reference-chunk | 《xxx》｜主角：xxx |
| 关键配角与反派（每个一份） | reference-chunk | 《xxx》｜配角：xxx |
| 主线故事线骨架 | reference-chunk | 《xxx》｜主线：xxx |
| 关键支线 / 副线（每条一份，可选） | reference-chunk | 《xxx》｜支线：xxx |
| 黄金三章桥段拆解（每章一份） | reference-chunk | 《xxx》｜第一章桥段拆解 |
| 设定 / 世界观（如金手指、力量体系等） | reference-chunk | 《xxx》｜设定：xxx |

每份 content 必须是结构化 markdown，便于后续被 retrieval 拉出来用。
keywords 务必填 3-8 个（人物名、桥段类型、关键设定词等），让检索能命中。

## 关键约束

- **不要照抄原文长段**——拆书是提炼方法论 / 桥段功能 / 角色逻辑，不是搬运。
- 涉及人名 / 地名 / 势力名只在 metadata 里保留，content 主体用"主角"、"反派 A"、"势力 B"等通用代称，
  方便当前项目的写作 agent 复用模式而不照搬专名。
- 如果原文太长一次拆不完，优先拆**总纲 + 黄金三章 + 主角 + 主线**这 4 类，其余维度可省。
- 落库 1 份就**立刻**调用工具落 1 份，不要在脑里凑齐再批量。

## 完成标志

至少落库 4 份知识（总纲必须 + 主角必须 + 主线必须 + 至少 1 章桥段拆解）后，给出一段简短的中文总结
（"已完成《xxx》深度拆解，落库 N 份知识..."）就结束。不要返回 JSON。`,
      user: `${capabilityPreamble.user}

## 当前任务上下文

- 当前项目：${targetTitle}（题材：${targetGenre}）
- 参考作品：${referenceTitle}（题材：${referenceGenre}${referenceFileName ? `，原文件：${referenceFileName}` : ''}）

## 参考小说原文（节选 / 全文）

${sourceText || '（未提供原文文本——请告诉用户需要先提供原文。）'}

## 项目当前启用 skills

${skillsBlock || '（参考 system prompt 顶部的 skill 索引）'}

## 行动指令

按 system prompt 里"强制工作流程"逐步推进，每完成一个维度立即调用 knowledge_save_document 落库。
完成所有维度（或撞到上下文 / token 上限）后给一句确认结束。`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    // 不强制非空——即使 model 没说话，只要工具调用产出了 knowledge 文档就算成功；
    // agent/index.ts 会单独检查 meta.producedKnowledgeDocuments 是否为空。
    return typeof (result as ChapterAssistantResult).content === 'string'
  },
  resolveMaxTokens(): number {
    // 给 agent 多轮工具调用足够预算——每轮一个工具调用 + 一段总结，整个 loop 可能跑 10K+ token
    return 8000
  }
}
export default handler
