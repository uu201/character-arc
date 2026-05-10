import type { SkillManifest } from './types'

export function parseSkillFrontmatter(content: string): {
  name: string
  version: string
  description: string
  source: string
  manifest: Partial<SkillManifest> | null
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

  const manifest = parseManifestBlock(frontmatter)

  return { name, version, description, source, manifest }
}

function parseManifestBlock(frontmatter: string): Partial<SkillManifest> | null {
  const manifestStart = frontmatter.match(/^manifest:\s*$/m)
  if (!manifestStart) return null

  const startIndex = manifestStart.index! + manifestStart[0].length
  const remaining = frontmatter.slice(startIndex)
  const lines = remaining.split(/\r?\n/)

  const result: Record<string, unknown> = {}
  for (const line of lines) {
    if (line.match(/^[A-Za-z]/) && !line.startsWith(' ')) break

    const match = line.match(/^\s{2}(\w+):\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    const value = stripYamlScalar(rawValue)

    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
    } else if (value) {
      result[key] = isNaN(Number(value)) ? value : Number(value)
    }
  }

  if (Object.keys(result).length === 0) return null

  return {
    category: typeof result.category === 'string' ? result.category as SkillManifest['category'] : undefined,
    tasks: Array.isArray(result.tasks) ? result.tasks as SkillManifest['tasks'] : undefined,
    stages: Array.isArray(result.stages) ? result.stages as SkillManifest['stages'] : undefined,
    triggers: Array.isArray(result.triggers) ? result.triggers : undefined,
    priority: typeof result.priority === 'number' ? result.priority : undefined,
    required: result.required === true || result.required === 'true' ? true : undefined
  } as Partial<SkillManifest>
}

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
