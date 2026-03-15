import React, { useEffect, useRef, useState, useCallback } from 'react'
import ePub from 'epubjs'
import { Button, Tooltip } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { useStore } from '../../stores/useStore'
import ChatPanel from '../Chat/ChatPanel'
import NotesPanel from '../Notes/NotesPanel'

const themeStyles: Record<string, { body: Record<string, string> }> = {
  light: { body: { background: '#ffffff', color: '#333333' } },
  warm: { body: { background: '#f5f0e8', color: '#4a4a4a' } },
  dark: { body: { background: '#1a1a2e', color: '#e0e0e0' } },
}

const MIN_PANEL_WIDTH = 200
const MAX_PANEL_WIDTH = 600
const DEFAULT_SIDEBAR_WIDTH = 260
const DEFAULT_RIGHT_WIDTH = 400

const ReaderView: React.FC = () => {
  const { currentBook, rightPanel, readerSettings, setCurrentChapter: setStoreChapter } = useStore()
  const viewerRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<any>(null)
  const bookRef = useRef<any>(null)
  const [toc, setToc] = useState<Array<{ label: string; href: string; subitems?: any[] }>>([])
  const [currentChapterHref, setCurrentChapterHref] = useState('')
  const [loading, setLoading] = useState(true)
  const tocRef = useRef<Array<{ label: string; href: string }>>([])

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)

  const draggingRef = useRef<'sidebar' | 'right' | null>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const applyTheme = useCallback(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    const theme = themeStyles[readerSettings.theme] || themeStyles.light
    rendition.themes.default({
      body: {
        ...theme.body,
        'font-size': `${readerSettings.fontSize}px !important`,
        'font-family': `${readerSettings.fontFamily} !important`,
        'line-height': '1.8 !important',
        'padding': '20px 40px !important',
      },
      'p, div, span, li, h1, h2, h3, h4, h5, h6': {
        'font-size': `${readerSettings.fontSize}px !important`,
        'font-family': `${readerSettings.fontFamily} !important`,
      },
    })
  }, [readerSettings])

  useEffect(() => {
    if (!currentBook || !viewerRef.current) return
    let destroyed = false

    const loadBook = async () => {
      setLoading(true)
      try {
        const data = await window.electronAPI.readBookFile(currentBook.file_path)
        if (destroyed) return

        const uint8 = new Uint8Array(data)
        const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength)
        const book = ePub(arrayBuffer)
        bookRef.current = book
        await book.ready

        if (viewerRef.current) viewerRef.current.innerHTML = ''

        const rendition = book.renderTo(viewerRef.current!, {
          width: '100%', height: '100%',
          spread: 'none', flow: 'scrolled-doc', allowScriptedContent: true,
        })
        renditionRef.current = rendition
        applyTheme()

        if (currentBook.last_position) {
          await rendition.display(currentBook.last_position)
        } else {
          await rendition.display()
        }

        const navigation = await book.loaded.navigation
        const tocItems = navigation.toc || []
        setToc(tocItems)

        const flat: Array<{ label: string; href: string }> = []
        const flatten = (items: any[]) => {
          for (const item of items) {
            flat.push({ label: item.label?.trim(), href: item.href })
            if (item.subitems) flatten(item.subitems)
          }
        }
        flatten(tocItems)
        tocRef.current = flat
        setLoading(false)

        rendition.on('relocated', (location: any) => {
          if (location?.start?.cfi) {
            window.electronAPI.updateBookProgress(currentBook.id, location.start.cfi)
            const href = location.start.href
            if (href) {
              setCurrentChapterHref(href)
              const match = tocRef.current.find((t) => href.includes(t.href) || t.href.includes(href))
              setStoreChapter(href, match?.label || '')
            }
          }
        })

        rendition.on('keyup', (e: KeyboardEvent) => {
          if (e.key === 'ArrowLeft') rendition.prev()
          if (e.key === 'ArrowRight') rendition.next()
        })
      } catch (err) {
        console.error('Failed to load book:', err)
        setLoading(false)
      }
    }

    loadBook()
    return () => {
      destroyed = true
      renditionRef.current?.destroy()
      renditionRef.current = null
      bookRef.current?.destroy()
      bookRef.current = null
    }
  }, [currentBook])

  useEffect(() => { applyTheme() }, [applyTheme])

  // Resize rendition when sidebar or right panel toggles
  useEffect(() => {
    // Small delay to let CSS layout settle before epubjs recalculates
    const timer = setTimeout(() => renditionRef.current?.resize(), 50)
    return () => clearTimeout(timer)
  }, [sidebarOpen, rightPanel])

  // Drag resize — use document-level listeners
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      e.preventDefault()
      const delta = e.clientX - startXRef.current

      if (draggingRef.current === 'sidebar') {
        setSidebarWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidthRef.current + delta)))
      } else {
        setRightWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidthRef.current - delta)))
      }
    }

    const onMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = null
        setIsDragging(false)
        document.body.style.cursor = ''
        // Tell epubjs to recalculate layout after resize
        renditionRef.current?.resize()
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const startDrag = (panel: 'sidebar' | 'right', e: React.MouseEvent) => {
    draggingRef.current = panel
    startXRef.current = e.clientX
    startWidthRef.current = panel === 'sidebar' ? sidebarWidth : rightWidth
    document.body.style.cursor = 'col-resize'
    setIsDragging(true)
  }

  const goToChapter = (href: string) => {
    renditionRef.current?.display(href)
  }

  const flattenToc = (items: typeof toc, depth = 0): Array<{ label: string; href: string; depth: number }> => {
    const result: Array<{ label: string; href: string; depth: number }> = []
    for (const item of items) {
      result.push({ label: item.label, href: item.href, depth })
      if (item.subitems && item.subitems.length > 0) {
        result.push(...flattenToc(item.subitems, depth + 1))
      }
    }
    return result
  }

  const flatToc = flattenToc(toc)

  return (
    <div className="reader-container">
      {/* Drag overlay — covers iframes during resize so mouse events aren't swallowed */}
      {isDragging && <div className="drag-overlay" />}

      {/* TOC Sidebar */}
      {sidebarOpen && (
        <>
          <div className="reader-sidebar" style={{ width: sidebarWidth }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>目录</h3>
              <Tooltip title="收起目录">
                <Button type="text" size="small" icon={<MenuFoldOutlined />} onClick={() => setSidebarOpen(false)} />
              </Tooltip>
            </div>
            {flatToc.length === 0 && !loading && (
              <div style={{ color: '#999', fontSize: 13 }}>此书无目录信息</div>
            )}
            {flatToc.map((item, idx) => (
              <div
                key={idx}
                className={`toc-item ${currentChapterHref.includes(item.href) ? 'active' : ''}`}
                onClick={() => goToChapter(item.href)}
                title={item.label}
                style={{ paddingLeft: 12 + item.depth * 16 }}
              >
                {item.label.trim()}
              </div>
            ))}
          </div>
          <div className="resize-handle" onMouseDown={(e) => startDrag('sidebar', e)} />
        </>
      )}

      {!sidebarOpen && (
        <div className="sidebar-toggle-collapsed">
          <Tooltip title="展开目录" placement="right">
            <Button type="text" size="small" icon={<MenuUnfoldOutlined />} onClick={() => setSidebarOpen(true)} />
          </Tooltip>
        </div>
      )}

      {/* Main reader area */}
      <div className="reader-main">
        <div className={`reader-content theme-${readerSettings.theme}`}>
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999' }}>
              加载中...
            </div>
          )}
          <div ref={viewerRef} style={{ width: '100%', height: '100%', overflow: 'auto' }} />
        </div>
      </div>

      {/* Right panel */}
      {rightPanel !== 'none' && currentBook && (
        <>
          <div className="resize-handle" onMouseDown={(e) => startDrag('right', e)} />
          <div className="right-panel" style={{ width: rightWidth }}>
            {rightPanel === 'chat' && <ChatPanel bookId={currentBook.id} />}
            {rightPanel === 'notes' && <NotesPanel bookId={currentBook.id} />}
          </div>
        </>
      )}
    </div>
  )
}

export default ReaderView
