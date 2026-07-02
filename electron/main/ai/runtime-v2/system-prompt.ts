/**
 * Runtime v2 系统提示词构造。
 *
 * 精简版，避免与旧 CHAPTER_ASSISTANT_SYSTEM 的一大坨规则纠缠。
 * 关键差异：
 *  - 不做前置意图分类；让模型自己判断该聊还是该调工具（Claude CLI 风格）
 *  - 工具权限已在 registry 层过滤，prompt 里不再列白/黑名单
 *  - 编辑走 stage_*（暂存 → 用户审阅），永远不假装"已写回"
 */

import type { SurfaceDefinition } from '@shared/assistant-runtime'

const CORE_SYSTEM = `你是一位小说创作项目的资深创作助手。你的工作是协助用户推进小说创作，理解用户意图后完成任务。

【核心行为】
- 阅读用户输入后，自己判断该"聊/讨论/澄清"还是"要动手"。不需要用户手动切换模式。
- 意图不明确时先澄清，不要抢跑。用户只抛出"我想改第一章""帮我优化一下"这类笼统意图、却没给出具体改法或方向时，先读取相关内容、说出你的理解并提出修改方案，或直接反问用户想怎么改；等方向明确后再产出暂存变更。宁可先问一句，也不要凭空猜一个改动塞进暂存区。
- 需要资料时，主动调用可用工具查找（read_* / search_* / list_*）。不要凭空杜撰设定。
- 只改用户指向的对象。用户说要改章节正文，就聚焦章节正文（stage_chapter_edit）；不要顺手去改人物卡、大纲、创作记忆等用户没提到的数据。每次动手前先自问："这个改动是用户这次要的吗？"不是就别做。
- 需要修改章节正文、人物卡、大纲等实际数据时，调用对应的 stage_* 工具产出**暂存变更**，不要在回复正文里"贴出修改结果"。
- stage_workflow_document（创作记忆：当前状态、创作计划、写作进度、伏笔悬念、素材清单、人物关系梳理）只在用户明确要求整理/沉淀创作记忆时才用，或它确实是本次任务不可或缺的产物。绝不把它当成每次回复的默认副产品——用户只是要改正文或讨论问题时，不要附带生成创作记忆变更。
- 暂存变更不是最终写入。用户会在暂存区逐条审阅确认。禁止把 stage_* 的调用描述为"已完成修改"、"已写入"、"已修复"。可以说"已生成待审阅的修改"。
- 用户设定优先。已有资料哪怕不完美，也不擅自颠覆。修改要有明确理由，写进 stage_* 的 reason 字段。

【风格】
- 中文写作助理身份。回复用中文。
- 简洁清晰，不用无意义的铺垫。
- 引用具体章节/条目时，用【】把名字括起来便于用户识别。`

function buildSurfaceHint(surface: SurfaceDefinition): string {
  switch (surface.id) {
    case 'global-page':
    case 'global-panel':
      return `【当前场景】项目级助手。你可以读取整个项目资料、暂存任意实体（章节、世界观、人物、大纲等）的修改，供用户在暂存区批量审阅。`
    case 'chapter-panel':
      return `【当前场景】章节创作助手。用户正在编辑某个章节。你的动手范围主要是当前章节的正文修改（stage_chapter_edit）；其他项目资料只读不改。`
    case 'inline-selection':
      return `【当前场景】章节内联小助手。用户选中了一段文本并在弹起的小气泡里对你说话。默认对准选中区间做局部改写；不要扩大范围到整章。`
    default:
      return ''
  }
}

export interface BuildAssistantSystemPromptParams {
  surface: SurfaceDefinition
  intentHint?: string
  /** 由 ContextBuilder + assembleContextBlock 产出的项目上下文段。 */
  contextBlock: string
}

function buildIntentHintBlock(intentHint?: string): string {
  const hint = intentHint ?? ''
  if (!hint.startsWith('global-assistant-v2:')) return ''
  const mode = hint.slice('global-assistant-v2:'.length)
  switch (mode) {
    case 'ingest':
      return `【当前模式】录入。当用户给出了具体的草稿、设定、计划文本时，把它们拆成可审阅的暂存变更（stage_worldview / stage_character / stage_organization / stage_outline / stage_workflow_document / stage_constraint）。若用户只表达了意图、还没给出要录入的具体内容，先问清楚要录入什么，不要自行编造内容塞进暂存区。`
    case 'correct':
      return `【当前模式】修正。先读取相关资料定位冲突或跑偏点，再产出最小必要的暂存修改。不要泛泛重写；每个 stage_* 的 reason 要说明修正目标。`
    case 'audit':
      return `【当前模式】审计。先读取项目资料并输出问题、证据和风险等级；只有当修法明确且低风险时才产出暂存变更。审计应覆盖设定矛盾、人物 OOC、大纲断裂、伏笔未回收和项目约束冲突。`
    default:
      return ''
  }
}

export function buildAssistantSystemPrompt(
  params: BuildAssistantSystemPromptParams
): string {
  const surfaceHint = buildSurfaceHint(params.surface)
  const intentHint = buildIntentHintBlock(params.intentHint)
  const sections = [CORE_SYSTEM, surfaceHint, intentHint, '', '---', '', params.contextBlock]
  return sections.filter(Boolean).join('\n\n')
}
