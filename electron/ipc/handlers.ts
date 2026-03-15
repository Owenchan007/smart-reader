import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDb } from '../services/db'
import { copyBookToAppData, saveBookRecord, saveChunks, searchChunks, extractEpubContent } from '../services/epub-parser'
import { chatWithAIStream } from '../services/ai-client'
import { transcribeAudio, isModelDownloaded, downloadModel } from '../services/whisper'
import fs from 'fs'

export function registerIpcHandlers() {
  // === Book handlers ===
  ipcMain.handle('book:import', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'EPUB Files', extensions: ['epub'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const originalPath = result.filePaths[0]
    const filePath = copyBookToAppData(originalPath)

    // Return file path; metadata extraction happens in renderer with epubjs
    return { filePath, originalPath }
  })

  // Full import: file dialog + copy + extract metadata/cover/chunks + save to DB, all in main process
  ipcMain.handle('book:importFull', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'EPUB Files', extensions: ['epub'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const originalPath = result.filePaths[0]
    const filePath = copyBookToAppData(originalPath)

    try {
      const { title, author, coverBase64, chunks } = await extractEpubContent(filePath)
      const bookId = saveBookRecord(title, author, filePath, coverBase64 || undefined)
      if (chunks.length > 0) {
        saveChunks(bookId, chunks)
      }
      return { bookId, title }
    } catch (err: any) {
      // Clean up copied file on failure
      try { fs.unlinkSync(filePath) } catch {}
      throw err
    }
  })

  ipcMain.handle('book:list', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM books ORDER BY updated_at DESC').all()
  })

  ipcMain.handle('book:get', (_event, id: number) => {
    const db = getDb()
    return db.prepare('SELECT * FROM books WHERE id = ?').get(id)
  })

  ipcMain.handle('book:delete', (_event, id: number) => {
    const db = getDb()
    const book = db.prepare('SELECT file_path FROM books WHERE id = ?').get(id) as any
    if (book?.file_path) {
      try { fs.unlinkSync(book.file_path) } catch {}
    }
    db.prepare('DELETE FROM books WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('book:readFile', async (_event, filePath: string) => {
    // Return as Uint8Array for proper IPC serialization
    const buffer = fs.readFileSync(filePath)
    return new Uint8Array(buffer)
  })

  ipcMain.handle('book:updateProgress', (_event, id: number, position: string) => {
    const db = getDb()
    db.prepare('UPDATE books SET last_position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(position, id)
    return true
  })

  // Save book metadata (called from renderer after epubjs parses metadata)
  ipcMain.handle('book:saveMetadata', (_event, data: {
    filePath: string, title: string, author: string, coverImage?: string
  }) => {
    const bookId = saveBookRecord(data.title, data.author, data.filePath, data.coverImage)
    return bookId
  })

  // Save text chunks for AI search
  ipcMain.handle('book:saveChunks', (_event, bookId: number, chunks: Array<{
    chapter: string, content: string, position: number
  }>) => {
    saveChunks(bookId, chunks)
    return true
  })

  // === Chunk handlers ===
  ipcMain.handle('chunk:list', (_event, bookId: number) => {
    const db = getDb()
    return db.prepare('SELECT * FROM chunks WHERE book_id = ? ORDER BY position').all(bookId)
  })

  ipcMain.handle('chunk:search', (_event, bookId: number, query: string) => {
    return searchChunks(bookId, query)
  })

  // === Note handlers ===
  ipcMain.handle('note:create', (_event, note: {
    bookId: number; chapter: string; content: string; rawVoiceText?: string; source: string
  }) => {
    const db = getDb()
    const stmt = db.prepare(
      'INSERT INTO notes (book_id, chapter, content, raw_voice_text, source) VALUES (?, ?, ?, ?, ?)'
    )
    const result = stmt.run(note.bookId, note.chapter, note.content, note.rawVoiceText || '', note.source)
    return result.lastInsertRowid
  })

  ipcMain.handle('note:list', (_event, bookId?: number) => {
    const db = getDb()
    if (bookId) {
      return db.prepare('SELECT * FROM notes WHERE book_id = ? ORDER BY created_at DESC').all(bookId)
    }
    return db.prepare('SELECT * FROM notes ORDER BY created_at DESC').all()
  })

  ipcMain.handle('note:update', (_event, id: number, content: string) => {
    const db = getDb()
    db.prepare('UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(content, id)
    return true
  })

  ipcMain.handle('note:delete', (_event, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    return true
  })

  // === Conversation handlers ===
  ipcMain.handle('conversation:save', (_event, msg: {
    bookId: number; role: string; content: string
  }) => {
    const db = getDb()
    const stmt = db.prepare(
      'INSERT INTO conversations (book_id, role, content) VALUES (?, ?, ?)'
    )
    return stmt.run(msg.bookId, msg.role, msg.content).lastInsertRowid
  })

  ipcMain.handle('conversation:list', (_event, bookId: number) => {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM conversations WHERE book_id = ? ORDER BY created_at ASC'
    ).all(bookId)
  })

  ipcMain.handle('conversation:clear', (_event, bookId: number) => {
    const db = getDb()
    db.prepare('DELETE FROM conversations WHERE book_id = ?').run(bookId)
    return true
  })

  // === AI handler (streaming) ===
  ipcMain.handle('ai:chat', async (_event, params: {
    messages: Array<{ role: string; content: string }>; model?: string; apiKey: string
  }) => {
    try {
      return await chatWithAIStream(params)
    } catch (err: any) {
      console.error('[IPC ai:chat] Error:', err.message)
      throw err
    }
  })

  // === Whisper handlers ===
  ipcMain.handle('whisper:checkModel', (_event, model: string) => {
    return isModelDownloaded(model)
  })

  ipcMain.handle('whisper:downloadModel', async (_event, model: string, mirrorUrl?: string) => {
    const win = BrowserWindow.getFocusedWindow()
    await downloadModel(model, (percent, downloadedMB, totalMB) => {
      win?.webContents.send('whisper:download-progress', { percent, downloadedMB, totalMB })
    }, mirrorUrl)
    return true
  })

  ipcMain.handle('whisper:transcribe', async (_event, audioData: Uint8Array) => {
    try {
      const buffer = Buffer.from(audioData)
      return await transcribeAudio(buffer)
    } catch (err: any) {
      console.error('[IPC whisper] Error:', err.message)
      throw err
    }
  })

  // === Settings handlers ===
  ipcMain.handle('settings:get', () => {
    const db = getDb()
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return settings
  })

  ipcMain.handle('settings:save', (_event, key: string, value: string) => {
    const db = getDb()
    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(key, value)
    return true
  })
}
