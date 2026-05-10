import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { join } from 'node:path'
import type { AiTaskPayload } from '../shared-types'
import type { SkillDefinition } from './types'

export async function loadSkillReferences(
  skill: SkillDefinition,
  task: AiTaskPayload
): Promise<Array<{ file: string; content: string }>> {
  const results: Array<{ file: string; content: string }> = []
  const rules = skill.manifest.references

  if (!rules.length) return results

  for (const rule of rules) {
    if (!shouldLoadReference(rule.loadWhen, task)) continue

    const filePath = join(skill.rootDir, rule.file)
    if (!existsSync(filePath)) continue

    try {
      const content = await readFile(filePath, 'utf-8')
      // 上限从 800 提到 3000：写作技巧类参考文件通常 2000-4000 字，
      // 截断太短模型只能看到目录级信息，无法吸收具体范例和规则。
      results.push({ file: rule.file, content: content.slice(0, 3000) })
    } catch {
      // skip unreadable reference files
    }
  }

  return results
}

function shouldLoadReference(
  condition: { task?: string; chapterIndexMax?: number } | undefined,
  task: AiTaskPayload
): boolean {
  if (!condition) return true

  if (condition.task && condition.task !== task.task) return false

  if (typeof condition.chapterIndexMax === 'number') {
    const chapterIndex = Number(task.context.chapterIndex ?? -1)
    if (chapterIndex < 0 || chapterIndex > condition.chapterIndexMax) return false
  }

  return true
}

export async function loadSkillContentAsync(skill: SkillDefinition): Promise<string | null> {
  const filePath = join(skill.rootDir, 'SKILL.md')
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 在 skill 根目录下安全读取一个相对路径文件。
 * 拒绝绝对路径、`..` 逃逸出 skill.rootDir 的路径。
 * 由 agent 的 `skill_read_reference` 工具调用。
 */
export async function loadSkillReferenceFile(
  skill: SkillDefinition,
  relPath: string
): Promise<string> {
  const trimmed = String(relPath ?? '').trim()
  if (!trimmed) {
    throw new Error('relPath 不能为空')
  }
  if (isAbsolute(trimmed)) {
    throw new Error('relPath 必须是相对路径，禁止绝对路径')
  }
  const absoluteTarget = resolve(skill.rootDir, trimmed)
  const rel = relative(skill.rootDir, absoluteTarget)
  if (rel.startsWith('..') || rel.split(sep)[0] === '..' || isAbsolute(rel)) {
    throw new Error(`relPath 越界：${trimmed} 解析后位于 skill 目录之外`)
  }
  return readFile(absoluteTarget, 'utf-8')
}

/**
 * 校验给定相对路径在 skill 根目录之内，返回安全的绝对路径。
 * 不读取文件——仅用于 skill_run_script 等需要先解析路径的工具。
 */
export function resolveSkillRelativePath(skill: SkillDefinition, relPath: string): string {
  const trimmed = String(relPath ?? '').trim()
  if (!trimmed) {
    throw new Error('relPath 不能为空')
  }
  if (isAbsolute(trimmed)) {
    throw new Error('relPath 必须是相对路径，禁止绝对路径')
  }
  const absoluteTarget = resolve(skill.rootDir, trimmed)
  const rel = relative(skill.rootDir, absoluteTarget)
  if (rel.startsWith('..') || rel.split(sep)[0] === '..' || isAbsolute(rel)) {
    throw new Error(`relPath 越界：${trimmed} 解析后位于 skill 目录之外`)
  }
  return absoluteTarget
}
