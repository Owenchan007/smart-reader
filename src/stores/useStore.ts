import { create } from 'zustand'

interface ReaderSettings {
  fontSize: number
  fontFamily: string
  theme: 'light' | 'warm' | 'dark'
}

interface AppState {
  // Current book
  currentBook: Book | null
  setCurrentBook: (book: Book | null) => void

  // View
  view: 'library' | 'reader'
  setView: (view: 'library' | 'reader') => void

  // Right panel
  rightPanel: 'none' | 'chat' | 'notes'
  setRightPanel: (panel: 'none' | 'chat' | 'notes') => void

  // Reader settings
  readerSettings: ReaderSettings
  setReaderSettings: (settings: Partial<ReaderSettings>) => void

  // API key
  apiKey: string
  setApiKey: (key: string) => void

  // AI model
  aiModel: string
  setAiModel: (model: string) => void

  // Current chapter info
  currentChapter: string
  currentChapterLabel: string
  setCurrentChapter: (href: string, label: string) => void
}

export const useStore = create<AppState>((set) => ({
  currentBook: null,
  setCurrentBook: (book) => set({ currentBook: book }),

  view: 'library',
  setView: (view) => set({ view }),

  rightPanel: 'none',
  setRightPanel: (panel) => set((state) => ({
    rightPanel: state.rightPanel === panel ? 'none' : panel,
  })),

  readerSettings: {
    fontSize: 18,
    fontFamily: 'system-ui',
    theme: 'light',
  },
  setReaderSettings: (settings) =>
    set((state) => ({
      readerSettings: { ...state.readerSettings, ...settings },
    })),

  apiKey: '',
  setApiKey: (apiKey) => set({ apiKey }),

  aiModel: 'hunyuan-turbos',
  setAiModel: (aiModel) => set({ aiModel }),

  currentChapter: '',
  currentChapterLabel: '',
  setCurrentChapter: (href, label) => set({ currentChapter: href, currentChapterLabel: label }),
}))
