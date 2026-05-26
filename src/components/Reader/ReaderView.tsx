import React, { useEffect, useRef, useState, useCallback } from 'react'
import ePub from 'epubjs'
import { Button, Tooltip, message } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined, HighlightOutlined, ZoomInOutlined, ZoomOutOutlined, RotateRightOutlined, CloseOutlined, UndoOutlined } from '@ant-design/icons'
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
  const { currentBook, rightPanel, readerSettings, setCurrentChapter: setStoreChapter, currentChapterLabel } = useStore()
  const [selectionPopup, setSelectionPopup] = useState<{ x: number; y: number; text: string } | null>(null)
  const [imageViewer, setImageViewer] = useState<{ src: string; zoom: number; rotation: number } | null>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<any>(null)
  const bookRef = useRef<any>(null)
  const [toc, setToc] = useState<Array<{ label: string; href: string; subitems?: any[] }>>([])
  const [activeTocHref, setActiveTocHref] = useState('')
  const [loading, setLoading] = useState(true)
  const tocRef = useRef<Array<{ label: string; href: string }>>([])
  /** Map<section.href, iframe>: built incrementally on 'rendered' to scroll-spy across iframes. */
  const sectionIframesRef = useRef(new Map<string, HTMLIFrameElement>())
  const activeTocHrefRef = useRef('')
  const scrollContainerRef = useRef<HTMLElement | null>(null)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)

  const draggingRef = useRef<'sidebar' | 'right' | null>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  /**
   * Scroll-spy: figure out which TOC entry is currently being read by comparing each
   * anchor element's viewport-Y against a trigger line (~100px below the reader top).
   * Handles sub-section accuracy: TOC entries with #anchor land on real DOM elements,
   * entries without anchors fall back to the iframe's body.
   */
  const findActiveTocEntry = useCallback(() => {
    const viewer = viewerRef.current
    const flat = tocRef.current
    if (!viewer || !flat.length || !sectionIframesRef.current.size) return

    const triggerY = viewer.getBoundingClientRect().top + 100
    let bestHref = ''
    let bestLabel = ''
    let bestTop = -Infinity

    // Resolve TOC file href → iframe via the section map, tolerating path-prefix differences.
    const findIframe = (file: string): HTMLIFrameElement | undefined => {
      const map = sectionIframesRef.current
      if (map.has(file)) return map.get(file)
      const baseFile = file.split('/').pop() || file
      for (const [secHref, iframe] of map.entries()) {
        const baseSec = secHref.split('/').pop() || secHref
        if (baseSec === baseFile) return iframe
        if (secHref.endsWith(file) || file.endsWith(secHref)) return iframe
      }
      return undefined
    }

    for (const toc of flat) {
      const [file, hash] = toc.href.split('#')
      const iframe = findIframe(file)
      const doc = iframe?.contentDocument
      if (!iframe || !doc) continue

      let element: Element | null = null
      if (hash) {
        element = doc.getElementById(hash) || doc.querySelector(`[name="${hash}"]`)
      }
      if (!element) element = doc.body
      if (!element) continue

      const elRect = element.getBoundingClientRect()
      const iframeRect = iframe.getBoundingClientRect()
      // iframe rect is viewport-relative; element rect is iframe-viewport-relative.
      // Their tops add up to the element's effective viewport Y.
      const elTop = iframeRect.top + elRect.top

      // Pick the deepest anchor that has already scrolled past the trigger line.
      if (elTop <= triggerY && elTop > bestTop) {
        bestTop = elTop
        bestHref = toc.href
        bestLabel = toc.label || ''
      }
    }

    if (bestHref && bestHref !== activeTocHrefRef.current) {
      activeTocHrefRef.current = bestHref
      setActiveTocHref(bestHref)
      setStoreChapter(bestHref, bestLabel)
    }
  }, [setStoreChapter])

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
      'img': {
        'max-width': '100% !important',
        'height': 'auto !important',
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

        // Monkey-patch: fix epubjs failing on extensionless XHTML files.
        // When a file has no extension, archive.request() can't determine
        // the type and returns raw text instead of a parsed XMLDocument.
        // We patch it to try XHTML parsing for spine item URLs.
        const archive = (book as any).archive
        if (archive) {
          const spineHrefs = new Set<string>()
          const spine = (book as any).spine
          if (spine?.items) {
            spine.items.forEach((item: any) => {
              if (item.url) spineHrefs.add(item.url)
            })
          }

          const origRequest = archive.request.bind(archive)
          archive.request = function(url: string, type?: string) {
            // For spine items without extension, force XHTML type
            if (!type && spineHrefs.has(url)) {
              const ext = url.split('.').pop()
              const hasExt = ext && ext !== url && ext.length <= 5 && /^[a-z]+$/i.test(ext)
              if (!hasExt) {
                return origRequest(url, 'xhtml')
              }
            }
            return origRequest(url, type)
          }
        }

        if (viewerRef.current) viewerRef.current.innerHTML = ''

        const rendition = book.renderTo(viewerRef.current!, {
          width: '100%', height: '100%',
          spread: 'none', flow: 'scrolled-continuous',
          manager: 'continuous', allowScriptedContent: true,
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
          }
          // Active chapter highlight is driven by findActiveTocEntry on scroll, not here.
        })

        // Build section.href → iframe map as each spine item lands. The map is what
        // lets findActiveTocEntry resolve TOC anchors to real DOM nodes.
        rendition.on('rendered', (section: any, view: any) => {
          const iframe = view?.iframe || view?.window?.frameElement
          if (iframe && section?.href) {
            sectionIframesRef.current.set(section.href, iframe)
            // Defer: iframe content may still be settling (fonts, images).
            setTimeout(findActiveTocEntry, 200)
          }
        })

        // Text selection popup
        rendition.on('selected', (cfiRange: string) => {
          setTimeout(() => {
            const iframe = viewerRef.current?.querySelector('iframe')
            if (!iframe?.contentWindow) return
            const selection = iframe.contentWindow.getSelection()
            const text = selection?.toString().trim()
            if (!text) return

            const range = selection!.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            const iframeRect = iframe.getBoundingClientRect()

            setSelectionPopup({
              x: iframeRect.left + rect.left + rect.width / 2,
              y: iframeRect.top + rect.top - 8,
              text,
            })
          }, 10)
        })

        // Image click to open viewer
        rendition.on('click', (e: MouseEvent) => {
          const target = e.target as HTMLElement
          if (target.tagName === 'IMG') {
            const img = target as HTMLImageElement
            setImageViewer({ src: img.src, zoom: 1, rotation: 0 })
          }
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
      sectionIframesRef.current.clear()
      activeTocHrefRef.current = ''
      setActiveTocHref('')
    }
  }, [currentBook])

  useEffect(() => { applyTheme() }, [applyTheme])

  // Close selection popup when clicking outside it (both main doc and iframe)
  useEffect(() => {
    if (!selectionPopup) return
    const handleDown = (e: MouseEvent) => {
      const popup = document.querySelector('.selection-popup')
      if (popup && popup.contains(e.target as Node)) return
      setSelectionPopup(null)
    }
    document.addEventListener('mousedown', handleDown)

    const iframe = viewerRef.current?.querySelector('iframe')
    const iframeDoc = iframe?.contentDocument
    iframeDoc?.addEventListener('mousedown', handleDown)

    return () => {
      document.removeEventListener('mousedown', handleDown)
      iframeDoc?.removeEventListener('mousedown', handleDown)
    }
  }, [selectionPopup])

  // Resize rendition when sidebar or right panel toggles
  useEffect(() => {
    // Small delay to let CSS layout settle before epubjs recalculates
    const timer = setTimeout(() => {
      renditionRef.current?.resize()
      findActiveTocEntry()
    }, 50)
    return () => clearTimeout(timer)
  }, [sidebarOpen, rightPanel, findActiveTocEntry])

  // Scroll-spy: attach a scroll listener to whatever epubjs uses as its scroll
  // container, throttle via rAF, and recompute the active TOC entry as the user reads.
  useEffect(() => {
    if (loading || !viewerRef.current) return

    const findScrollableEl = (): HTMLElement | null => {
      const container = viewerRef.current!.querySelector('.epub-container') as HTMLElement | null
      if (container && container.scrollHeight > container.clientHeight) return container
      const viewer = viewerRef.current!
      if (viewer.scrollHeight > viewer.clientHeight) return viewer
      return container || viewer
    }

    let raf = 0
    let cleanup: (() => void) | null = null

    const timer = setTimeout(() => {
      const el = findScrollableEl()
      if (!el) return
      scrollContainerRef.current = el
      const onScroll = () => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(findActiveTocEntry)
      }
      el.addEventListener('scroll', onScroll, { passive: true })
      findActiveTocEntry() // initial run after first paint
      cleanup = () => {
        el.removeEventListener('scroll', onScroll)
        cancelAnimationFrame(raf)
      }
    }, 500)

    return () => {
      clearTimeout(timer)
      cleanup?.()
    }
  }, [loading, findActiveTocEntry])

  // Re-run scroll-spy when theme/font changes — layout shifts can move anchors.
  useEffect(() => {
    const t = setTimeout(findActiveTocEntry, 300)
    return () => clearTimeout(t)
  }, [readerSettings, findActiveTocEntry])

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

  const handleAddToNotes = async () => {
    if (!selectionPopup || !currentBook) return
    await window.electronAPI.createNote({
      bookId: currentBook.id,
      chapter: currentChapterLabel || '',
      content: selectionPopup.text,
      source: 'highlight',
    })
    message.success('已添加到笔记')
    setSelectionPopup(null)
    window.dispatchEvent(new Event('notes-updated'))
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
                className={`toc-item ${item.href === activeTocHref ? 'active' : ''}`}
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

      {/* Selection popup */}
      {selectionPopup && (
        <div
          className="selection-popup"
          style={{ top: selectionPopup.y, left: selectionPopup.x }}
        >
          <div className="selection-popup-item" onClick={handleAddToNotes}>
            <HighlightOutlined style={{ marginRight: 6 }} />
            添加到笔记
          </div>
        </div>
      )}

      {/* Image viewer */}
      {imageViewer && (
        <div className="image-viewer-overlay" onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('image-viewer-overlay')) setImageViewer(null)
        }}>
          <div className="image-viewer-toolbar">
            <button className="iv-btn" title="放大"
              onClick={() => setImageViewer(v => v && { ...v, zoom: Math.min(v.zoom + 0.25, 5) })}>
              <ZoomInOutlined />
            </button>
            <button className="iv-btn" title="缩小"
              onClick={() => setImageViewer(v => v && { ...v, zoom: Math.max(v.zoom - 0.25, 0.25) })}>
              <ZoomOutOutlined />
            </button>
            <button className="iv-btn" title="旋转"
              onClick={() => setImageViewer(v => v && { ...v, rotation: v.rotation + 90 })}>
              <RotateRightOutlined />
            </button>
            <button className="iv-btn" title="重置"
              onClick={() => setImageViewer(v => v && { ...v, zoom: 1, rotation: 0 })}>
              <UndoOutlined />
            </button>
            <button className="iv-btn" title="关闭"
              onClick={() => setImageViewer(null)}>
              <CloseOutlined />
            </button>
          </div>
          <div className="image-viewer-content">
            <img
              src={imageViewer.src}
              style={{
                transform: `scale(${imageViewer.zoom}) rotate(${imageViewer.rotation}deg)`,
                transition: 'transform 0.2s ease',
              }}
              draggable={false}
              onWheel={(e) => {
                e.stopPropagation()
                setImageViewer(v => v && {
                  ...v,
                  zoom: Math.min(5, Math.max(0.25, v.zoom + (e.deltaY < 0 ? 0.15 : -0.15))),
                })
              }}
            />
          </div>
        </div>
      )}

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
