import type { GlobalAssistantProposalResult } from '../../shared-types'
import type { Tool, ToolHandlerResult } from './types'

/** 累加器：与前端 GlobalAssistantProposal 同形，由 orchestrator 持有并最终挂到 meta。 */
export type SettingProposalDraft = Partial<GlobalAssistantProposalResult> & {
  constraintCreates: GlobalAssistantProposalResult['constraintCreates']
  worldviewCreates: GlobalAssistantProposalResult['worldviewCreates']
  worldviewUpdates: GlobalAssistantProposalResult['worldviewUpdates']
  characterCreates: GlobalAssistantProposalResult['characterCreates']
  characterUpdates: GlobalAssistantProposalResult['characterUpdates']
  outlineCreates: GlobalAssistantProposalResult['outlineCreates']
  outlineUpdates: GlobalAssistantProposalResult['outlineUpdates']
  notes: string[]
}

export function createEmptySettingProposalDraft(): SettingProposalDraft {
  return {
    constraintCreates: [],
    worldviewCreates: [],
    worldviewUpdates: [],
    characterCreates: [],
    characterUpdates: [],
    outlineCreates: [],
    outlineUpdates: [],
    notes: []
  }
}

/** 草稿是否已有任意可落库内容（与 global-assistant-proposal.ts 的 hasProposalContent 一致）。 */
export function settingProposalHasContent(draft: SettingProposalDraft): boolean {
  return Boolean(
    draft.constraintCreates.length ||
    draft.worldviewCreates.length ||
    draft.worldviewUpdates.length ||
    draft.characterCreates.length ||
    draft.characterUpdates.length ||
    draft.outlineCreates.length ||
    draft.outlineUpdates.length ||
    draft.notes.some((item) => String(item).trim())
  )
}

export type SettingProposalToolFactoryOptions = {
  /** orchestrator 持有的可变累加对象，handler 直接 push。 */
  draft: SettingProposalDraft
  /** 单次 loop 全局提案上限，防工具被刷爆。默认 20。 */
  maxItems?: number
  /** 单字段（content/description/summary）字符上限。默认 600。 */
  maxContentChars?: number
}

const DEFAULT_MAX_ITEMS = 20
const DEFAULT_MAX_CONTENT_CHARS = 600
/** 按类软上限，与 global-assistant-proposal.ts 的 normalize slice 对齐。 */
const PER_CATEGORY_LIMIT = {
  constraint: 8,
  worldview: 6,
  character: 6,
  outline: 8
} as const

function ok(content: string): ToolHandlerResult {
  return { content }
}

function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function toKeywords(value: unknown, limit = 12): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
    : []
}

