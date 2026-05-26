import { app, BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type WindowManager = ReturnType<typeof createWindowManager>

const APP_DEFAULT_WIDTH = 1480
const APP_DEFAULT_HEIGHT = 920
const APP_MIN_WIDTH = 1120
const APP_MIN_HEIGHT = 720

export function createWindowManager() {
  let mainWindow: BrowserWindow | null = null

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

  function loadRendererWindow(window: BrowserWindow): void {
    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(process.env.ELECTRON_RENDERER_URL)
      window.webContents.openDevTools({ mode: 'detach' })
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

    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
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

  function updateTitleBarOverlayColors(): void {
    if (process.platform !== 'win32') return

    const dark = nativeTheme.shouldUseDarkColors
    const color = dark ? '#2e3440' : '#f8f7f4'
    const symbolColor = dark ? '#eceff4' : '#1c1917'
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
    sendWindowEvent,
    broadcastWindowEvent,
    updateTitleBarOverlayColors
  }
}
