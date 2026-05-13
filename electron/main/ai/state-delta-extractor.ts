import type { StateDelta } from '../story-state-store'

export interface DeltaExtractionResult {
  delta: StateDelta | null
  chapterContent: string
  warnings: string[]
}

export function extractStateDeltaFromOutput(rawOutput: string): DeltaExtractionResult {
  const warnings: string[] = []

  const { chapterContent, yamlBlock } = splitOutputSections(rawOutput)

  if (!yamlBlock) {
    return { delta: null, chapterContent: chapterContent || rawOutput, warnings: ['未检测到 state_delta YAML 块'] }
  }

  const delta = parseStateDeltaYaml(yamlBlock, warnings)
  return { delta, chapterContent, warnings }
}

function splitOutputSections(raw: string): { chapterContent: string; yamlBlock: string | null } {
  const markers = [
    /^state_delta:\s*$/m,
    /^```ya?ml\s*\n\s*state_delta:/m,
    /\nstate_delta:\s*\n/
  ]

  for (const marker of markers) {
    const match = raw.match(marker)
    if (match && match.index != null) {
      const chapterContent = raw.slice(0, match.index).trim()
      let yamlBlock = raw.slice(match.index).trim()

      if (yamlBlock.startsWith('```')) {
        const endFence = yamlBlock.indexOf('```', 3)
        if (endFence > 0) {
          yamlBlock = yamlBlock.slice(yamlBlock.indexOf('\n') + 1, endFence).trim()
        }
      }

      return { chapterContent, yamlBlock }
    }
  }

  return { chapterContent: raw, yamlBlock: null }
}