export function createSettingProposalTools(opts: SettingProposalToolFactoryOptions): Tool[] {
  const { draft } = opts
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS
  const maxContent = opts.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS

  function totalItems(): number {
    return (
      draft.constraintCreates.length +
      draft.worldviewCreates.length +
      draft.worldviewUpdates.length +
      draft.characterCreates.length +
      draft.characterUpdates.length +
      draft.outlineCreates.length +
      draft.outlineUpdates.length +
      draft.notes.length
    )
  }

  function guard(categoryCount: number, limit: number): ToolHandlerResult | null {
    if (totalItems() >= maxItems) {
      return err(`已达本次提案上限 ${maxItems} 条。请整合后再提，或直接给出最终回复收尾。`)
    }
    if (categoryCount >= limit) {
      return err(`该类提案本次已达上限 ${limit} 条。请精简后再提。`)
    }
    return null
  }

  function recorded(label: string): ToolHandlerResult {
    return ok([
      `已记录提案：${label}（当前共 ${totalItems()} 条，待用户在 Diff 审阅弹窗确认后写入）。`,
      '继续记录其它需要落库的设定，或直接给出最终自然语言回复结束讨论。'
    ].join('\n'))
  }

  const proposeConstraint: Tool = {
    definition: {
      name: 'propose_constraint',
      description:
        '提议新增一条「项目约束」（后续所有章节必须遵守的红线 / 锚点 / 禁写项）。仅用于真正需要长期约束的硬性设定；普通设定补完请用 propose_worldview。本工具只产出提案，用户在 Diff 弹窗确认后才会写入。',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '约束标题，简短可识别。' },
          content: { type: 'string', description: '约束的完整内容。' },
          scope: { type: 'string', description: '可选。适用范围，默认 project（全局）。' },
          weight: {
            type: 'string',
            description: '可选。约束权重：core（红线）/ important / supporting。默认 core。',
            enum: ['core', 'important', 'supporting']
          },
          locked: { type: 'boolean', description: '可选。是否锁定，默认 true。' },
          reason: { type: 'string', description: '可选。提出该约束的理由。' },
          keywords: { type: 'array', description: '可选。3-8 个关键词。', items: { type: 'string' } }
        },
        required: ['title', 'content']
      }
    },
    async handler(input) {
      const title = str(input.title)
      const content = str(input.content)
      if (!title) return err('参数 title 不能为空')
      if (!content) return err('参数 content 不能为空')
      const blocked = guard(draft.constraintCreates.length, PER_CATEGORY_LIMIT.constraint)
      if (blocked) return blocked

      const weightRaw = str(input.weight)
      draft.constraintCreates.push({
        title,
        content: clamp(content, maxContent),
        scope: str(input.scope) || 'project',
        weight: weightRaw === 'important' || weightRaw === 'supporting' ? weightRaw : 'core',
        locked: input.locked === false ? false : true,
        reason: str(input.reason),
        keywords: toKeywords(input.keywords)
      })
      return recorded(`约束「${title}」`)
    }
  }

  const proposeWorldview: Tool = {
    definition: {
      name: 'propose_worldview',
      description:
        '提议新增或更新一条「世界观设定」条目（地理 / 势力 / 规则 / 历史等）。要更新已有条目时，先用 read_project_data 取到精确标题，填入 match_title 并给出 reason；不确定就别填 match_title（按新增处理）。本工具只产出提案，用户确认后才写入。',
      inputSchema: {
        type: 'object',
        properties: {
          match_title: { type: 'string', description: '可选。要更新的已有世界观条目的精确标题；给出即视为更新，否则为新增。' },
          reason: { type: 'string', description: '更新时必填：说明为何修改该条目。' },
          type: { type: 'string', description: '条目类型（如 地理 / 势力 / 设定规则）。新增时必填。' },
          title: { type: 'string', description: '条目标题。新增时必填。' },
          content: { type: 'string', description: '条目正文。新增时必填。' }
        },
        required: []
      }
    },
    async handler(input) {
      const matchTitle = str(input.match_title)
      const type = str(input.type)
      const title = str(input.title)
      const content = clamp(str(input.content), maxContent)

      if (matchTitle) {
        const reason = str(input.reason)
        if (!reason) return err('更新世界观需要提供 reason')
        if (!type && !title && !content) return err('更新世界观需至少提供 type / title / content 之一')
        const blocked = guard(draft.worldviewUpdates.length, PER_CATEGORY_LIMIT.worldview)
        if (blocked) return blocked
        draft.worldviewUpdates.push({
          matchTitle,
          reason,
          type: type || undefined,
          title: title || undefined,
          content: content || undefined
        })
        return recorded(`更新世界观「${matchTitle}」`)
      }

      if (!type || !title || !content) return err('新增世界观需要 type、title、content 三者齐全')
      const blocked = guard(draft.worldviewCreates.length, PER_CATEGORY_LIMIT.worldview)
      if (blocked) return blocked
      draft.worldviewCreates.push({ type, title, content })
      return recorded(`新增世界观「${title}」`)
    }
  }

  const proposeCharacter: Tool = {
    definition: {
      name: 'propose_character',
      description:
        '提议新增或更新一个「角色图鉴」条目。要更新已有角色时，先用 read_project_data 取到精确姓名，填入 match_name 并给出 reason；不确定就别填 match_name（按新增处理）。本工具只产出提案，用户确认后才写入。',
      inputSchema: {
        type: 'object',
        properties: {
          match_name: { type: 'string', description: '可选。要更新的已有角色的精确姓名；给出即视为更新，否则为新增。' },
          reason: { type: 'string', description: '更新时必填：说明为何修改该角色。' },
          name: { type: 'string', description: '角色姓名。新增时必填。' },
          role: { type: 'string', description: '角色定位（如 主角 / 反派 / 配角）。' },
          description: { type: 'string', description: '角色设定描述。新增时必填。' },
          tags: { type: 'array', description: '可选。角色标签，如 性格 / 阵营。', items: { type: 'string' } }
        },
        required: []
      }
    },
    async handler(input) {
      const matchName = str(input.match_name)
      const name = str(input.name)
      const role = str(input.role)
      const description = clamp(str(input.description), maxContent)
      const tags = toKeywords(input.tags, 8)

      if (matchName) {
        const reason = str(input.reason)
        if (!reason) return err('更新角色需要提供 reason')
        if (!name && !role && !description && tags.length === 0) {
          return err('更新角色需至少提供 name / role / description / tags 之一')
        }
        const blocked = guard(draft.characterUpdates.length, PER_CATEGORY_LIMIT.character)
        if (blocked) return blocked
        draft.characterUpdates.push({
          matchName,
          reason,
          name: name || undefined,
          role: role || undefined,
          description: description || undefined,
          tags: tags.length ? tags : undefined
        })
        return recorded(`更新角色「${matchName}」`)
      }

      if (!name || !description) return err('新增角色需要 name 和 description')
      const blocked = guard(draft.characterCreates.length, PER_CATEGORY_LIMIT.character)
      if (blocked) return blocked
      draft.characterCreates.push({ name, role, description, tags })
      return recorded(`新增角色「${name}」`)
    }
  }

  const proposeOutline: Tool = {
    definition: {
      name: 'propose_outline',
      description:
        '提议新增或更新一个「大纲 / 剧情」条目（章节节点或剧情段落）。要更新已有条目时，先用 read_project_data 取到精确标题，填入 match_title 并给出 reason；不确定就别填 match_title（按新增处理）。本工具只产出提案，用户确认后才写入。',
      inputSchema: {
        type: 'object',
        properties: {
          match_title: { type: 'string', description: '可选。要更新的已有大纲条目的精确标题；给出即视为更新，否则为新增。' },
          reason: { type: 'string', description: '更新时必填：说明为何修改该条目。' },
          title: { type: 'string', description: '大纲条目标题。新增时必填。' },
          word_target: { type: 'string', description: '可选。目标字数。' },
          conflict: { type: 'string', description: '可选。核心冲突。' },
          summary: { type: 'string', description: '剧情梗概。新增时必填。' }
        },
        required: []
      }
    },
    async handler(input) {
      const matchTitle = str(input.match_title)
      const title = str(input.title)
      const wordTarget = str(input.word_target)
      const conflict = clamp(str(input.conflict), maxContent)
      const summary = clamp(str(input.summary), maxContent)

      if (matchTitle) {
        const reason = str(input.reason)
        if (!reason) return err('更新大纲需要提供 reason')
        if (!title && !wordTarget && !conflict && !summary) {
          return err('更新大纲需至少提供 title / word_target / conflict / summary 之一')
        }
        const blocked = guard(draft.outlineUpdates.length, PER_CATEGORY_LIMIT.outline)
        if (blocked) return blocked
        draft.outlineUpdates.push({
          matchTitle,
          reason,
          title: title || undefined,
          wordTarget: wordTarget || undefined,
          conflict: conflict || undefined,
          summary: summary || undefined
        })
        return recorded(`更新大纲「${matchTitle}」`)
      }

      if (!title || !summary) return err('新增大纲需要 title 和 summary')
      const blocked = guard(draft.outlineCreates.length, PER_CATEGORY_LIMIT.outline)
      if (blocked) return blocked
      draft.outlineCreates.push({ title, wordTarget, conflict, summary })
      return recorded(`新增大纲「${title}」`)
    }
  }

  return [proposeConstraint, proposeWorldview, proposeCharacter, proposeOutline]
}
