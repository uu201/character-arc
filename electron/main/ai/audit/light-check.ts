import type { StoryStateContext, CharacterState } from '../../story-state-store'
import type { StateDelta } from '../../story-state-store'

export interface LightCheckViolation {
  type: 'location_mismatch' | 'item_not_owned' | 'timeline_break' | 'rule_violation' | 'state_conflict'
  severity: 'error' | 'warning'
  message: string
}

export interface LightCheckResult {
  passed: boolean
  violations: LightCheckViolation[]
}

export function runLightCheck(
  chapterContent: string,
  stateBefore: StoryStateContext,
  delta: StateDelta | null
): LightCheckResult {
  const violations: LightCheckViolation[] = []

  if (!delta) {
    return { passed: true, violations }
  }

  checkItemConsistency(chapterContent, stateBefore.characterStates, delta, violations)
  checkLocationConsistency(stateBefore.characterStates, delta, violations)
  checkWorldRuleViolations(chapterContent, stateBefore.worldRules, violations)
  checkStateConflicts(stateBefore.characterStates, delta, violations)

  return {
    passed: violations.filter((v) => v.severity === 'error').length === 0,
    violations
  }
}

function checkItemConsistency(
  content: string,
  characterStates: CharacterState[],
  delta: StateDelta,
  violations: LightCheckViolation[]
): void {
  for (const charUpdate of delta.characters_updated) {
    const removed = charUpdate.changes.inventory_delta?.removed ?? []
    if (!removed.length) continue

    const charState = characterStates.find((c) => c.characterId === charUpdate.character_id)
    if (!charState) continue

    for (const item of removed) {
      if (!charState.inventory.includes(item)) {
        violations.push({
          type: 'item_not_owned',
          severity: 'warning',
          message: `角色「${charUpdate.character_id}」移除了物品「${item}」，但状态库中未记录该物品`
        })
      }
    }
  }
}

function checkLocationConsistency(
  characterStates: CharacterState[],
  delta: StateDelta,
  violations: LightCheckViolation[]
): void {
  for (const charUpdate of delta.characters_updated) {
    const locationChange = charUpdate.changes.location
    if (!locationChange) continue

    const charState = characterStates.find((c) => c.characterId === charUpdate.character_id)
    if (!charState) continue

    if (charState.location && locationChange.from && charState.location !== locationChange.from) {
      violations.push({
        type: 'location_mismatch',
        severity: 'warning',
        message: `角色「${charUpdate.character_id}」位置不一致：状态库记录在「${charState.location}」，但 delta 声称从「${locationChange.from}」移动`
      })
    }
  }
}

function checkWorldRuleViolations(
  content: string,
  worldRules: StoryStateContext['worldRules'],
  violations: LightCheckViolation[]
): void {
  const contentLower = content.toLowerCase()

  for (const rule of worldRules) {
    if (!rule.mustComply) continue

    const ruleKeywords = extractRuleKeywords(rule.ruleContent)
    if (!ruleKeywords.length) continue

    const isNegationRule = rule.ruleContent.includes('不') || rule.ruleContent.includes('禁') || rule.ruleContent.includes('无法')
    if (!isNegationRule) continue

    const matchedKeywords = ruleKeywords.filter((kw) => contentLower.includes(kw.toLowerCase()))

    if (matchedKeywords.length >= 2) {
      violations.push({
        type: 'rule_violation',
        severity: 'warning',
        message: `可能违反世界规则「${rule.ruleContent}」（第${rule.establishedChapter}章确立）— 正文中出现相关关键词`
      })
    }
  }
}

function checkStateConflicts(
  characterStates: CharacterState[],
  delta: StateDelta,
  violations: LightCheckViolation[]
): void {
  for (const charUpdate of delta.characters_updated) {
    const charState = characterStates.find((c) => c.characterId === charUpdate.character_id)
    if (!charState) continue

    if (charState.physicalState.includes('昏迷') || charState.physicalState.includes('死亡')) {
      const hasActiveChanges = charUpdate.changes.goals_update ||
        charUpdate.changes.arc_progression ||
        charUpdate.changes.power_level
      if (hasActiveChanges && !charUpdate.changes.physical_state) {
        violations.push({
          type: 'state_conflict',
          severity: 'warning',
          message: `角色「${charUpdate.character_id}」当前状态为「${charState.physicalState}」，但 delta 报告了主动行为变更且未恢复状态`
        })
      }
    }
  }
}

function extractRuleKeywords(ruleContent: string): string[] {
  return ruleContent
    .replace(/[，。、；：""''（）【】]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 6)
}
