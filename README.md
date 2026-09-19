# SyncDirectory · 目录同步工具

[![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license-许可证)

**简体中文** | [English](#english)

一个简洁、安全的 Windows 桌面目录同步工具。选择源目录和目标目录，预览将要复制/删除的文件，确认后一键同步。基于 Electron + Vue 3 + TypeScript 构建。

---

## 简体中文

### 功能特性

- **目录同步**：选择源目录与目标目录，将源目录内容同步到目标目录
- **两种同步模式**
  - **增量同步**：只把源目录中有、目标目录中没有的文件复制过去，不删除、不覆盖目标目录中的任何文件
  - **完全同步**（镜像）：复制缺少的文件，并删除目标目录中多余的内容，使源与目标完全一致
- **两种目录结构**
  - **原始结构**：目标目录保持与源目录相同的层级结构
  - **平铺模式**：忽略源目录层级，所有文件以原始文件名直接放到目标根目录；仅当出现同名冲突时，用“名称(字节数)”区分（如 `b(1024).txt`）
- **智能跳过**：文件名和文件大小都相同的文件视为同一个文件，直接跳过，不做浪费时间的覆盖复制
- **同步预览**：点击生成预览后，先展示待复制 / 待删除 / 已跳过的完整列表，确认无误再开始同步（预览即所执行）
- **回收站保护**：可选开启"删除时移入回收站"，防止误删（更安全，速度稍慢）
- **实时进度**：同步过程中显示进度条、当前处理的文件路径，可随时取消
- **配置管理**：源/目标目录与各种模式可保存为配置，支持重命名、加载、删除；配置文件存放在用户数据目录（`%APPDATA%\SyncDirectory`），升级或重装应用后配置保留
- **启动即最大化**，界面简洁（Element Plus），中文界面

### 同步模式 × 目录结构

| | 原始结构 | 平铺 |
| --- | --- | --- |
| **增量同步** | 按源目录层级复制目标缺少的文件，不删除不覆盖 | 文件以原始文件名平铺复制到目标根目录，不删除不覆盖（目标已有子目录被忽略） |
| **完全同步** | 复制缺失文件并删除目标多余内容，两目录完全一致 | 文件以原始文件名平铺到目标根目录，并删除目标中的子目录与多余文件 |

> 同名但大小不同的文件：原始结构下，增量同步跳过并记录原因、完全同步覆盖复制；平铺模式下改用“名称(字节数)”命名（如 `b(1024).txt`），两个版本都保留。
>
> 平铺模式下，源内同名同大小的文件视为同一文件，只复制一份；目标中已存在同名同大小或“名称(大小)”命名的文件时视为已同步，不再复制。同名但类型不同（一边是文件、一边是目录）的情况会按类型冲突处理并给出提示。

### 安全机制

- 拒绝源目录与目标目录相同或互为父子目录的配置，避免误操作
- 自动跳过符号链接 / junction，防止递归失控
- 预览列表基于一次性会话生成，点击"开始同步"执行的正是预览所见内容
- 可选回收站删除；删除前列表二次确认

### 下载使用

从 [Releases](../../releases) 下载，或自行构建免安装版：

```bash
npm run build:unpack
```

构建产物为绿色免安装版：`disk/win-unpacked/SyncDirectory.exe`，无需安装，整个 `win-unpacked` 文件夹拷贝到任意位置即可运行。

配置文件 `syncdirectory.config.json` 存放在用户数据目录（`%APPDATA%\SyncDirectory`）；旧版本存放在 exe 同级目录的配置会在首次启动时自动迁移。

### 从源码运行

环境要求：Node.js 20+（推荐 22）

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev

# 构建免安装版（输出到 disk/win-unpacked）
npm run build:unpack

# 构建安装包 / 其他平台
npm run build:win
npm run build:mac
npm run build:linux

# 代码检查
npm run typecheck
npm run lint
npm run format
```

### 项目结构

```
src/
├── shared/          # 主进程 / 渲染进程共享类型
├── main/            # 主进程
│   ├── sync/        #   同步核心：configStore / scanner / executor / planSession
│   └── ipc.ts       #   IPC 通道注册
└── renderer/        # 渲染进程（Vue 3 + Element Plus）
    ├── components/  #   配置列表 / 设置表单 / 预览面板 / 进度面板
    └── composables/ #   useSync 状态编排
```

### 技术栈

Electron 39 · Vue 3 · TypeScript · Element Plus · electron-vite · electron-builder

## English

**简体中文** | [English](#english)

A simple and safe desktop directory sync tool for Windows. Pick a source and a target directory, preview what will be copied/deleted, then sync with one click. Built with Electron + Vue 3 + TypeScript.

### Features

- **Directory sync**: sync the content of a source directory into a target directory
- **Two sync modes**
  - **Incremental**: only copy files that exist in the source but not in the target; never deletes or overwrites anything in the target
  - **Full (mirror)**: copy missing files and delete extra ones, making the target identical to the source
- **Two layout modes**
  - **Original**: keep the same folder hierarchy as the source
  - **Flat**: ignore the hierarchy and copy all files into the target root keeping their original names; only on name conflicts a size suffix is used (`b(1024).txt`)
- **Smart skipping**: files with the same name and the same size are considered identical and skipped — no wasteful overwrites
- **Sync preview**: generate a preview first — complete lists of files to copy / delete / skip — then start the sync after confirmation (what you preview is exactly what runs)
- **Recycle bin protection**: optionally move deletions to the recycle bin (safer, slightly slower)
- **Live progress**: progress bar, current file path, and cancel support while syncing
- **Config management**: save directory pairs and modes as named configs; rename, load, and delete them. The config file lives in the user data directory (`%APPDATA%\SyncDirectory`), so it survives app upgrades and reinstalls
- **Maximized on startup**, clean UI (Element Plus), Chinese interface

### Sync Mode × Layout

| | Original | Flat |
| --- | --- | --- |
| **Incremental** | Copy missing files following the source hierarchy; no delete, no overwrite | Copy all files flat into the target root keeping original names; no delete, no overwrite (existing subdirectories are ignored) |
| **Full** | Copy missing files and delete extras — both directories end up identical | Put all files flat into the target root with original names and delete subdirectories/extras |

> Files with the same name but different sizes: in Original layout they are skipped (with reasons logged) in incremental mode and overwritten in full mode; in Flat layout the copy is named `name(size)` (e.g. `b(1024).txt`) so both versions are kept.
>
> In Flat layout, source files sharing the same name and size count as one file — only a single copy is made; a target file matching the same name+size or the `name(size)` form is treated as already synced. Name collisions between a file and a directory are treated as type conflicts with warnings.

### Safety

- Rejects configurations where the source and target are the same directory or nested inside each other
- Skips symlinks/junctions to prevent runaway recursion
- The preview is backed by a one-shot session — pressing "Start Sync" executes exactly what was previewed
- Optional recycle bin deletion; delete list requires explicit confirmation

### Download & Usage

Grab a build from [Releases](../../releases), or build the portable version yourself:

```bash
npm run build:unpack
```

The output is a portable (installer-free) app at `disk/win-unpacked/SyncDirectory.exe` — copy the whole `win-unpacked` folder anywhere and run it.

The config file `syncdirectory.config.json` is stored in the user data directory (`%APPDATA%\SyncDirectory`); configs from older versions (stored next to the exe) are migrated automatically on first launch.

### Development

Requires Node.js 20+ (22 recommended).

```bash
# Install dependencies
npm install

# Start in development mode (HMR)
npm run dev

# Build portable unpacked app (output: disk/win-unpacked)
npm run build:unpack

# Build installers / other platforms
npm run build:win
npm run build:mac
npm run build:linux

# Lint & check
npm run typecheck
npm run lint
npm run format
```

### Project Structure

```
src/
├── shared/          # Types shared between main & renderer
├── main/            # Main process
│   ├── sync/        #   Core: configStore / scanner / executor / planSession
│   └── ipc.ts       #   IPC channel registration
└── renderer/        # Renderer (Vue 3 + Element Plus)
    ├── components/  #   Config list / settings form / preview panel / progress panel
    └── composables/ #   useSync state orchestration
```

### Tech Stack

Electron 39 · Vue 3 · TypeScript · Element Plus · electron-vite · electron-builder

## License · 许可证

[MIT](https://opensource.org/licenses/MIT)
