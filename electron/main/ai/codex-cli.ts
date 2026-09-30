import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants as fsConstants, accessSync, existsSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, extname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import type { TurnImageAttachment } from '@shared/assistant-runtime'
import type { AiRunUsage, AppSettings, AiStreamHandlers, PromptPair } from './shared-types'
import { normalizeProxyUrl } from './proxy-fetch'

const CODEX_MODEL_DISCOVERY_TIMEOUT_MS = 15_000
const CODEX_COMMAND_TIMEOUT_MS = 15_000
const MAX_CAPTURED_OUTPUT = 5 * 1024 * 1024
const DEFAULT_CODEX_MODELS = ['default', 'gpt-5.5', 'gpt-5.4-mini']

export type CodexCliModel = {
  id: string
  ownedBy: string | null
}

export type CodexCliResult = {
  text: string
  usage?: AiRunUsage
}

type CodexCommand = {
  program: string
  prefixArgs: string[]
}

type CapturedCommand = {
  stdout: string
  stderr: string
  exitCode: number | null
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (process.platform !== 'win32') accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function executableNames(): string[] {
  return process.platform === 'win32'
    ? ['codex.cmd', 'codex.exe', 'codex.bat', 'codex.com', 'codex']
    : ['codex']
}

function candidateExecutableDirs(): string[] {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'))
  } else {
    if (process.env.HOME) {
      dirs.push(join(process.env.HOME, '.local', 'bin'))
      dirs.push(join(process.env.HOME, '.npm-global', 'bin'))
      dirs.push(join(process.env.HOME, '.volta', 'bin'))
    }
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin')
    dirs.push('/Applications/ChatGPT.app/Contents/Resources')
  }
  return [...new Set(dirs)]
}

function findCodexInDirectory(directory: string): string | null {
  for (const name of executableNames()) {
    const candidate = join(directory, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

function looksLikeEnvironmentAssignment(value: string): boolean {
  const firstToken = value.split(/\s+/, 1)[0] ?? ''
  return /^[A-Za-z_][A-Za-z\d_]*=/.test(firstToken)
}

function expandHomePath(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2))
  }
  return value
}

function commandForExecutable(executable: string): CodexCommand {
  if (process.platform !== 'win32' || !['.cmd', '.bat'].includes(extname(executable).toLowerCase())) {
    return { program: executable, prefixArgs: [] }
  }

  // npm 在 Windows 上安装的是 cmd shim。直接调用相邻的 JS 入口，可以避免
  // shell quoting，也能正确处理包含空格的用户名和安装路径。
  const codexJs = join(dirname(executable), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  if (!existsSync(codexJs)) {
    throw new Error('当前 Codex CLI 路径是 .cmd/.bat，但未找到对应的 @openai/codex JS 入口。请填写 codex.exe 或 npm 全局安装目录中的 codex.cmd。')
  }
  const bundledNode = join(dirname(executable), 'node.exe')
  return {
    program: isExecutable(bundledNode) ? bundledNode : 'node',
    prefixArgs: [codexJs]
  }
}

/** 解析用户配置的 Codex 路径；留空时兼容 Electron GUI 常见的精简 PATH。 */
export function resolveCodexCommand(settings: AppSettings): CodexCommand {
  const configured = settings.codexCliPath?.trim() ?? ''
  if (looksLikeEnvironmentAssignment(configured)) {
    throw new Error('Codex CLI 路径只能填写可执行文件路径，不能包含环境变量或启动命令。')
  }

  if (configured) {
    const expanded = expandHomePath(configured)
    let executable = expanded
    try {
      if (statSync(expanded).isDirectory()) {
        executable = findCodexInDirectory(expanded) ?? ''
      }
    } catch {
      // 下面统一给出可操作的路径错误。
    }
    if (!executable || !isExecutable(executable)) {
      throw new Error('未找到指定的 Codex CLI。请填写 codex 可执行文件，或包含它的目录。')
    }
    return commandForExecutable(executable)
  }

  for (const directory of candidateExecutableDirs()) {
    const executable = findCodexInDirectory(directory)
    if (executable) return commandForExecutable(executable)
  }

  // 保留裸命令作为最后兜底，让 spawn 返回准确的 ENOENT 错误。
  return { program: 'codex', prefixArgs: [] }
}

function buildCodexEnvironment(settings: AppSettings): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const proxyUrl = settings.proxyUrl?.trim() ? normalizeProxyUrl(settings.proxyUrl) : ''
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl
    env.HTTPS_PROXY = proxyUrl
    env.http_proxy = proxyUrl
    env.https_proxy = proxyUrl
  }
  return env
}

function buildCodexPrompt(settings: AppSettings, prompt: PromptPair): string {
  return [
    prompt.system.trim(),
    '',
    '【运行时模型信息】',
    `当前请求使用 Codex CLI，模型标识：${settings.model || 'default'}。`,
    '',
    '【用户请求】',
    prompt.user.trim()
  ].join('\n')
}

