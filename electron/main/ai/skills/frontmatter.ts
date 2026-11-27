import type { SkillCompatibility, SkillManifest, SkillReferenceRule } from './types'

/** 用户在 frontmatter 中显式覆盖的 skill 属性 */
export type SkillFrontmatterOverrides = {
  compatibility?: SkillCompatibility
  compatibilityNote?: string
  enabled?: boolean
}

/**
 * 解析 SKILL.md 文件头部的 YAML frontmatter
 * @param content - SKILL.md 的完整文本内容
 * @returns 解析后的名称、版本、描述、source、manifest 和覆盖项
 */
export function parseSkillFrontmatter(content: string): {
  name: string
  version: string
  description: string
  source: string
  manifest: Partial<SkillManifest> | null
  overrides: SkillFrontmatterOverrides
} {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const frontmatter = frontmatterMatch?.[1] ?? ''
  const lines = frontmatter.split(/\r?\n/)
  let name = ''
  let version = ''
  let description = ''
  let source = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!fieldMatch) continue

    const [, field, rawValue] = fieldMatch
    const value = stripYamlScalar(rawValue)

    if (field === 'description' && (value === '|' || value === '>')) {
      const block: string[] = []
      index += 1
      while (index < lines.length) {
        const blockLine = lines[index]
        if (blockLine && !/^\s+/.test(blockLine)) {
          index -= 1
          break
        }
        const trimmed = blockLine.trim()
        if (trimmed) block.push(trimmed)
        index += 1
      }
      description = block.join(' ').trim()
      continue
    }

    if (field === 'name') { name = value; continue }
    if (field === 'version') { version = value; continue }
    if (field === 'description') { description = value }
  }

  const sourceMatch = frontmatter.match(/^\s*source:\s*(.+)$/m)
  if (sourceMatch?.[1]) source = stripYamlScalar(sourceMatch[1])

  const { manifest, overrides } = parseManifestBlock(frontmatter)

  return { name, version, description, source, manifest, overrides }
}

/** 解析 frontmatter 中 `manifest:` 缩进块为结构化数据 */
function parseManifestBlock(frontmatter: string): {
  manifest: Partial<SkillManifest> | null
  overrides: SkillFrontmatterOverrides
} {
  const manifestStart = frontmatter.match(/^manifest:\s*$/m)
  if (!manifestStart) return { manifest: null, overrides: {} }

  const startIndex = manifestStart.index! + manifestStart[0].length
  const remaining = frontmatter.slice(startIndex)
  const lines = remaining.split(/\r?\n/)

  const result: Record<string, unknown> = {}
  let currentListKey: string | null = null
  let currentList: string[] | null = null

  const flushList = (): void => {
    if (currentListKey && currentList) result[currentListKey] = currentList
    currentListKey = null
    currentList = null
  }

  for (const line of lines) {
    if (line.match(/^[A-Za-z]/) && !line.startsWith(' ')) break

    const listItemMatch = line.match(/^\s{4,}-\s*(.+)$/)
    if (listItemMatch && currentList) {
      currentList.push(stripYamlScalar(listItemMatch[1]))
      continue
    }

    const match = line.match(/^\s{2}(\w+):\s*(.*)$/)
    if (!match) continue
    flushList()

    const [, key, rawValue] = match
    const value = stripYamlScalar(rawValue)

    if (value === '') {
      currentListKey = key
      currentList = []
      continue
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value.slice(1, -1).split(',').map((s) => stripYamlScalar(s)).filter(Boolean)
    } else if (value === 'true' || value === 'false') {
      result[key] = value === 'true'
    } else {
      result[key] = isNaN(Number(value)) ? value : Number(value)
    }
  }
  flushList()

  const overrides: SkillFrontmatterOverrides = {}
  if (typeof result.compatibility === 'string') overrides.compatibility = result.compatibility as SkillCompatibility
  if (typeof result.compatibilityNote === 'string') overrides.compatibilityNote = result.compatibilityNote
  if (typeof result.enabled === 'boolean') overrides.enabled = result.enabled

  const manifestKeys = ['category', 'tasks', 'stages', 'triggers', 'priority', 'required', 'references']
  const hasManifestField = manifestKeys.some((k) => result[k] !== undefined)
  if (!hasManifestField) return { manifest: null, overrides }

  const manifest: Partial<SkillManifest> = {
    category: typeof result.category === 'string' ? result.category as SkillManifest['category'] : undefined,
    tasks: Array.isArray(result.tasks) ? result.tasks as SkillManifest['tasks'] : undefined,
    stages: Array.isArray(result.stages) ? result.stages as SkillManifest['stages'] : undefined,
    triggers: Array.isArray(result.triggers) ? result.triggers as string[] : undefined,
    priority: typeof result.priority === 'number' ? result.priority : undefined,
    required: result.required === true ? true : undefined,
    references: parseReferenceRules(lines)
  }

  return { manifest, overrides }
}

/** 解析 references 的文件列表及可选任务、章节条件。 */
function parseReferenceRules(lines: string[]): SkillReferenceRule[] | undefined {
  const start = lines.findIndex((line) => /^  references:[ \t]*$/.test(line))
  if (start < 0) return undefined
  const rules: SkillReferenceRule[] = []
  let current: SkillReferenceRule | undefined
  let readingCondition = false
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue
    if (!line.startsWith('    ')) break
    const file = line.match(/^    - file:[ \t]*(.+)$/)
    if (file) {
      current = { file: stripYamlScalar(file[1]) }
      if (current.file) rules.push(current)
      readingCondition = false
      continue
    }
    if (!current) continue
    if (/^      loadWhen:[ \t]*$/.test(line)) {
      readingCondition = true
      continue
    }
    if (!readingCondition) continue
    const condition = line.match(/^        (task|chapterIndexMax):[ \t]*(.+)$/)
    if (!condition) continue
    const value = stripYamlScalar(condition[2])
    if (condition[1] === 'task' && value) {
      current.loadWhen = { ...current.loadWhen, task: value as SkillManifest['tasks'][number] }
    } else if (condition[1] === 'chapterIndexMax' && Number.isInteger(Number(value)) && Number(value) >= 0) {
      current.loadWhen = { ...current.loadWhen, chapterIndexMax: Number(value) }
    }
  }
  return rules
}

/** 去除 YAML 标量值两端的引号并 trim */
function stripYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}
