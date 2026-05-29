# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # 启动开发服务器 (Vite + Electron hot reload)
npm run build        # TypeScript 编译 → Vite 构建 → electron-builder 打包 (.dmg)
npm run typecheck    # 类型检查 (tsc --noEmit)
```

安装依赖后需要重建原生模块：`npx electron-rebuild -f -w better-sqlite3`

## Architecture

Electron 桌面应用，三进程架构：

- **Main Process** (`electron/`) — 窗口管理、SQLite 数据库、所有业务逻辑服务
- **Preload** (`electron/preload.ts`) — 通过 `contextBridge` 暴露 `window.electronAPI` 给渲染进程
- **Renderer** (`src/`) — React 18 + Zustand 状态管理 + Ant Design UI

### IPC 通信

两种模式：
1. **请求-响应** (`ipcMain.handle` / `ipcRenderer.invoke`) — 书籍、笔记、对话、设置等 CRUD 操作
2. **事件流** (`webContents.send` / `ipcRenderer.on`) — AI 流式回答 (`ai:stream-chunk/end`)、Obsidian 导出进度

### Services (`electron/services/`)

| 服务 | 职责 |
|------|------|
| `db.ts` | SQLite (WAL 模式)，表：books, chunks, notes, conversations, settings |
| `ai-client.ts` | DeepSeek API (`https://api.deepseek.com`，OpenAI 兼容)，流式 (`chatWithAIStream`) + 非流式 (`chatWithAISimple`) |
| `epub-parser.ts` | JSZip 解压 EPUB，提取元数据/封面/章节内容，生成可检索文本块 |
| `obsidian-export.ts` | 生成 Markdown 文件导出到 Obsidian 知识库 |

### 添加新功能的典型流程

1. `electron/services/` 中实现业务逻辑
2. `electron/ipc/handlers.ts` 中注册 IPC handler
3. `electron/preload.ts` 中暴露 API 方法
4. `src/types.d.ts` 中添加 `ElectronAPI` 类型声明
5. `src/components/` 中调用 `window.electronAPI.*`

### 状态管理 (`src/stores/useStore.ts`)

Zustand store 管理：当前书籍、视图状态、右侧面板、阅读器设置、API Key、AI 模型、当前章节、章节问题缓存。

### AI 上下文策略 (`src/components/Chat/ChatPanel.tsx`)

- 短书 (≤ 模型字符限制)：全文模式，直接发送完整内容
- 长书：智能检索模式，当前章节内容 (40%) + 关键词搜索相关段落 + 书籍开头

## Tech Stack

Electron 33 · React 18 · TypeScript 5.6 · Vite 6 · Zustand 5 · Ant Design 5 · epub.js · better-sqlite3 · electron-builder (macOS dmg)