/** 构建只读、无持久会话的 Codex exec 参数。Prompt 始终通过 stdin 传入。 */
export function buildCodexExecArgs(settings: AppSettings, imagePaths: readonly string[] = []): string[] {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-c',
    'features.shell_tool=false',
    '-c',
    'web_search="disabled"'
  ]
  const effort = settings.codexReasoningEffort?.trim().toLowerCase()
  if (effort && effort !== 'default') {
    args.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`)
  }
  const model = settings.model?.trim()
  if (model && model.toLowerCase() !== 'default') {
    args.push('--model', model)
  }
  for (const imagePath of imagePaths) {
    args.push('--image', imagePath)
  }
  args.push('-')
  return args
}

function imageExtension(mimeType: TurnImageAttachment['mimeType']): string {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.png'
}

async function materializeCodexImages(images: TurnImageAttachment[] = []): Promise<{
  directory?: string
  paths: string[]
}> {
  if (images.length === 0) return { paths: [] }
  const directory = await mkdtemp(join(tmpdir(), 'characterarc-codex-images-'))
  const paths: string[] = []
  try {
    for (const [index, image] of images.entries()) {
      const commaIndex = image.dataUrl.indexOf(',')
      if (commaIndex < 0) throw new Error('Codex 图片数据格式无效。')
      const path = join(directory, `image-${index + 1}${imageExtension(image.mimeType)}`)
      await writeFile(path, Buffer.from(image.dataUrl.slice(commaIndex + 1), 'base64'))
      paths.push(path)
    }
    return { directory, paths }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function makeAbortError(): Error {
  const error = new Error('任务已取消。')
  error.name = 'AbortError'
  return error
}

function classifySpawnError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOENT|not found|no such file/i.test(message)) {
    return new Error('未找到 Codex CLI。请先安装 @openai/codex，或在设置中填写 Codex CLI 路径。')
  }
  return new Error(`Codex CLI 启动失败：${message}`)
}

function classifyRunError(stderr: string, fallback = 'Codex CLI 执行失败。'): Error {
  const detail = stderr.trim()
  if (/not authenticated|log\s*in|login|authentication/i.test(detail)) {
    return new Error('Codex CLI 尚未登录。请先在终端执行 codex login。')
  }
  return new Error(detail ? `Codex CLI 执行失败：${detail.slice(0, 1200)}` : fallback)
}

function appendCaptured(current: string, chunk: Buffer | string): string {
  if (current.length >= MAX_CAPTURED_OUTPUT) return current
  return (current + chunk.toString()).slice(0, MAX_CAPTURED_OUTPUT)
}

export function parseCodexJsonLine(
  line: string,
  handlers?: AiStreamHandlers
): { text?: string; usage?: AiRunUsage; error?: string } {
  let value: Record<string, unknown>
  try {
    value = JSON.parse(line) as Record<string, unknown>
  } catch {
    return {}
  }

  const type = String(value.type ?? '')
  if (type === 'turn.failed' || type === 'error') {
    const nested = value.error && typeof value.error === 'object'
      ? String((value.error as Record<string, unknown>).message ?? '')
      : String(value.error ?? value.message ?? '')
    return { error: nested || 'Codex CLI 返回失败事件。' }
  }

  if (type === 'turn.completed') {
    const usage = value.usage && typeof value.usage === 'object'
      ? value.usage as Record<string, unknown>
      : null
    if (!usage) return {}
    const promptTokens = Number(usage.input_tokens ?? usage.prompt_tokens)
    const completionTokens = Number(usage.output_tokens ?? usage.completion_tokens)
    const normalized: AiRunUsage = {
      promptTokens: Number.isFinite(promptTokens) ? promptTokens : undefined,
      completionTokens: Number.isFinite(completionTokens) ? completionTokens : undefined
    }
    if (normalized.promptTokens !== undefined || normalized.completionTokens !== undefined) {
      normalized.totalTokens = (normalized.promptTokens ?? 0) + (normalized.completionTokens ?? 0)
      return { usage: normalized }
    }
    return {}
  }

  if (type !== 'item.completed' || !value.item || typeof value.item !== 'object') return {}
  const item = value.item as Record<string, unknown>
  const itemType = String(item.type ?? '')
  const text = typeof item.text === 'string'
    ? item.text
    : typeof item.message === 'string'
      ? item.message
      : typeof item.content === 'string'
        ? item.content
        : ''
  if (!text) return {}
  if (itemType === 'reasoning') {
    handlers?.onReasoningDelta?.(text)
    return {}
  }
  return itemType === 'agent_message' ? { text } : {}
}

/** 通过 Codex CLI 完成一次生成；JSONL 事件会映射到现有流式回调。 */
export async function runCodexCli(
  settings: AppSettings,
  prompt: PromptPair,
  options: { signal?: AbortSignal; handlers?: AiStreamHandlers; images?: TurnImageAttachment[] } = {}
): Promise<CodexCliResult> {
  options.signal?.throwIfAborted()
  const command = resolveCodexCommand(settings)
  const tempImages = await materializeCodexImages(options.images)
  try {
    const args = [...command.prefixArgs, ...buildCodexExecArgs(settings, tempImages.paths)]
    const child = spawn(command.program, args, {
      cwd: tmpdir(),
      env: buildCodexEnvironment(settings),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    }) as ChildProcessWithoutNullStreams

    return await new Promise<CodexCliResult>((resolve, reject) => {
    let fullText = ''
    let stderr = ''
    let usage: AiRunUsage | undefined
    let eventError = ''
    let settled = false
    const lines = createInterface({ input: child.stdout })

    const cleanup = () => {
      options.signal?.removeEventListener('abort', abort)
      lines.close()
    }
    const finishReject = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = () => {
      child.kill()
      finishReject(makeAbortError())
    }

    options.signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => finishReject(classifySpawnError(error)))
    child.stderr.on('data', (chunk) => { stderr = appendCaptured(stderr, chunk) })
    lines.on('line', (line) => {
      const parsed = parseCodexJsonLine(line, options.handlers)
      if (parsed.text) {
        fullText += parsed.text
        options.handlers?.onTextDelta(parsed.text)
      }
      if (parsed.usage) usage = parsed.usage
      if (parsed.error) eventError = parsed.error
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      cleanup()
      if (options.signal?.aborted) {
        reject(makeAbortError())
      } else if (eventError) {
        reject(classifyRunError(eventError))
      } else if (exitCode !== 0) {
        reject(classifyRunError(stderr))
      } else if (!fullText.trim()) {
        reject(new Error('Codex CLI 已结束，但没有返回可见正文。'))
      } else {
        resolve({ text: fullText, usage })
      }
    })

    child.stdin.on('error', (error) => finishReject(classifyRunError(String(error))))
    child.stdin.end(buildCodexPrompt(settings, prompt))
    })
  } finally {
    if (tempImages.directory) {
      await rm(tempImages.directory, { recursive: true, force: true })
    }
  }
}

async function captureCodexCommand(
  settings: AppSettings,
  args: string[],
  timeoutMs = CODEX_COMMAND_TIMEOUT_MS
): Promise<CapturedCommand> {
  const command = resolveCodexCommand(settings)
  const child = spawn(command.program, [...command.prefixArgs, ...args], {
    cwd: tmpdir(),
    env: buildCodexEnvironment(settings),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  return await new Promise<CapturedCommand>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill()
      if (!settled) {
        settled = true
        reject(new Error('Codex CLI 响应超时。'))
      }
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(classifySpawnError(error))
      }
    })
    child.stdout?.on('data', (chunk) => { stdout = appendCaptured(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = appendCaptured(stderr, chunk) })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        resolve({ stdout, stderr, exitCode })
      }
    })
  })
}

export async function testCodexCliConnection(settings: AppSettings): Promise<void> {
  const result = await captureCodexCommand(settings, ['login', 'status'])
  if (result.exitCode !== 0) throw classifyRunError(result.stderr || result.stdout)
}

function parseCodexModels(stdout: string): CodexCliModel[] | null {
  const jsonStart = stdout.indexOf('{')
  if (jsonStart < 0) return null
  try {
    const payload = JSON.parse(stdout.slice(jsonStart)) as { models?: Array<Record<string, unknown>> }
    if (!Array.isArray(payload.models)) return null
    const ids = payload.models
      .map((item) => String(item.slug ?? item.id ?? '').trim())
      .filter(Boolean)
    if (ids.length === 0) return null
    return ['default', ...new Set(ids)].map((id) => ({ id, ownedBy: 'codex-cli' }))
  } catch {
    return null
  }
}

export async function fetchCodexCliModels(settings: AppSettings): Promise<CodexCliModel[]> {
  const discovered = await captureCodexCommand(settings, ['debug', 'models'], CODEX_MODEL_DISCOVERY_TIMEOUT_MS)
  const discoveredModels = discovered.exitCode === 0 ? parseCodexModels(discovered.stdout) : null
  if (discoveredModels) return discoveredModels

  // 较旧版本或未登录环境可能无法刷新目录，继续读取 CLI 内置目录；再失败时
  // 保留 DBX 同类实现采用的静态入口，用户仍可手动填写任意模型名。
  const bundled = await captureCodexCommand(
    settings,
    ['debug', 'models', '--bundled'],
    CODEX_MODEL_DISCOVERY_TIMEOUT_MS
  )
  return (bundled.exitCode === 0 ? parseCodexModels(bundled.stdout) : null)
    ?? DEFAULT_CODEX_MODELS.map((id) => ({ id, ownedBy: 'codex-cli' }))
}
