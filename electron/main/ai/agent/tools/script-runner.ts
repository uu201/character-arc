import { spawn } from 'node:child_process'
import { extname } from 'node:path'
import { platform } from 'node:os'

export type ScriptRunOptions = {
  /** 工作目录；脚本只能在 skill.rootDir 内执行 */
  cwd: string
  /** 命令行参数 */
  args?: string[]
  /** 允许透传的环境变量名白名单。默认仅透传 PATH。 */
  envWhitelist?: string[]
  /** 超时毫秒，默认 30s */
  timeoutMs?: number
  /** stdout/stderr 各自的字节上限，默认 64KB */
  maxOutputBytes?: number
  /** 外部取消 signal */
  signal?: AbortSignal
}

export type ScriptRunResult = {
  exitCode: number | null
  /** 进程信号（如 SIGTERM/SIGKILL），未被信号终止时为 null */
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** 是否因输出过大被截断 */
  truncated: boolean
  /** 是否因超时被强杀 */
  timedOut: boolean
  /** 进程级 spawn/通信错误（不是脚本本身 exit 非零） */
  error?: string
  /** 实际耗时 */
  durationMs: number
}

/** 默认脚本超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000
/** 默认 stdout/stderr 各自的字节上限 */
const DEFAULT_MAX_OUTPUT_BYTES = 65_536

/**
 * 在受控环境下运行脚本。
 *
 * - 仅支持 .js（用 process.execPath 跑 node）。其它扩展名直接拒绝。
 * - cwd 由调用方负责确保是合法 skill 目录（{@link resolveSkillRelativePath}）。
 * - env 仅透传白名单，避免泄漏 API key 等机密。
 * - stdout/stderr 各超 maxOutputBytes 立刻截断并标记 truncated。
 * - 超时先发 SIGTERM，1s 后未退则 SIGKILL；timedOut=true。
 * - 外部 signal 触发时也走 SIGTERM/SIGKILL 流程。
 */
export async function runScript(scriptPath: string, opts: ScriptRunOptions): Promise<ScriptRunResult> {
  const ext = extname(scriptPath).toLowerCase()
  if (ext !== '.js') {
    return {
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      truncated: false,
      timedOut: false,
      error: `不支持的脚本类型 ${ext || '(无扩展名)'}，目前只支持 .js`,
      durationMs: 0
    }
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const envWhitelist = opts.envWhitelist ?? ['PATH']
  const env: NodeJS.ProcessEnv = {}
  // 始终透传 PATH，否则 spawn node 都找不到。windows 下 PATHEXT/SystemRoot 也得带上。
  for (const key of new Set(['PATH', ...envWhitelist])) {
    const value = process.env[key]
    if (typeof value === 'string') env[key] = value
  }
  if (platform() === 'win32') {
    for (const key of ['PATHEXT', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE']) {
      const value = process.env[key]
      if (typeof value === 'string' && env[key] === undefined) env[key] = value
    }
  }
  // process.execPath 在应用中是 Electron，必须显式切换到 Node 模式执行脚本。
  env.ELECTRON_RUN_AS_NODE = '1'

  const args = ['--no-deprecation', scriptPath, ...(opts.args ?? [])]
  const startedAt = Date.now()

  return new Promise<ScriptRunResult>((resolveResult) => {
    let stdoutBuf = Buffer.alloc(0)
    let stderrBuf = Buffer.alloc(0)
    let truncated = false
    let timedOut = false
    let abortedByExternal = false
    let settled = false

    const child = spawn(process.execPath, args, {
      cwd: opts.cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    /** 最终结算结果，确保只 resolve 一次 */
    const finalize = (result: Omit<ScriptRunResult, 'durationMs'>): void => {
      if (settled) return
      settled = true
      cleanup()
      resolveResult({ ...result, durationMs: Date.now() - startedAt })
    }

    /** 终止子进程：先 SIGTERM，1s 后未退出则 SIGKILL */
    const killChain = (reason: 'timeout' | 'aborted'): void => {
      if (reason === 'timeout') timedOut = true
      else abortedByExternal = true
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (!child.killed) {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }
      }, 1000)
    }

    const timer = setTimeout(() => killChain('timeout'), timeoutMs)
    const onAbort = (): void => killChain('aborted')
    if (opts.signal) {
      if (opts.signal.aborted) {
        killChain('aborted')
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    function cleanup(): void {
      clearTimeout(timer)
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
    }

    /** 将 chunk 追加到对应缓冲区，超出上限则截断并标记 truncated */
    function appendChunk(target: 'stdout' | 'stderr', chunk: Buffer): void {
      const current = target === 'stdout' ? stdoutBuf : stderrBuf
      const remaining = maxOutputBytes - current.length
      if (remaining <= 0) {
        if (!truncated) truncated = true
        return
      }
      const sliceSize = Math.min(chunk.length, remaining)
      const next = Buffer.concat([current, chunk.subarray(0, sliceSize)], current.length + sliceSize)
      if (target === 'stdout') stdoutBuf = next
      else stderrBuf = next
      if (chunk.length > sliceSize) {
        truncated = true
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => appendChunk('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => appendChunk('stderr', chunk))

    child.on('error', (err) => {
      finalize({
        exitCode: null,
        signal: null,
        stdout: stdoutBuf.toString('utf-8'),
        stderr: stderrBuf.toString('utf-8'),
        truncated,
        timedOut,
        error: err instanceof Error ? err.message : String(err)
      })
    })

    child.on('close', (code, sig) => {
      finalize({
        exitCode: typeof code === 'number' ? code : null,
        signal: sig,
        stdout: stdoutBuf.toString('utf-8'),
        stderr: stderrBuf.toString('utf-8'),
        truncated,
        timedOut,
        error: abortedByExternal && !timedOut ? '已被取消' : undefined
      })
    })
  })
}
