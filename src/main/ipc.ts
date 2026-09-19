import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { JobStatus, PlanRequest, SyncConfigsFile, SyncProgress } from '@shared/sync-types'
import { ConfigStore, resolveConfigFilePath } from './sync/configStore'
import { PlanSessionStore } from './sync/planSession'
import { SyncExecutor } from './sync/executor'
import { buildPlan } from './sync/scanner'

/** 进度事件最小发送间隔（毫秒），避免高频刷新拖慢渲染进程 */
const PROGRESS_THROTTLE_MS = 100

export function registerIpcHandlers(): void {
  const configStore = new ConfigStore(resolveConfigFilePath())
  const sessions = new PlanSessionStore()
  let executor: SyncExecutor | null = null

  ipcMain.handle('dialog:pickDirectory', async (event: IpcMainInvokeEvent, title?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: title ?? '选择目录',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle('config:load', () => configStore.load())

  ipcMain.handle('config:save', (_event, file: SyncConfigsFile) => {
    configStore.save(file)
  })

  ipcMain.handle('sync:plan', async (_event, req: PlanRequest) => {
    const draft = await buildPlan(req)
    return sessions.create(draft)
  })

  ipcMain.handle('sync:start', (event: IpcMainInvokeEvent, planId: string) => {
    if (executor?.running) {
      throw new Error('已有同步任务在执行中')
    }
    const plan = sessions.take(planId)
    if (!plan) {
      throw new Error('同步计划已失效，请重新生成预览')
    }
    let lastSent = 0
    const onProgress = (p: SyncProgress): void => {
      const now = Date.now()
      if (now - lastSent < PROGRESS_THROTTLE_MS && p.current < p.total) {
        return
      }
      lastSent = now
      if (!event.sender.isDestroyed()) {
        event.sender.send('sync:progress', p)
      }
    }
    executor = new SyncExecutor(plan, onProgress)
    return executor.run().finally(() => {
      executor = null
    })
  })

  ipcMain.handle('sync:cancel', () => {
    if (!executor?.running) {
      return { canceled: false }
    }
    executor.cancel()
    return { canceled: true }
  })

  ipcMain.handle('sync:status', (): JobStatus | null => {
    return executor?.running ? executor.status : null
  })

  ipcMain.handle('shell:openPath', async (_event, p: string) => {
    const err = await shell.openPath(p)
    if (err) {
      throw new Error(err)
    }
  })

  ipcMain.handle('shell:showInFolder', (_event, p: string) => {
    shell.showItemInFolder(p)
  })
}
