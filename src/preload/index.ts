import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  JobStatus,
  PlanRequest,
  SyncApi,
  SyncConfigsFile,
  SyncPlan,
  SyncProgress,
  SyncResult
} from '@shared/sync-types'

// 渲染进程可用的自定义 API
const api: SyncApi = {
  pickDirectory: (title?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickDirectory', title),
  loadConfigs: (): Promise<SyncConfigsFile> => ipcRenderer.invoke('config:load'),
  saveConfigs: (file: SyncConfigsFile): Promise<void> => ipcRenderer.invoke('config:save', file),
  planSync: (req: PlanRequest): Promise<SyncPlan> => ipcRenderer.invoke('sync:plan', req),
  startSync: (planId: string): Promise<SyncResult> => ipcRenderer.invoke('sync:start', planId),
  cancelSync: (): Promise<{ canceled: boolean }> => ipcRenderer.invoke('sync:cancel'),
  getSyncStatus: (): Promise<JobStatus | null> => ipcRenderer.invoke('sync:status'),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:openPath', path),
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke('shell:showInFolder', path),
  onSyncProgress: (cb: (p: SyncProgress) => void): (() => void) => {
    const listener = (_event: unknown, p: SyncProgress): void => cb(p)
    ipcRenderer.on('sync:progress', listener)
    return () => {
      ipcRenderer.removeListener('sync:progress', listener)
    }
  }
}

export type Api = SyncApi

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
