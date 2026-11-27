import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

test('Electron 脚本执行强制使用 Node 模式，不启动桌面应用或透传无关环境变量', async () => {
  const { outputText } = ts.transpileModule(readFileSync(new URL('./script-runner.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const exports = {}
  let childOptions
  const spawn = (_executable, _args, options) => {
    childOptions = options
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    queueMicrotask(() => child.emit('close', 0, null))
    return child
  }
  new Function('require', 'exports', outputText)((name) => name === 'node:child_process' ? { spawn } : require(name), exports)
  const result = await exports.runScript('test-script.js', { cwd: process.cwd(), timeoutMs: 1000 })
  assert.equal(result.exitCode, 0)
  assert.equal(childOptions.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(childOptions.windowsHide, true)
  assert.ok(Object.keys(childOptions.env).every((key) => [
    'PATH', 'ELECTRON_RUN_AS_NODE', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE'
  ].includes(key)))
})
