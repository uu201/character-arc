import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import {
  createWorkspacePreUpgradeBackup,
  pruneWorkspaceUpgradeBackups,
  readWorkspaceSchemaMarker,
  restoreWorkspaceUpgradeBackup,
  writeWorkspaceSchemaMarker
} from './workspace-upgrade-backup'
import {
  getWorkspaceDirPath,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceUpgradeProgress
} from './workspace-store'

type UpgradeWindowState = {
  title: string
  message: string
  detail: string
  percent: number
  failed: boolean
  restored: boolean
  backupDir: string
}

export type WorkspaceUpgradeLaunchResult = {
  window: BrowserWindow | null
  blocked: boolean
  initializeMarkerAfterLaunch: boolean
}

export async function prepareWorkspaceForLaunch(): Promise<WorkspaceUpgradeLaunchResult> {
  const workspaceDir = getWorkspaceDirPath()
  const databasePath = join(workspaceDir, 'workspace.db')
  if (!existsSync(databasePath)) {
    return { window: null, blocked: false, initializeMarkerAfterLaunch: true }
  }

  const marker = await readWorkspaceSchemaMarker(workspaceDir)
  const fromSchemaVersion = marker?.schemaVersion ?? 1
  if (fromSchemaVersion === WORKSPACE_SCHEMA_VERSION) {
    return { window: null, blocked: false, initializeMarkerAfterLaunch: false }
  }

  const controller = await createUpgradeWindow()
  if (fromSchemaVersion > WORKSPACE_SCHEMA_VERSION) {
    controller.fail(
      '当前应用版本过旧',
      `数据库版本为 ${fromSchemaVersion}，当前应用仅支持到 ${WORKSPACE_SCHEMA_VERSION}。请安装更新版本后重试。`
    )
    return { window: controller.window, blocked: true, initializeMarkerAfterLaunch: false }
  }

  let backupDir = ''
  try {
    controller.update({
      title: '正在准备升级',
      message: '正在检查旧版本数据…',
      detail: `数据库结构 ${fromSchemaVersion} → ${WORKSPACE_SCHEMA_VERSION}`,
      percent: 3
    })
    const backup = await createWorkspacePreUpgradeBackup({
      workspaceDir,
      appVersion: app.getVersion(),
      fromSchemaVersion,
      toSchemaVersion: WORKSPACE_SCHEMA_VERSION,
      onProgress: (progress) => controller.update({
        title: '正在备份旧版本数据',
        message: progress.message,
        detail: `${formatBytes(progress.currentBytes)} / ${formatBytes(progress.totalBytes)}`,
        percent: 5 + Math.round(progress.percent * 0.35)
      })
    })
    backupDir = backup.backupDir
    controller.setBackupDir(backupDir)
    controller.update({
      title: '备份已验证',
      message: '升级前备份已通过完整性检查。',
      detail: backupDir,
      percent: 42
    })

    await runUpgradeWorker(workspaceDir, (progress) => {
      controller.update({
        title: '正在升级数据库',
        message: progress.message,
        detail: progress.total > 0
          ? `${progress.current.toLocaleString()} / ${progress.total.toLocaleString()}`
          : '正在处理数据库结构',
        percent: 45 + Math.round(progress.percent * 0.5)
      })
    })

    await writeWorkspaceSchemaMarker(workspaceDir, {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      appVersion: app.getVersion(),
      upgradedAt: new Date().toISOString()
    })
    await pruneWorkspaceUpgradeBackups(workspaceDir, 5)
    controller.complete({
      title: '升级完成',
      message: '数据检查完成，正在启动工作区…',
      detail: `升级前备份：${backupDir}`,
      percent: 100
    })
    return { window: controller.window, blocked: false, initializeMarkerAfterLaunch: false }
  } catch (error) {
    controller.fail(
      '数据库升级失败',
      error instanceof Error ? error.message : '数据库升级失败',
      backupDir
    )
    return { window: controller.window, blocked: true, initializeMarkerAfterLaunch: false }
  }
}

