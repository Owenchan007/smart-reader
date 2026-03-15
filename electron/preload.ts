import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Book operations
  importBook: () => ipcRenderer.invoke('book:import'),
  importBookFull: () => ipcRenderer.invoke('book:importFull'),
  getBooks: () => ipcRenderer.invoke('book:list'),
  getBook: (id: number) => ipcRenderer.invoke('book:get', id),
  deleteBook: (id: number) => ipcRenderer.invoke('book:delete', id),
  readBookFile: (filePath: string) => ipcRenderer.invoke('book:readFile', filePath),
  updateBookProgress: (id: number, position: string) =>
    ipcRenderer.invoke('book:updateProgress', id, position),
  saveBookMetadata: (data: { filePath: string; title: string; author: string; coverImage?: string }) =>
    ipcRenderer.invoke('book:saveMetadata', data),
  saveChunks: (bookId: number, chunks: Array<{ chapter: string; content: string; position: number }>) =>
    ipcRenderer.invoke('book:saveChunks', bookId, chunks),

  // Chunk operations
  getChunksForBook: (bookId: number) => ipcRenderer.invoke('chunk:list', bookId),
  searchChunks: (bookId: number, query: string) =>
    ipcRenderer.invoke('chunk:search', bookId, query),

  // Note operations
  createNote: (note: { bookId: number; chapter: string; content: string; rawVoiceText?: string; source: string }) =>
    ipcRenderer.invoke('note:create', note),
  getNotes: (bookId?: number) => ipcRenderer.invoke('note:list', bookId),
  updateNote: (id: number, content: string) =>
    ipcRenderer.invoke('note:update', id, content),
  deleteNote: (id: number) => ipcRenderer.invoke('note:delete', id),

  // Conversation operations
  saveMessage: (msg: { bookId: number; role: string; content: string }) =>
    ipcRenderer.invoke('conversation:save', msg),
  getConversations: (bookId: number) =>
    ipcRenderer.invoke('conversation:list', bookId),
  clearConversations: (bookId: number) =>
    ipcRenderer.invoke('conversation:clear', bookId),

  // Whisper
  checkWhisperModel: (model: string) =>
    ipcRenderer.invoke('whisper:checkModel', model),
  downloadWhisperModel: (model: string, mirrorUrl?: string) =>
    ipcRenderer.invoke('whisper:downloadModel', model, mirrorUrl),
  onWhisperDownloadProgress: (callback: (info: { percent: number; downloadedMB: number; totalMB: number }) => void) => {
    const handler = (_event: any, info: { percent: number; downloadedMB: number; totalMB: number }) => callback(info)
    ipcRenderer.on('whisper:download-progress', handler)
    return () => ipcRenderer.removeListener('whisper:download-progress', handler)
  },
  transcribeAudio: (audioData: Uint8Array) =>
    ipcRenderer.invoke('whisper:transcribe', audioData),

  // AI operations
  chatWithAI: (params: { messages: Array<{ role: string; content: string }>; model?: string; apiKey: string }) =>
    ipcRenderer.invoke('ai:chat', params),
  onStreamChunk: (callback: (chunk: string) => void) => {
    const handler = (_event: any, chunk: string) => callback(chunk)
    ipcRenderer.on('ai:stream-chunk', handler)
    return () => ipcRenderer.removeListener('ai:stream-chunk', handler)
  },
  onStreamEnd: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('ai:stream-end', handler)
    return () => ipcRenderer.removeListener('ai:stream-end', handler)
  },

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSetting: (key: string, value: string) =>
    ipcRenderer.invoke('settings:save', key, value),
})
