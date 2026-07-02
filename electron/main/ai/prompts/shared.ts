import type { AiTaskKnowledgeContext } from '../shared-types'
import type { SkillSelection } from '../skills/types'

/** 项目级 Skill 上下文条目的标准化结构 */
type ProjectSkillContextEntry = {
  id: string
  name: string
  description: string
  content: string
}

/**
 * 将检索到的知识条目格式化为 prompt 可用的文本块。
 * 按来源分组为"项目记忆"和"参考资料"两部分。
 *
 * @param knowledge 检索到的知识条目数组
 * @returns 格式化后的知识文本，无数据时返回空串
 */
export function formatRetrievedKnowledge(knowledge?: AiTaskKnowledgeContext['usedKnowledge']): string {
  if (!knowledge?.length) return ''

  const projectKnowledge = knowledge.filter((item) => resolveKnowledgeSourceGroupLabel(item.sourceType) === '项目记忆')
  const referenceKnowledge = knowledge.filter((item) => resolveKnowledgeSourceGroupLabel(item.sourceType) === '参考资料')

  return [
    formatSection('项目记忆', projectKnowledge, '以下是当前项目自身的设定/创作记忆/章节摘要，写作时必须保持与之一致，不能矛盾。'),
    formatSection(
      '参考资料',
      referenceKnowledge,
      '以下是从同题材对标作品提炼的拆书结果（风格规则、句式特征、桥段范本）。写作时请**模仿其文笔、节奏、对白处理与桥段功能**，但**不要照搬专有名词**（人名、地名、势力名等都用本项目的设定）。'
    )
  ].filter(Boolean).join('\n\n')
}

/** 根据来源类型判断所属分组：项目记忆或参考资料 */
function resolveKnowledgeSourceGroupLabel(sourceType: string): '项目记忆' | '参考资料' {
  return sourceType === 'workflow-document' || sourceType === 'canon-fact' || sourceType === 'chapter-summary'
    ? '项目记忆'
    : '参考资料'
}

/** 将知识来源类型标识转为中文显示标签 */
function resolveKnowledgeSourceTypeLabel(sourceType: string): string {
  switch (sourceType) {
    case 'canon-fact': return '项目 canon'
    case 'chapter-summary': return '章节摘要'
    case 'workflow-document': return '创作记忆'
    case 'reference-summary': return '拆书总纲'
    case 'reference-chunk':
    default: return '拆书分块/原文'
  }
}

/** 将一组知识条目格式化为带标签和用法说明的文本块 */
function formatSection(label: string, entries: AiTaskKnowledgeContext['usedKnowledge'], usageHint: string): string {
  if (!entries.length) return ''
  return [
    `${label}（${entries.length} 条）：`,
    `用法说明：${usageHint}`,
    '',
    ...entries.slice(0, 5).map((item, index) => [
      `【${label} ${index + 1}】${item.title}`,
      `· 类型：${resolveKnowledgeSourceTypeLabel(item.sourceType)}`,
      `· 来源：${item.sourceLabel}`,
      item.keywords.length ? `· 关键词：${item.keywords.join('、')}` : '',
      '内容：',
      item.snippet
    ].filter(Boolean).join('\n'))
  ].join('\n\n')
}

/**
 * 将已挂载的 skill 内容格式化为 prompt 可用的文本块，最多取前 4 个。
 *
 * @param skills 已选择的 skill 列表
 * @returns 格式化后的 skill 内容字符串，无数据时返回空串
 */
export function formatMountedSkills(skills: SkillSelection[]): string {
  if (!skills.length) return ''

  return skills
    .slice(0, 4)
    .map((skill, index) => {
      // 剥掉 YAML frontmatter（--- ... ---），只保留正文部分给模型看。
      // 这样 2000 字的配额全部用在实际规则和范例上，不被 metadata 占用。
      const bodyContent = stripFrontmatter(skill.content).trim().slice(0, 2000)
      const refs = skill.referenceContents
        .map((ref) => `  [参考: ${ref.file}]\n  ${ref.content.slice(0, 2000)}`)
        .join('\n\n')

      return [
        `Skill ${index + 1}：${skill.name}`,
        `内容摘录：\n${bodyContent}`,
        refs ? `\n相关参考资料：\n${refs}` : ''
      ].filter(Boolean).join('\n')
    })
    .join('\n\n')
}

/**
 * 去掉 SKILL.md 开头的 YAML frontmatter 块（--- ... ---）。
 * 如果没有 frontmatter 就原样返回。
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return content
  return content.slice(match[0].length)
}

/**
 * 将项目级 skill 数据格式化为 prompt 可用的文本块。
 *
 * @param rawSkills 原始 skill 数组数据
 * @param maxSkills 最多取前几个 skill，默认 8
 * @returns 格式化后的 skill 内容字符串，无数据时返回空串
 */
export function formatProjectSkillsContext(rawSkills: unknown, maxSkills = 8): string {
  if (!Array.isArray(rawSkills) || rawSkills.length === 0) {
    return ''
  }

  const skills = rawSkills
    .map((skill) => normalizeProjectSkillContextEntry(skill))
    .filter((skill): skill is ProjectSkillContextEntry => Boolean(skill))
    .slice(0, maxSkills)

  if (!skills.length) {
    return ''
  }

  return skills
    .map((skill, index) => {
      const content = skill.content.trim().slice(0, 2200)
      return [
        `项目 Skill ${index + 1}：${skill.name}`,
        skill.description ? `说明：${skill.description}` : '',
        `内容摘录：\n${content}`
      ].filter(Boolean).join('\n')
    })
    .join('\n\n')
}

/** 将原始数据规范化为 ProjectSkillContextEntry，字段缺失或无效时返回 null */
function normalizeProjectSkillContextEntry(value: unknown): ProjectSkillContextEntry | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const source = value as Partial<ProjectSkillContextEntry>
  const id = String(source.id ?? '').trim()
  const name = String(source.name ?? '').trim()
  const content = String(source.content ?? '').trim()

  if (!id || !name || !content) {
    return null
  }

  return {
    id,
    name,
    description: String(source.description ?? '').trim(),
    content
  }
}

/**
 * 根据项目上下文生成写作风格指令。
 * 优先使用已配置的风格标签和提示词，未配置时给出默认提示。
 *
 * @param context 项目上下文，可包含 writingStyleLabel 和 writingStylePrompt
 * @returns 写作风格指令字符串
 */
export function resolveWritingStyleInstruction(context: Record<string, unknown>): string {
  const label = String(context.writingStyleLabel ?? '').trim()
  const prompt = String(context.writingStylePrompt ?? '').trim()
  if (!label && !prompt) return '若当前项目未指定写作风格，则使用最贴合作品题材的自然表达。'
  if (label && prompt) return `当前项目默认写作风格为"${label}"。请在输出中遵循以下风格要求：${prompt}`
  if (label) return `当前项目默认写作风格为"${label}"，请让输出保持这一风格的一致性。`
  return `请在输出中遵循以下写作风格要求：${prompt}`
}