export async function markFreshWorkspaceInitialized(): Promise<void> {
  await writeWorkspaceSchemaMarker(getWorkspaceDirPath(), {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    appVersion: app.getVersion(),
    upgradedAt: new Date().toISOString()
  })
}

async function runUpgradeWorker(
  workspaceDir: string,
  onProgress: (progress: WorkspaceUpgradeProgress) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const worker = new Worker(new URL('./workspace-upgrade-worker.js', import.meta.url), {
      workerData: { workspaceDir }
    })
    worker.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return
      const payload = message as {
        type?: string
        progress?: WorkspaceUpgradeProgress
        error?: string
      }
      if (payload.type === 'progress' && payload.progress) {
        onProgress(payload.progress)
        return
      }
      if (settled) return
      if (payload.type === 'complete') {
        settled = true
        resolve()
      } else if (payload.type === 'error') {
        settled = true
        reject(new Error(payload.error || '数据库升级失败'))
      }
    })
    worker.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    worker.once('exit', (code) => {
      if (settled) return
      settled = true
      if (code === 0) resolve()
      else reject(new Error(`数据库升级进程异常退出，代码 ${code}`))
    })
  })
}

async function createUpgradeWindow(): Promise<{
  window: BrowserWindow
  update: (state: Partial<UpgradeWindowState>) => void
  setBackupDir: (path: string) => void
  complete: (state: Partial<UpgradeWindowState>) => void
  fail: (title: string, message: string, backupDir?: string) => void
}> {
  let allowClose = false
  let backupDir = ''
  let state: UpgradeWindowState = {
    title: '正在准备升级',
    message: '正在检查旧版本数据…',
    detail: '',
    percent: 1,
    failed: false,
    restored: false,
    backupDir: ''
  }
  const window = new BrowserWindow({
    width: 600,
    height: 420,
    minWidth: 560,
    minHeight: 380,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f4ef',
    title: '弧光 · 数据升级',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.on('close', (event) => {
    if (!allowClose) event.preventDefault()
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('characterarc-upgrade://')) return
    event.preventDefault()
    const action = url.slice('characterarc-upgrade://'.length).replace(/\/$/, '')
    if (action === 'retry') {
      app.relaunch()
      app.exit(0)
    } else if (action === 'open-backup') {
      void shell.openPath(backupDir || join(getWorkspaceDirPath(), 'backups/pre-upgrade'))
    } else if (action === 'restore' && backupDir) {
      allowClose = false
      update({
        title: '正在恢复旧数据库',
        message: '正在恢复升级前备份，请勿关闭应用…',
        detail: backupDir,
        failed: false
      })
      void restoreWorkspaceUpgradeBackup(getWorkspaceDirPath(), backupDir)
        .then(({ failedUpgradeDir }) => {
          allowClose = true
          update({
            title: '旧数据已恢复',
            message: '升级前数据库已经恢复。请退出应用并保留备份，待修复版本发布后再升级。',
            detail: `失败升级数据已保留在：${failedUpgradeDir}`,
            failed: true,
            restored: true
          })
        })
        .catch((error) => {
          allowClose = true
          update({
            title: '恢复失败',
            message: error instanceof Error ? error.message : '恢复升级前备份失败',
            detail: backupDir,
            failed: true
          })
        })
    } else if (action === 'exit') {
      allowClose = true
      app.exit(0)
    }
  })
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildUpgradeHtml())}`)
  window.show()

  const render = (): void => {
    if (window.isDestroyed()) return
    void window.webContents.executeJavaScript(
      `window.__characterArcUpgradeUpdate(${JSON.stringify(state)})`,
      true
    )
  }
  const update = (next: Partial<UpgradeWindowState>): void => {
    state = { ...state, ...next, percent: Math.max(state.percent, Math.min(100, Number(next.percent ?? state.percent))) }
    render()
  }
  render()
  return {
    window,
    update,
    setBackupDir: (path) => {
      backupDir = path
      update({ backupDir: path })
    },
    complete: (next) => {
      allowClose = true
      update({ ...next, failed: false, restored: false })
    },
    fail: (title, message, path = backupDir) => {
      allowClose = true
      backupDir = path
      update({ title, message, detail: path, failed: true, restored: false, backupDir: path })
    }
  }
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function buildUpgradeHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>弧光 · 数据升级</title>
  <style>
    :root { color-scheme: light; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; background: #f4f5f7; color: #20242b; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f7; }
    main { width: min(520px, calc(100vw - 48px)); padding: 30px 32px; border: 1px solid #e2e5e9; border-radius: 14px; background: #fff; box-shadow: 0 12px 34px #1f29370d; animation: arrive .25s ease-out both; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; color: #737983; font-size: 13px; font-weight: 600; }
    .mark { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; color: white; background: #343a46; font-size: 13px; }
    h1 { margin: 0 0 9px; font-size: 23px; font-weight: 650; letter-spacing: -.02em; }
    #message { margin: 0; color: #666d78; font-size: 14px; line-height: 1.6; min-height: 23px; }
    .meter { margin-top: 27px; height: 6px; overflow: hidden; border-radius: 99px; background: #e9ecf0; }
    #fill { height: 100%; width: 1%; border-radius: inherit; background: #956044; transition: width .25s ease; }
    .failed #fill { background: #b74b45; }
    .meta { margin-top: 9px; display: flex; justify-content: space-between; gap: 20px; color: #8a9099; font-size: 12px; }
    #detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
    .note { margin-top: 22px; padding: 12px 14px; border-radius: 9px; background: #f6f7f9; color: #737983; font-size: 12px; line-height: 1.6; }
    .actions { display: none; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .failed .actions { display: flex; }
    button { border: 1px solid #dfe2e6; border-radius: 8px; padding: 9px 13px; font: inherit; font-size: 13px; cursor: pointer; color: #4c535d; background: #fff; }
    button:hover { background: #f4f5f7; }
    button.primary { border-color: #343a46; color: white; background: #343a46; }
    button.primary:hover { background: #282d36; }
    @keyframes arrive { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  </style>
</head>
<body>
  <main id="app">
    <div class="brand"><span class="mark">弧</span><span>弧光 · 数据安全升级</span></div>
    <h1 id="title">正在准备升级</h1>
    <p id="message">正在检查旧版本数据…</p>
    <div class="meter"><div id="fill"></div></div>
    <div class="meta"><span id="percent">1%</span><span id="detail"></span></div>
    <div class="note" id="note">升级前会先备份旧数据库。数据量较大时可能需要几分钟，请勿强制关闭应用。</div>
    <div class="actions">
      <button id="retryButton" class="primary" onclick="location.href='characterarc-upgrade://retry'">重新尝试</button>
      <button id="restoreButton" onclick="location.href='characterarc-upgrade://restore'">恢复旧数据</button>
      <button id="backupButton" onclick="location.href='characterarc-upgrade://open-backup'">打开备份目录</button>
      <button onclick="location.href='characterarc-upgrade://exit'">退出应用</button>
    </div>
  </main>
  <script>
    window.__characterArcUpgradeUpdate = function (state) {
      document.getElementById('title').textContent = state.title || '';
      document.getElementById('message').textContent = state.message || '';
      document.getElementById('detail').textContent = state.detail || '';
      document.getElementById('percent').textContent = Math.round(state.percent || 0) + '%';
      document.getElementById('fill').style.width = Math.max(1, state.percent || 0) + '%';
      document.getElementById('app').classList.toggle('failed', Boolean(state.failed));
      document.getElementById('note').textContent = state.restored
        ? '旧数据库已经恢复，升级失败后的数据库也已单独保留。请退出应用后再处理版本更新。'
        : state.failed
        ? '升级没有继续写入数据库。你可以重新尝试、恢复旧数据，或打开备份目录检查数据。'
        : '升级前会先备份旧数据库。数据量较大时可能需要几分钟，请勿强制关闭应用。';
      document.getElementById('backupButton').style.display = state.backupDir ? '' : 'none';
      document.getElementById('restoreButton').style.display = state.backupDir && !state.restored ? '' : 'none';
      document.getElementById('retryButton').style.display = state.restored ? 'none' : '';
    };
  </script>
</body>
</html>`
}
