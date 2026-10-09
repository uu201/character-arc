import { app, BrowserWindow, globalShortcut, Menu, nativeTheme, screen, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type WindowManager = ReturnType<typeof createWindowManager>
export interface TitleBarOverlayColors {
  color: string
  symbolColor: string
}

const APP_DEFAULT_WIDTH = 1480
const APP_DEFAULT_HEIGHT = 920
const APP_MIN_WIDTH = 1120
const APP_MIN_HEIGHT = 720
const BOSS_KEY_ACCELERATOR = 'CommandOrControl+Shift+H'

export function createWindowManager() {
  let mainWindow: BrowserWindow | null = null
  let bossKeyRegistered = false
  let tray: Tray | null = null

  function registerBossKey(): void {
    if (bossKeyRegistered) return
    bossKeyRegistered = globalShortcut.register(BOSS_KEY_ACCELERATOR, () => { toggleBossKey() })
    if (!bossKeyRegistered) {
      console.warn('[window] boss key shortcut unavailable; using focused-window fallback')
    }
  }

  app.on('will-quit', () => {
    if (bossKeyRegistered) globalShortcut.unregister(BOSS_KEY_ACCELERATOR)
    tray?.destroy()
    tray = null
  })

  function getMainWindowMetrics() {
    const { workAreaSize } = screen.getPrimaryDisplay()
    const compactScreen = workAreaSize.width <= 1366 || workAreaSize.height <= 820
    const minWidth = Math.min(APP_MIN_WIDTH, workAreaSize.width)
    const minHeight = Math.min(APP_MIN_HEIGHT, workAreaSize.height)
    const width = Math.min(Math.max(Math.round(workAreaSize.width * 0.9), minWidth), APP_DEFAULT_WIDTH)
    const height = Math.min(Math.max(Math.round(workAreaSize.height * 0.9), minHeight), APP_DEFAULT_HEIGHT)

    return {
      width,
      height,
      minWidth,
      minHeight,
      compactScreen
    }
  }

  function resolveWindowIconPath(): string | undefined {
    const packagedIconPath = join(process.resourcesPath, 'icon.png')
    if (existsSync(packagedIconPath)) {
      return packagedIconPath
    }

    const localIconPath = join(process.cwd(), 'resources/icon.png')
    if (existsSync(localIconPath)) {
      return localIconPath
    }

    return undefined
  }

  function resolveTrayIconPath(): string | undefined {
    const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    const candidates = [
      join(process.resourcesPath, iconName),
      join(process.resourcesPath, 'resources', iconName),
      join(process.cwd(), 'resources', iconName)
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate
      }
    }

    return resolveWindowIconPath()
  }

  function loadRendererWindow(window: BrowserWindow): void {
    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(process.env.ELECTRON_RENDERER_URL)
      if (process.env.CHARACTERARC_OPEN_DEVTOOLS === '1') {
        window.webContents.openDevTools({ mode: 'detach' })
      }
      return
    }

    const rendererHtml = join(__dirname, '../../out/renderer/index.html')
    console.log('[renderer] loadFile →', rendererHtml)
    void window.loadFile(rendererHtml)
  }

  function sendWindowEvent(window: BrowserWindow | null, channel: string, payload: unknown): void {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      return
    }

    window.webContents.send(channel, payload)
  }

  function showMainWindow(): void {
    const window = mainWindow
    if (!window || window.isDestroyed()) return

    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  function initializeTray(): void {
    if (tray || process.platform === 'darwin') return

    const iconPath = resolveTrayIconPath()
    if (!iconPath) {
      console.warn('[window] tray icon unavailable; system tray integration disabled')
      return
    }

    tray = new Tray(iconPath)
    tray.setToolTip('弧光')
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: '显示弧光',
        click: () => showMainWindow()
      },
      { type: 'separator' },
      {
        label: '退出弧光',
        click: () => app.quit()
      }
    ]))
    tray.on('click', () => showMainWindow())
  }

  function broadcastWindowEvent(channel: string, payload: unknown, exceptWebContentsId?: number): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        continue
      }

      if (exceptWebContentsId && window.webContents.id === exceptWebContentsId) {
        continue
      }

      window.webContents.send(channel, payload)
    }
  }

  function createMainWindow(): BrowserWindow {
    const { width, height, minWidth, minHeight, compactScreen } = getMainWindowMetrics()
    const windowIcon = resolveWindowIconPath()
    const window = new BrowserWindow({
      width,
      height,
      minWidth,
      minHeight,
      icon: windowIcon,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 14, y: 13 } }
        : { titleBarOverlay: { color: '#f8f7f4', symbolColor: '#1c1917', height: 40 } }),
      autoHideMenuBar: true,
      title: `弧光 v${app.getVersion()}`,
      backgroundColor: '#f8f7f4',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    window.once('ready-to-show', () => {
      if (compactScreen) {
        window.center()
      }
      window.show()
    })

    initializeTray()

    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    window.webContents.on('before-input-event', (event, input) => {
      const primaryModifier = process.platform === 'darwin' ? input.meta : input.control
      if (!bossKeyRegistered && input.type === 'keyDown' && !input.isAutoRepeat
        && primaryModifier && input.shift && !input.alt && input.key.toLowerCase() === 'h') {
        event.preventDefault()
        toggleBossKey()
      }
    })

    window.on('closed', () => {
      if (mainWindow === window) {
        mainWindow = null
      }
    })

    loadRendererWindow(window)
    mainWindow = window
    return window
  }

  function getActiveWindow(): BrowserWindow | null {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  }

  function toggleBossKey(): { success: boolean; visible?: boolean; error?: string } {
    const window = mainWindow
    if (!window || window.isDestroyed()) return { success: false, error: '主窗口不可用' }

    if (window.isMinimized() || !window.isVisible()) {
      showMainWindow()
      return { success: true, visible: true }
    }

    window.hide()
    return { success: true, visible: false }
  }

  function updateTitleBarOverlayColors(colors?: TitleBarOverlayColors): void {
    if (process.platform !== 'win32') return

    const dark = nativeTheme.shouldUseDarkColors
    const color = colors?.color ?? (dark ? '#111315' : '#f8f8f9')
    const symbolColor = colors?.symbolColor ?? (dark ? '#b8bec7' : '#52525b')
    const overlay = { color, symbolColor, height: 40 }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay(overlay)
    }
  }

  nativeTheme.on('updated', updateTitleBarOverlayColors)

  return {
    createMainWindow,
    getMainWindow: () => mainWindow,
    getActiveWindow,
    toggleBossKey,
    registerBossKey,
    isBossKeyRegistered: () => bossKeyRegistered,
    sendWindowEvent,
    broadcastWindowEvent,
    updateTitleBarOverlayColors
  }
}
