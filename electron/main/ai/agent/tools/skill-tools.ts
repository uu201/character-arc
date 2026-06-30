import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { SkillDefinition } from '../../skills/types'
import { loadSkillReferenceFile, resolveSkillRelativePath } from '../../skills/loader'
import { runScript } from './script-runner'
import type { Tool, ToolHandlerResult } from './types'

export type SkillToolFactoryOptions = {
  /** 按 id 查 skill。projectId 已经被 orchestrator 注入，这里只接受 id。 */
  resolveSkill: (id: string) => SkillDefinition | undefined
  /** 列出当前项目可见的所有 skill（内置 + 项目扩展）。 */
  listSkills?: () => SkillDefinition[]
  /** 解析当前项目下 skill 是否启用；未提供时使用 skill 自身默认 enabled。 */
  resolveSkillEnabled?: (skill: SkillDefinition) => boolean
  /** 是否允许 skill_run_script。builtin skill 默认开；project skill 应受 settings 控制。 */
  allowScriptExecution?: (skill: SkillDefinition) => boolean
  /** 单文件读取上限。0 表示不截断。默认不截断。 */
  maxReferenceChars?: number
  /** glob 一次返回的最多文件数。默认 200。 */
  maxGlobEntries?: number
  /** 脚本超时毫秒。默认 30s。 */
  scriptTimeoutMs?: number
}

/** 参考文件单次读取默认字符上限（0 = 不截断） */
const DEFAULT_REFERENCE_CHAR_CAP = 0
/** glob 一次返回的默认最多文件数 */
const DEFAULT_GLOB_ENTRY_CAP = 200
/** 脚本执行默认超时（毫秒） */
const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000

/** 构造成功的工具返回 */
function ok(content: string): ToolHandlerResult {
  return { content }
}

/** 构造失败的工具返回 */
function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

/**
 * 从输入参数中提取必填的字符串字段，缺失或为空时抛出异常
 * @param input - 工具输入对象
 * @param key - 字段名
 * @returns 去除首尾空白的字符串
 */
function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`参数 ${key} 缺失或不是非空字符串`)
  }
  return value.trim()
}

function normalizeOptionalString(input: Record<string, unknown>, key: string): string {
  return typeof input[key] === 'string' ? String(input[key]).trim() : ''
}

function formatSkillListEntry(skill: SkillDefinition, enabled: boolean): string {
  const scope = skill.scope === 'builtin' ? '内置' : '项目'
  const enabledLabel = enabled ? '启用' : '停用'
  const desc = (skill.description || '暂无描述').replace(/\s+/g, ' ').trim()
  const stageIds = skill.manifest.stages.length ? skill.manifest.stages.join(',') : '未绑定阶段'
  return [
    `- ${skill.id}`,
    `名称：${skill.name}`,
    `状态：${enabledLabel}`,
    `来源：${scope}（${skill.path}）`,
    `分类：${skill.manifest.category}`,
    `阶段：${stageIds}`,
    `适配：${skill.compatibility}`,
    `参考文件：${skill.referencesCount}`,
    `一句话：${desc}`
  ].join('｜')
}

/**
 * 创建 skill 相关的一组工具（加载、读取参考文件、列出文件、运行脚本）
 * @param opts - 工厂配置选项
 * @returns 工具数组
 */
