import React, { useEffect, useState, useCallback } from 'react'
import { Button, message, Popconfirm, Empty } from 'antd'
import { PlusOutlined, DeleteOutlined, BookOutlined } from '@ant-design/icons'
import { useStore } from '../../stores/useStore'

const Library: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const { setCurrentBook, setView } = useStore()

  const loadBooks = useCallback(async () => {
    const list = await window.electronAPI.getBooks()
    setBooks(list)
  }, [])

  useEffect(() => {
    loadBooks()
  }, [loadBooks])

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
    // Fetch latest from DB to get up-to-date last_position
    const latest = await window.electronAPI.getBook(book.id)
    setCurrentBook(latest || book)
    setView('reader')
  }

  const handleDelete = async (id: number) => {
    await window.electronAPI.deleteBook(id)
    message.success('已删除')
    loadBooks()
  }

  return (
    <div className="library-container">
      <div className="library-header">
        <h2>我的书库</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleImport}
          loading={loading}
        >
          导入 EPUB
        </Button>
      </div>

      {books.length === 0 ? (
        <Empty
          image={<BookOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
          description="还没有书籍，点击上方按钮导入 EPUB 文件"
          style={{ marginTop: 120 }}
        />
      ) : (
        <div className="book-grid">
          {books.map((book) => (
            <div key={book.id} className="book-card">
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
          ))}
        </div>
      )}
    </div>
  )
}

export default Library
