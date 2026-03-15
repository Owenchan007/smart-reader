declare module 'epubjs'
declare module 'epubjs/types/book'
declare module 'epubjs/types/rendition'

interface Book {
  id: number
  title: string
  author: string
  file_path: string
  cover_image: string | null
  last_position: string
  created_at: string
  updated_at: string
}

interface Chunk {
  id: number
  book_id: number
  chapter: string
  content: string
  position: number
}

interface Note {
  id: number
  book_id: number
  chapter: string
  content: string
  raw_voice_text: string
  source: string
  created_at: string
  updated_at: string
}

interface Conversation {
  id: number
  book_id: number
  role: string
  content: string
  created_at: string
}

interface ElectronAPI {
  importBook: () => Promise<{ filePath: string; originalPath: string } | null>
  importBookFull: () => Promise<{ bookId: number; title: string } | null>
  getBooks: () => Promise<Book[]>
  getBook: (id: number) => Promise<Book | undefined>
  deleteBook: (id: number) => Promise<boolean>
  readBookFile: (filePath: string) => Promise<ArrayBuffer>
  updateBookProgress: (id: number, position: string) => Promise<boolean>
  saveBookMetadata: (data: { filePath: string; title: string; author: string; coverImage?: string }) => Promise<number>
  saveChunks: (bookId: number, chunks: Array<{ chapter: string; content: string; position: number }>) => Promise<boolean>
  getChunksForBook: (bookId: number) => Promise<Chunk[]>
  searchChunks: (bookId: number, query: string) => Promise<Array<{ chapter: string; content: string }>>
  createNote: (note: { bookId: number; chapter: string; content: string; rawVoiceText?: string; source: string }) => Promise<number>
  getNotes: (bookId?: number) => Promise<Note[]>
  updateNote: (id: number, content: string) => Promise<boolean>
  deleteNote: (id: number) => Promise<boolean>
  saveMessage: (msg: { bookId: number; role: string; content: string }) => Promise<number>
  getConversations: (bookId: number) => Promise<Conversation[]>
  clearConversations: (bookId: number) => Promise<boolean>
  checkWhisperModel: (model: string) => Promise<boolean>
  downloadWhisperModel: (model: string, mirrorUrl?: string) => Promise<boolean>
  onWhisperDownloadProgress: (callback: (info: { percent: number; downloadedMB: number; totalMB: number }) => void) => () => void
  transcribeAudio: (audioData: Uint8Array) => Promise<string>
  chatWithAI: (params: { messages: Array<{ role: string; content: string }>; model?: string; apiKey: string }) => Promise<string>
  onStreamChunk: (callback: (chunk: string) => void) => () => void
  onStreamEnd: (callback: () => void) => () => void
  selectObsidianVault: () => Promise<string | null>
  exportBookToObsidian: (params: { bookId: number; apiKey: string; model?: string }) =>
    Promise<{ success: boolean; filesWritten: string[] }>
  exportAllToObsidian: (params: { apiKey: string; model?: string }) =>
    Promise<{ success: boolean; booksExported: number; filesWritten: string[] }>
  onExportProgress: (callback: (info: { step: number; total: number; message: string }) => void) => () => void
  getSettings: () => Promise<Record<string, string>>
  saveSetting: (key: string, value: string) => Promise<boolean>
}

interface Window {
  electronAPI: ElectronAPI
}
