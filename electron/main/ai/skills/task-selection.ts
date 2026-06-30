import type { AiTaskPayload } from '../shared-types'
import { getAllSkills, getEnabledSkills, refreshRegistry } from './registry'
import { pickSkillsFor } from './matcher'
import type { SkillSelection } from './types'

export type ResolvedTaskSkills = {
  projectId: string
  skills: SkillSelection[]
  usedSkillIds: string[]
}

export async function resolveTaskSkills(task: AiTaskPayload): Promise<ResolvedTaskSkills> {
  const projectId = String(task.context.projectId ?? '').trim()
  await refreshRegistry(projectId || undefined).catch(() => {})

  const skills = await pickSkillsFor(task, resolveSkillEnabledOverrides(task, projectId))
  return {
    projectId,
    skills,
    usedSkillIds: skills.map((skill) => skill.id)
  }
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
      overrideById.set(id, skill.enabled)
    } else {
      // 兼容旧调用方：它们只传"已启用 skill"列表，条目里没有 enabled 字段。
      overrideById.set(id, true)
    }
  }

  const allSkills = getAllSkills(projectId || undefined)
  if (!allSkills.length) {
    return undefined
  }

  return new Map(allSkills.map((skill) => [
    skill.id,
    overrideById.get(skill.id) ?? (hasExplicitEnabledState ? skill.enabled : false)
  ]))
}

export function isSkillEnabledForTask(
  task: AiTaskPayload,
  skillId: string,
  projectId: string
): boolean {
  const overrides = resolveSkillEnabledOverrides(task, projectId)
  if (overrides?.has(skillId)) {
    return overrides.get(skillId) === true
  }
  return getEnabledSkills(projectId || undefined).some((skill) => skill.id === skillId)
}