export function createSkillTools(opts: SkillToolFactoryOptions): Tool[] {
  const maxReferenceChars = opts.maxReferenceChars ?? DEFAULT_REFERENCE_CHAR_CAP
  const maxGlobEntries = opts.maxGlobEntries ?? DEFAULT_GLOB_ENTRY_CAP
  const scriptTimeoutMs = opts.scriptTimeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS

  /** 根据 id 解析 skill，未找到时返回错误对象 */
  function resolveSkillOrError(skillId: string): SkillDefinition | { error: string } {
    const skill = opts.resolveSkill(skillId)
    if (!skill) return { error: `skill 未找到：${skillId}` }
    return skill
  }

  const skillList: Tool = {
    definition: {
      name: 'skill_list',
      description: '列出当前项目可见的所有 skills 摘要（内置 + 项目扩展）。当用户询问“有哪些 skills / 现有 skills / 全部 skills / 每个 skill 总结一句话 / skills 清单”时，必须先调用此工具，不要只根据 system prompt 里的候选 skill 索引作答。',
      inputSchema: {
        type: 'object',
        properties: {
          enabled_only: { type: 'boolean', description: '是否只返回已启用的 skill。默认 false，表示返回所有已识别 skill。' },
          scope: { type: 'string', enum: ['all', 'builtin', 'project'], description: '按来源过滤。默认 all。' },
          query: { type: 'string', description: '可选，按 id、名称、路径或描述做模糊过滤。' }
        }
      }
    },
    async handler(input) {
      try {
        const enabledOnly = input.enabled_only === true
        const scope = normalizeOptionalString(input, 'scope')
        const query = normalizeOptionalString(input, 'query').toLowerCase()
        const resolveEnabled = opts.resolveSkillEnabled ?? ((skill: SkillDefinition) => skill.enabled)
        const skills = (opts.listSkills?.() ?? [])
          .map((skill) => ({ skill, enabled: resolveEnabled(skill) }))
          .filter((entry) => !enabledOnly || entry.enabled)
          .filter((entry) => scope === 'builtin' || scope === 'project' ? entry.skill.scope === scope : true)
          .filter((entry) => {
            if (!query) return true
            const { skill } = entry
            return [
              skill.id,
              skill.name,
              skill.path,
              skill.description,
              skill.manifest.category,
              skill.compatibility
            ].some((value) => String(value ?? '').toLowerCase().includes(query))
          })
          .sort((a, b) => a.skill.path.localeCompare(b.skill.path, 'zh-CN') || a.skill.id.localeCompare(b.skill.id, 'zh-CN'))

        if (!skills.length) {
          return ok('未找到匹配的 skill。')
        }

        const total = opts.listSkills?.().length ?? skills.length
        const enabledCount = skills.filter((entry) => entry.enabled).length
        const builtinCount = skills.filter((entry) => entry.skill.scope === 'builtin').length
        const projectCount = skills.filter((entry) => entry.skill.scope === 'project').length
        return ok([
          `已识别 skills：${total} 个；本次返回：${skills.length} 个；其中启用：${enabledCount} 个，内置：${builtinCount} 个，项目扩展：${projectCount} 个。`,
          '',
          ...skills.map((entry) => formatSkillListEntry(entry.skill, entry.enabled))
        ].join('\n'))
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const skillLoad: Tool = {
    definition: {
      name: 'skill_load',
      description: '加载并返回指定 skill 的完整 SKILL.md 内容（含 frontmatter 与正文）。当模型需要查看一个 skill 的方法论详情时使用。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'skill 的 id（即 resources/skills 下的目录名）' }
        },
        required: ['skill_id']
      }
    },
    async handler(input) {
      try {
        const skillId = requireString(input, 'skill_id')
        const result = resolveSkillOrError(skillId)
        if ('error' in result) return err(result.error)
        return ok(result.content)
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const skillReadReference: Tool = {
    definition: {
      name: 'skill_read_reference',
      description: '读取 skill 目录下任意一个相对路径的文件（通常是 references/xxx.md，但也可读 examples/、templates/ 等任何子文件）。路径必须相对 skill 根目录，不能用绝对路径或 `..` 越界。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'skill 的 id' },
          file: { type: 'string', description: '相对 skill 根目录的路径，如 "references/output-templates.md"' }
        },
        required: ['skill_id', 'file']
      }
    },
    async handler(input) {
      try {
        const skillId = requireString(input, 'skill_id')
        const file = requireString(input, 'file')
        const result = resolveSkillOrError(skillId)
        if ('error' in result) return err(result.error)
        const content = await loadSkillReferenceFile(result, file)
        if (!maxReferenceChars || content.length <= maxReferenceChars) return ok(content)
        return ok(`${content.slice(0, maxReferenceChars)}\n\n[已截断 ${content.length - maxReferenceChars} 字。如需完整请调用更精确的范围，或分段读取。]`)
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const skillGlob: Tool = {
    definition: {
      name: 'skill_glob',
      description: '列出 skill 目录下的所有文件（递归）。可选传 substring 过滤文件名/路径。返回相对 skill 根目录的路径。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'skill 的 id' },
          pattern: { type: 'string', description: '可选，过滤文件路径的 substring（不区分大小写，含路径）' }
        },
        required: ['skill_id']
      }
    },
    async handler(input) {
      try {
        const skillId = requireString(input, 'skill_id')
        const pattern = typeof input.pattern === 'string' ? input.pattern.trim().toLowerCase() : ''
        const result = resolveSkillOrError(skillId)
        if ('error' in result) return err(result.error)
        const files = await listFilesRecursive(result.rootDir, maxGlobEntries)
        const filtered = pattern ? files.filter((f) => f.toLowerCase().includes(pattern)) : files
        if (filtered.length === 0) return ok('（无匹配文件）')
        return ok(filtered.join('\n'))
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const skillRunScript: Tool = {
    definition: {
      name: 'skill_run_script',
      description: '在 skill 的 scripts/ 目录下执行一个 .js 脚本（用应用内置 Node 跑）。仅允许相对 skill 根目录的路径，不能越界。环境变量默认仅透传 PATH。返回 stdout / stderr / exitCode。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'skill 的 id' },
          script: { type: 'string', description: '相对 skill 根目录的脚本路径，如 "scripts/setup.js"' },
          args: {
            type: 'array',
            description: '传给脚本的命令行参数',
            items: { type: 'string' }
          }
        },
        required: ['skill_id', 'script']
      }
    },
    async handler(input, ctx) {
      try {
        const skillId = requireString(input, 'skill_id')
        const script = requireString(input, 'script')
        const args = Array.isArray(input.args)
          ? input.args.map((a) => String(a))
          : []
        const result = resolveSkillOrError(skillId)
        if ('error' in result) return err(result.error)
        if (opts.allowScriptExecution && !opts.allowScriptExecution(result)) {
          return err(`当前安全策略禁止运行 skill "${skillId}" 的脚本`)
        }
        const absolutePath = resolveSkillRelativePath(result, script)
        const run = await runScript(absolutePath, {
          cwd: result.rootDir,
          args,
          timeoutMs: scriptTimeoutMs,
          signal: ctx.signal
        })
        const summary = [
          `exitCode: ${run.exitCode === null ? '(null)' : run.exitCode}`,
          run.signal ? `signal: ${run.signal}` : '',
          run.timedOut ? `timedOut: true（超过 ${scriptTimeoutMs}ms 被强杀）` : '',
          run.truncated ? 'truncated: true（输出超过上限被截断）' : '',
          run.error ? `error: ${run.error}` : '',
          `durationMs: ${run.durationMs}`,
          '',
          '--- STDOUT ---',
          run.stdout || '(空)',
          '--- STDERR ---',
          run.stderr || '(空)'
        ].filter(Boolean).join('\n')
        const exitCodeBad = run.exitCode !== 0 || run.timedOut || Boolean(run.error)
        return { content: summary, isError: exitCodeBad }
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return [skillList, skillLoad, skillReadReference, skillGlob, skillRunScript]
}

/**
 * 递归列出目录下所有文件（相对路径），达到上限时提前终止
 * @param rootDir - 根目录绝对路径
 * @param cap - 最大返回文件数
 * @returns 排序后的相对路径数组
 */
async function listFilesRecursive(rootDir: string, cap: number): Promise<string[]> {
  const out: string[] = []

  async function walk(dir: string): Promise<void> {
    if (out.length >= cap) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (out.length >= cap) return
      // 跳过常见的"应该忽略"目录，避免噪音
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
        await walk(join(dir, entry.name))
        continue
      }
      const absolute = join(dir, entry.name)
      const rel = relative(rootDir, absolute).split(sep).join('/')
      out.push(rel)
    }
  }

  await walk(rootDir)
  return out.sort()
}
