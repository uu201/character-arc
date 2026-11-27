import type { AiTaskPayload } from '../shared-types'
import { normalizeSkillUsePolicy, type SkillUsePolicy } from '../../../shared/assistant-runtime'
import { getAllSkills, getEnabledSkills, refreshRegistry, resolveCanonicalSkillIds } from './registry'
import { pickSkillsFor } from './matcher'
import type { SkillSelection, SkillStageId } from './types'
import { isSkillAllowedByPolicy } from './usage-policy'

export type ResolvedTaskSkills = {
  projectId: string
  skills: SkillSelection[]
  usedSkillIds: string[]
  policy: SkillUsePolicy
}

export async function resolveTaskSkills(task: AiTaskPayload): Promise<ResolvedTaskSkills> {
  const projectId = String(task.context.projectId ?? '').trim()
  await refreshRegistry(projectId || undefined).catch(() => {})

  const rawPolicy = normalizeSkillUsePolicy(task.context.skillPolicy)
  const policy = rawPolicy.mode === 'only'
    ? { ...rawPolicy, skillIds: resolveCanonicalSkillIds(projectId, rawPolicy.skillIds) }
    : rawPolicy
  if (policy.mode === 'off' || (policy.mode === 'only' && policy.skillIds.length === 0)) {
    return { projectId, skills: [], usedSkillIds: [], policy }
  }
  const skills = await pickSkillsFor(task, {
    enabledOverrides: resolveSkillEnabledOverrides(task, projectId),
    stageOverrides: resolveSkillStageOverrides(task, projectId),
    ...(policy.mode === 'only' ? { onlySkillIds: policy.skillIds } : {})
  })
  return {
    projectId,
    skills,
    usedSkillIds: skills.map((skill) => skill.id),
    policy
  }
}

export function resolveSkillStageOverrides(task: AiTaskPayload, projectId = ''): Map<string, SkillStageId[]> | undefined {
  if (!Array.isArray(task.context.projectSkills) || task.context.projectSkills.length === 0) return undefined
  const result = new Map<string, SkillStageId[]>()
  for (const rawSkill of task.context.projectSkills) {
    if (!rawSkill || typeof rawSkill !== 'object') continue
    const skill = rawSkill as { id?: unknown; stageIds?: unknown }
    const id = String(skill.id ?? '').trim()
    if (!id || !Array.isArray(skill.stageIds)) continue
    const canonicalId = resolveCanonicalSkillIds(projectId, [id])[0] ?? id
    result.set(canonicalId, skill.stageIds.filter((stage): stage is SkillStageId => (
      stage === 'reference' || stage === 'premise' || stage === 'setting' || stage === 'outline' || stage === 'draft'
    )))
  }
  return result.size ? result : undefined
}

export function resolveSkillEnabledOverrides(
  task: AiTaskPayload,
  projectId: string
): Map<string, boolean> | undefined {
  if (!Array.isArray(task.context.projectSkills)) {
    return undefined
  }

  const overrideById = new Map<string, boolean>()
  let hasExplicitEnabledState = false
  for (const rawSkill of task.context.projectSkills) {
    if (!rawSkill || typeof rawSkill !== 'object') {
      continue
    }
    const skill = rawSkill as { id?: unknown; enabled?: unknown }
    const id = String(skill.id ?? '').trim()
    if (!id) {
      continue
    }
    if (typeof skill.enabled === 'boolean') {
      hasExplicitEnabledState = true
      const canonicalId = resolveCanonicalSkillIds(projectId, [id])[0] ?? id
      overrideById.set(canonicalId, skill.enabled)
    } else {
      // 兼容旧调用方：它们只传"已启用 skill"列表，条目里没有 enabled 字段。
      const canonicalId = resolveCanonicalSkillIds(projectId, [id])[0] ?? id
      overrideById.set(canonicalId, true)
    }
  }

  const allSkills = getAllSkills(projectId || undefined)
  if (!allSkills.length) {
    return undefined
  }

  return new Map(allSkills.map((skill) => [
    skill.id,
    overrideById.get(skill.id) ?? (hasExplicitEnabledState ? false : skill.enabled)
  ]))
}

export function isSkillEnabledForTask(
  task: AiTaskPayload,
  skillId: string,
  projectId: string
): boolean {
  const policy = normalizeSkillUsePolicy(task.context.skillPolicy)
  if (policy.mode === 'off') return false
  const canonicalSkillId = resolveCanonicalSkillIds(projectId, [skillId])[0] ?? skillId
  const canonicalPolicyIds = policy.mode === 'only'
    ? resolveCanonicalSkillIds(projectId, policy.skillIds)
    : []
  const skill = getAllSkills(projectId || undefined).find((item) => item.id === canonicalSkillId)
  if (!skill || !isSkillAllowedByPolicy(skill, { ...policy, skillIds: canonicalPolicyIds }, String(task.context.userPrompt ?? ''))) return false
  const overrides = resolveSkillEnabledOverrides(task, projectId)
  if (overrides?.has(canonicalSkillId)) {
    return overrides.get(canonicalSkillId) === true
  }
  return getEnabledSkills(projectId || undefined).some((skill) => skill.id === canonicalSkillId)
}
