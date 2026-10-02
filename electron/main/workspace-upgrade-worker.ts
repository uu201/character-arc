import { parentPort, workerData } from 'node:worker_threads'

import { ensureWorkspaceDb } from './workspace-store'

type WorkspaceUpgradeWorkerRequest = {
  workspaceDir: string
}

async function run(): Promise<void> {
  const request = workerData as WorkspaceUpgradeWorkerRequest
  try {
    process.env.CHARACTERARC_WORKSPACE_DIR = request.workspaceDir
    const db = await ensureWorkspaceDb({
      onUpgradeProgress: (progress) => parentPort?.postMessage({ type: 'progress', progress })
    })
    const quickCheck = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
    if (!quickCheck || !Object.values(quickCheck).some((value) => value === 'ok')) {
      throw new Error('升级后的数据库未通过完整性检查')
    }
    db.close()
    parentPort?.postMessage({ type: 'complete' })
  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : '数据库升级失败'
    })
  }
}

void run()
