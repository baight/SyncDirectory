import { app } from 'electron'
import { dirname, join } from 'path'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type { SyncConfigItem, SyncConfigsFile } from '@shared/sync-types'

/** 配置文件路径：打包后放 exe 同级目录，开发模式放项目根目录 */
export function resolveConfigFilePath(): string {
  if (app.isPackaged) {
    return join(dirname(app.getPath('exe')), 'syncdirectory.config.json')
  }
  return join(app.getAppPath(), 'syncdirectory.config.json')
}

/** 配置列表持久化（JSON，原子写） */
export class ConfigStore {
  readonly #filePath: string

  constructor(filePath: string) {
    this.#filePath = filePath
  }

  get configPath(): string {
    return this.#filePath
  }

  load(): SyncConfigsFile {
    if (!existsSync(this.#filePath)) {
      return { version: 1, items: [] }
    }
    try {
      const raw = JSON.parse(readFileSync(this.#filePath, 'utf-8')) as SyncConfigsFile
      if (!Array.isArray(raw.items)) {
        throw new Error('items is not an array')
      }
      return { version: 1, items: raw.items }
    } catch {
      // 文件损坏时改名备份，返回默认值，避免覆盖丢失原始数据
      try {
        renameSync(this.#filePath, `${this.#filePath}.bak`)
      } catch {
        // ignore
      }
      return { version: 1, items: [] }
    }
  }

  save(file: SyncConfigsFile): void {
    const tmp = `${this.#filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8')
    renameSync(tmp, this.#filePath)
  }

  addItem(item: SyncConfigItem): SyncConfigsFile {
    const file = this.load()
    file.items.push(item)
    this.save(file)
    return file
  }

  removeItem(id: string): SyncConfigsFile {
    const file = this.load()
    file.items = file.items.filter((i) => i.id !== id)
    this.save(file)
    return file
  }
}