function parseStateDeltaYaml(yaml: string, warnings: string[]): StateDelta | null {
  try {
    const delta: StateDelta = {
      characters_updated: [],
      relationships_delta: [],
      foreshadowing_delta: { planted: [], advanced: [], resolved: [] },
      timeline: { story_time_elapsed: '', current_story_date: '', events: [] }
    }

    delta.characters_updated = parseCharactersUpdated(yaml, warnings)
    delta.relationships_delta = parseRelationshipsDelta(yaml, warnings)
    delta.foreshadowing_delta = parseForeshadowingDelta(yaml, warnings)
    delta.timeline = parseTimeline(yaml, warnings)

    const hasContent = delta.characters_updated.length > 0
      || delta.relationships_delta.length > 0
      || delta.foreshadowing_delta.planted.length > 0
      || delta.foreshadowing_delta.advanced.length > 0
      || delta.foreshadowing_delta.resolved.length > 0
      || delta.timeline.events.length > 0

    if (!hasContent) {
      warnings.push('state_delta 解析结果为空，可能格式不符合预期')
      return null
    }

    return delta
  } catch (e) {
    warnings.push(`state_delta 解析失败: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

function parseCharactersUpdated(yaml: string, _warnings: string[]): StateDelta['characters_updated'] {
  const results: StateDelta['characters_updated'] = []
  const charBlockRegex = /- character_id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n- character_id:|\nrelationships_delta:|\nforeshadowing_delta:|\ntimeline:|\n[a-z]|$)/g

  let match: RegExpExecArray | null
  while ((match = charBlockRegex.exec(yaml)) !== null) {
    const charId = match[1].trim()
    const block = match[2]

    const changes: StateDelta['characters_updated'][0]['changes'] = {}

    const locationTo = extractValue(block, 'to')
    const locationFrom = extractValue(block, 'from')
    if (locationTo) {
      changes.location = { from: locationFrom || '', to: locationTo }
    }

    const physicalState = extractValue(block, 'physical_state')
    if (physicalState) changes.physical_state = physicalState

    const mentalState = extractValue(block, 'mental_state')
    if (mentalState) changes.mental_state = mentalState

    const arcProgression = extractValue(block, 'arc_progression')
    if (arcProgression) changes.arc_progression = arcProgression

    const powerLevel = extractValue(block, 'power_level')
    if (powerLevel) changes.power_level = powerLevel

    const added = extractList(block, 'added')
    const removed = extractList(block, 'removed')
    if (added.length || removed.length) {
      changes.inventory_delta = { added, removed }
    }

    const newKnowledge = extractList(block, 'new_knowledge')
    if (newKnowledge.length) changes.new_knowledge = newKnowledge

    const completedGoals = extractList(block, 'completed')
    const addedGoals = extractList(block, 'added')
    if (completedGoals.length || addedGoals.length) {
      changes.goals_update = { completed: completedGoals, added: addedGoals }
    }

    if (Object.keys(changes).length > 0) {
      results.push({ character_id: charId, changes })
    }
  }

  return results
}

function parseRelationshipsDelta(yaml: string, _warnings: string[]): StateDelta['relationships_delta'] {
  const results: StateDelta['relationships_delta'] = []
  const section = extractSection(yaml, 'relationships_delta')
  if (!section) return results

  const relBlockRegex = /- relationship_id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n- relationship_id:|$)/g
  let match: RegExpExecArray | null
  while ((match = relBlockRegex.exec(section)) !== null) {
    const relId = match[1].trim()
    const block = match[2]

    const statusTo = extractValue(block, 'to')
    const statusFrom = extractValue(block, 'from')
    const pivotEvent = extractValue(block, 'pivot_event')
    const tensionPoints = extractList(block, 'new_tension_points')

    results.push({
      relationship_id: relId,
      status_change: statusTo ? { from: statusFrom || '', to: statusTo, pivot_event: pivotEvent || '' } : undefined,
      new_tension_points: tensionPoints.length ? tensionPoints : undefined
    })
  }

  return results
}

function parseForeshadowingDelta(yaml: string, _warnings: string[]): StateDelta['foreshadowing_delta'] {
  const result: StateDelta['foreshadowing_delta'] = { planted: [], advanced: [], resolved: [] }

  const section = extractSection(yaml, 'foreshadowing_delta')
  if (!section) return result

  const plantedSection = extractSection(section, 'planted')
  if (plantedSection) {
    const itemRegex = /- id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n\s*- id:|$)/g
    let match: RegExpExecArray | null
    while ((match = itemRegex.exec(plantedSection)) !== null) {
      result.planted.push({
        id: match[1].trim(),
        type: extractValue(match[2], 'type') || '暗线',
        description: extractValue(match[2], 'description') || '',
        method: extractValue(match[2], 'method') || '',
        payoff_chapter: extractNumber(match[2], 'payoff_chapter')
      })
    }
  }

  const advancedSection = extractSection(section, 'advanced')
  if (advancedSection) {
    const itemRegex = /- id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n\s*- id:|$)/g
    let match: RegExpExecArray | null
    while ((match = itemRegex.exec(advancedSection)) !== null) {
      result.advanced.push({
        id: match[1].trim(),
        clue: extractValue(match[2], 'clue') || '',
        method: extractValue(match[2], 'method') || ''
      })
    }
  }

  const resolvedSection = extractSection(section, 'resolved')
  if (resolvedSection) {
    const itemRegex = /- id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n\s*- id:|$)/g
    let match: RegExpExecArray | null
    while ((match = itemRegex.exec(resolvedSection)) !== null) {
      result.resolved.push({
        id: match[1].trim(),
        method: extractValue(match[2], 'method') || '',
        impact: extractValue(match[2], 'impact') || ''
      })
    }
  }

  return result
}

function parseTimeline(yaml: string, _warnings: string[]): StateDelta['timeline'] {
  const section = extractSection(yaml, 'timeline')
  if (!section) return { story_time_elapsed: '', current_story_date: '', events: [] }

  return {
    story_time_elapsed: extractValue(section, 'story_time_elapsed') || '',
    current_story_date: extractValue(section, 'current_story_date') || '',
    events: extractList(section, 'events'),
    world_state_changes: extractList(section, 'world_state_changes')
  }
}

// ==================== YAML Parsing Helpers ====================

function extractValue(block: string, key: string): string | null {
  const regex = new RegExp(`${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm')
  const match = block.match(regex)
  return match ? match[1].trim() : null
}

function extractNumber(block: string, key: string): number | undefined {
  const val = extractValue(block, key)
  if (!val) return undefined
  const num = parseInt(val, 10)
  return isNaN(num) ? undefined : num
}

function extractList(block: string, key: string): string[] {
  const sectionStart = block.indexOf(`${key}:`)
  if (sectionStart < 0) return []

  const afterKey = block.slice(sectionStart + key.length + 1)

  const inlineMatch = afterKey.match(/^\s*\[([^\]]*)\]/)
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  const items: string[] = []
  const lines = afterKey.split('\n')
  for (const line of lines) {
    const itemMatch = line.match(/^\s*-\s+["']?(.+?)["']?\s*$/)
    if (itemMatch) {
      items.push(itemMatch[1])
    } else if (line.trim() && !line.match(/^\s*-/) && !line.match(/^\s*$/)) {
      break
    }
  }
  return items
}

function extractSection(yaml: string, sectionKey: string): string | null {
  const regex = new RegExp(`^(\\s*)${sectionKey}:\\s*$`, 'm')
  const match = yaml.match(regex)
  if (!match || match.index == null) return null

  const indent = match[1].length
  const startIdx = match.index + match[0].length + 1
  const lines = yaml.slice(startIdx).split('\n')
  const sectionLines: string[] = []

  for (const line of lines) {
    if (line.trim() === '') {
      sectionLines.push(line)
      continue
    }
    const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0
    if (lineIndent <= indent && line.trim()) break
    sectionLines.push(line)
  }

  return sectionLines.join('\n')
}
