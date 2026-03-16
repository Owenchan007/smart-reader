import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Button, message, Popconfirm, Empty, Tooltip, Modal, Progress, Input } from 'antd'
import { PlusOutlined, DeleteOutlined, BookOutlined, ExportOutlined, EditOutlined } from '@ant-design/icons'
import { useStore } from '../../stores/useStore'

const Library: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState<number | 'all' | null>(null)
  const [exportProgress, setExportProgress] = useState({ step: 0, total: 0, message: '' })
  const [vaultPath, setVaultPath] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; book: Book } | null>(null)
  const [renaming, setRenaming] = useState<{ book: Book; title: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const { setCurrentBook, setView, apiKey, aiModel } = useStore()

  const loadBooks = useCallback(async () => {
    const list = await window.electronAPI.getBooks()
    setBooks(list)
  }, [])

  useEffect(() => {
    loadBooks()
    // Load saved vault path
    window.electronAPI.getSettings().then((s) => {
      if (s.obsidianVaultPath) setVaultPath(s.obsidianVaultPath)
    })
  }, [loadBooks])

  // Listen for export progress
  useEffect(() => {
    const unsub = window.electronAPI.onExportProgress((info) => {
      setExportProgress(info)
    })
    return unsub
  }, [])

  const handleImport = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.importBookFull()
      if (!result) {
        setLoading(false)
        return
      }
      message.success(`成功导入: ${result.title}`)
      await loadBooks()
    } catch (err: any) {
      message.error(`导入失败: ${err.message}`)
    }
    setLoading(false)
  }

  const handleOpenBook = async (book: Book) => {
    const latest = await window.electronAPI.getBook(book.id)
    setCurrentBook(latest || book)
    setView('reader')
  }

  const handleDelete = async (id: number) => {
    await window.electronAPI.deleteBook(id)
    message.success('已删除')
    loadBooks()
  }

  /** Ensure vault path is set, return path or null */
  const ensureVaultPath = async (): Promise<string | null> => {
    if (vaultPath) return vaultPath
    const selected = await window.electronAPI.selectObsidianVault()
    if (selected) {
      setVaultPath(selected)
      return selected
    }
    return null
  }

  const handleExportBook = async (book: Book) => {
    if (!apiKey) {
      message.warning('请先在设置中配置 API Key')
      return
    }
    const vault = await ensureVaultPath()
    if (!vault) return

    setExporting(book.id)
    setExportProgress({ step: 0, total: 0, message: '准备导出...' })
    try {
      const result = await window.electronAPI.exportBookToObsidian({
        bookId: book.id,
        apiKey,
        model: aiModel,
      })
      message.success(`《${book.title}》已导出到 Obsidian（${result.filesWritten.length} 个文件）`)
    } catch (err: any) {
      message.error(`导出失败: ${err.message}`)
    }
    setExporting(null)
  }

  const handleExportAll = async () => {
    if (!apiKey) {
      message.warning('请先在设置中配置 API Key')
      return
    }
    if (books.length === 0) {
      message.info('书库为空，没有可导出的书籍')
      return
    }
    const vault = await ensureVaultPath()
    if (!vault) return

    setExporting('all')
    setExportProgress({ step: 0, total: books.length, message: '准备导出...' })
    try {
      const result = await window.electronAPI.exportAllToObsidian({
        apiKey,
        model: aiModel,
      })
      message.success(`已导出 ${result.booksExported} 本书到 Obsidian`)
    } catch (err: any) {
      message.error(`导出失败: ${err.message}`)
    }
    setExporting(null)
  }

  // Right-click context menu
  const handleContextMenu = (e: React.MouseEvent, book: Book) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, book })
  }

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    if (contextMenu) {
      document.addEventListener('mousedown', handleClick)
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  const handleStartRename = (book: Book) => {
    setContextMenu(null)
    setRenaming({ book, title: book.title })
  }

  const handleConfirmRename = async () => {
    if (!renaming) return
    const newTitle = renaming.title.trim()
    if (!newTitle) {
      message.warning('书名不能为空')
      return
    }
    if (newTitle === renaming.book.title) {
      setRenaming(null)
      return
    }
    await window.electronAPI.renameBook(renaming.book.id, newTitle)
    message.success('书名已更新')
    setRenaming(null)
    loadBooks()
  }

  const handleChangeVault = async () => {
    const selected = await window.electronAPI.selectObsidianVault()
    if (selected) {
      setVaultPath(selected)
      message.success('Vault 路径已更新')
    }
  }

  return (
    <div className="library-container">
      <div className="library-header">
        <h2>我的书库</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            icon={<ExportOutlined />}
            onClick={handleExportAll}
            loading={exporting === 'all'}
            disabled={exporting !== null || books.length === 0}
          >
            导出到 Obsidian
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleImport}
            loading={loading}
          >
            导入 EPUB
          </Button>
        </div>
      </div>

      {/* Vault path display */}
      {vaultPath && (
        <div style={{ fontSize: 12, color: '#999', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Obsidian Vault：{vaultPath}</span>
          <Button type="link" size="small" onClick={handleChangeVault} style={{ fontSize: 12, padding: 0 }}>
            更改
          </Button>
        </div>
      )}

      {books.length === 0 ? (
        <Empty
          image={<BookOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
          description="还没有书籍，点击上方按钮导入 EPUB 文件"
          style={{ marginTop: 120 }}
        />
      ) : (
        <div className="book-grid">
          {books.map((book) => (
            <div key={book.id} className="book-card" onContextMenu={(e) => handleContextMenu(e, book)}>
              <div className="book-cover" onClick={() => handleOpenBook(book)}>
                {book.cover_image ? (
                  <img src={book.cover_image} alt={book.title} />
                ) : (
                  <span>{book.title}</span>
                )}
              </div>
              <div className="book-info">
                <div className="book-title" title={book.title}>{book.title}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="book-author">{book.author}</span>
                  <div>
                    <Tooltip title="导出到 Obsidian">
                      <Button
                        type="text"
                        size="small"
                        icon={<ExportOutlined />}
                        onClick={() => handleExportBook(book)}
                        loading={exporting === book.id}
                        disabled={exporting !== null}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="确定删除这本书？"
                      onConfirm={() => handleDelete(book.id)}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                    </Popconfirm>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="context-menu-item" onClick={() => handleStartRename(contextMenu.book)}>
            <EditOutlined style={{ marginRight: 8 }} />
            重命名
          </div>
        </div>
      )}

      {/* Rename modal */}
      <Modal
        open={renaming !== null}
        title="重命名书籍"
        okText="确定"
        cancelText="取消"
        onOk={handleConfirmRename}
        onCancel={() => setRenaming(null)}
        width={400}
      >
        <Input
          value={renaming?.title ?? ''}
          onChange={(e) => setRenaming(prev => prev ? { ...prev, title: e.target.value } : null)}
          onPressEnter={handleConfirmRename}
          autoFocus
          placeholder="请输入新书名"
          style={{ marginTop: 8 }}
        />
      </Modal>

      {/* Export progress modal */}
      <Modal
        open={exporting !== null}
        title="导出到 Obsidian"
        footer={null}
        closable={false}
        maskClosable={false}
        width={400}
      >
        <div style={{ padding: '12px 0' }}>
          <p style={{ marginBottom: 12 }}>{exportProgress.message}</p>
          {exportProgress.total > 0 && (
            <Progress
              percent={Math.round((exportProgress.step / exportProgress.total) * 100)}
              size="small"
              status="active"
              format={() => `${exportProgress.step} / ${exportProgress.total}`}
            />
          )}
        </div>
      </Modal>
    </div>
  )
}

export default Library
