import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('./window-manager.ts', import.meta.url))
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const nativeRequire = createRequire(import.meta.url)

function setup(shortcutAvailable = true, platform = 'win32') {
  const app = Object.assign(new EventEmitter(), { getVersion: () => 'test' })
  const shortcuts = new Map()
  const windows = []
  class BrowserWindow extends EventEmitter {
    minimized = false
    visible = true
    focused = false
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler() {}, isDestroyed: () => false
    })
    constructor() { super(); windows.push(this) }
    loadURL() {}
    isDestroyed() { return this.destroyed }
    isMinimized() { return this.minimized }
    isVisible() { return this.visible }
    minimize() { this.minimized = true; this.focused = false }
    restore() { this.minimized = false }
    show() { this.visible = true }
    focus() { this.focused = true }
  }
  const electron = {
    app, BrowserWindow,
    nativeTheme: new EventEmitter(),
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    shell: {},
    globalShortcut: {
      register(accelerator, handler) {
        if (shortcutAvailable) shortcuts.set(accelerator, handler)
        return shortcutAvailable
      },
      unregister(accelerator) { shortcuts.delete(accelerator) }
    }
  }
  const exports = {}
  runInNewContext(compiled, {
    exports, __dirname: dirname(sourcePath),
    require: (name) => name === 'electron' ? electron : nativeRequire(name),
    process: { platform, cwd: () => dirname(sourcePath), resourcesPath: dirname(sourcePath), env: { ELECTRON_RENDERER_URL: 'about:blank' } },
    console: { warn() {} }
  })
  const manager = exports.createWindowManager()
  const window = manager.createMainWindow()
  return { manager, window, app, shortcuts }
}

test('boss key minimizes and restores the same window without closing it', () => {
  const { manager, window } = setup()
  assert.equal(manager.toggleBossKey().visible, false)
  assert.equal(window.minimized, true)
  assert.equal(window.destroyed, false)
  assert.equal(manager.toggleBossKey().visible, true)
  assert.equal(window.minimized, false)
  assert.equal(window.focused, true)
})

test('global shortcut toggles the main window and is released on quit', () => {
  const { manager, window, app, shortcuts } = setup()
  manager.registerBossKey()
  assert.equal(manager.isBossKeyRegistered(), true)
  window.webContents.emit('before-input-event', { preventDefault() {} }, {
    type: 'keyDown', key: 'H', control: true, shift: true, alt: false, isAutoRepeat: false
  })
  assert.equal(window.minimized, false)
  shortcuts.get('CommandOrControl+Shift+H')()
  assert.equal(window.minimized, true)
  shortcuts.get('CommandOrControl+Shift+H')()
  assert.equal(window.minimized, false)
  app.emit('will-quit')
  assert.equal(shortcuts.size, 0)
})

test('macOS fallback uses Command rather than Control', () => {
  const { manager, window } = setup(false, 'darwin')
  manager.registerBossKey()
  const event = { preventDefault() {} }
  const input = { type: 'keyDown', key: 'h', control: true, meta: false, shift: true, alt: false, isAutoRepeat: false }
  window.webContents.emit('before-input-event', event, input)
  assert.equal(window.minimized, false)
  window.webContents.emit('before-input-event', event, { ...input, control: false, meta: true })
  assert.equal(window.minimized, true)
})

test('shortcut conflict falls back to focused-window input and ignores key repeats', () => {
  const { manager, window } = setup(false)
  manager.registerBossKey()
  assert.equal(manager.isBossKeyRegistered(), false)
  let prevented = false
  const input = { type: 'keyDown', key: 'H', control: true, shift: true, alt: false, isAutoRepeat: false }
  window.webContents.emit('before-input-event', { preventDefault() { prevented = true } }, input)
  assert.equal(prevented, true)
  assert.equal(window.minimized, true)
  window.webContents.emit('before-input-event', { preventDefault() {} }, { ...input, isAutoRepeat: true })
  assert.equal(window.minimized, true)
})

test('closed main window reports failure instead of restoring a destroyed window', () => {
  const { manager, window } = setup()
  window.destroyed = true
  window.emit('closed')
  assert.equal(manager.toggleBossKey().success, false)
})
