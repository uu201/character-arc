import type { SkillUsePolicy } from '../../../shared/assistant-runtime'
import type { SkillDefinition } from './types'
import { isSkillExplicitlyExcluded } from './selection-priority'

/** 自动模式的候选是推荐而非授权名单；启用状态由调用方结合项目配置检查。 */
export function isSkillAllowedByPolicy(
  skill: Pick<SkillDefinition, 'id' | 'name' | 'compatibility'>,
  policy: SkillUsePolicy,
  userPrompt: string
): boolean {
  if (policy.mode === 'off' || skill.compatibility === 'external-only') return false
  if (isSkillExplicitlyExcluded(skill, userPrompt)) return false
  return policy.mode === 'auto' || policy.skillIds.includes(skill.id)
}
