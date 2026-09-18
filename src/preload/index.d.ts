import type { ElectronAPI } from '@electron-toolkit/preload'
import type { SyncApi } from '@shared/sync-types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: SyncApi
  }
}
