import React, { useState, useEffect, useCallback } from 'react'
import { Button, Input, Popconfirm, message, Tag, Empty } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { marked } from 'marked'
import { useStore } from '../../stores/useStore'

marked.setOptions({ breaks: true, gfm: true })

/** SQLite CURRENT_TIMESTAMP is UTC without timezone suffix; append 'Z' so JS parses it correctly */
function parseDbTime(t: string): Date {
  if (!t) return new Date()
  return new Date(t.endsWith('Z') ? t : t + 'Z')
}

interface Props {
  bookId: number
}

const NotesPanel: React.FC<Props> = ({ bookId }) => {
  const { apiKey, aiModel } = useStore()
  const [notes, setNotes] = useState<Note[]>([])
  const [newNote, setNewNote] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [aiCleanup, setAiCleanup] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadNotes = useCallback(async () => {
    const list = await window.electronAPI.getNotes(bookId)
    setNotes(list)
  }, [bookId])

  useEffect(() => {
    loadNotes()
    const onRefresh = () => loadNotes()
    window.addEventListener('notes-updated', onRefresh)
    return () => window.removeEventListener('notes-updated', onRefresh)
  }, [loadNotes])

  const handleAddNote = async () => {
    const rawContent = newNote.trim()
    if (!rawContent) return

    setSaving(true)
    let finalContent = rawContent
    let source = 'text'

    if (aiCleanup && apiKey) {
      try {
        finalContent = await window.electronAPI.chatWithAI({
          messages: [
            {
              role: 'system',
              content: [
                '请将以下文本整理为条理清晰的笔记：',
                '1. 去除语气词（嗯、啊、那个、就是、然后、对吧、这个...）',
                '2. 修正口语化表达为书面语',
                '3. 保持原意不变，按逻辑分段',
                '4. 如果有明显的要点，用列表形式呈现',
                '5. 直接输出整理后的笔记内容，不要添加任何前言或说明',
              ].join('\n'),
            },
            { role: 'user', content: rawContent },
          ],
          model: aiModel,
          apiKey,
        })
        source = 'ai-cleaned'
      } catch {
        finalContent = rawContent
      }
    }

    await window.electronAPI.createNote({
      bookId,
      chapter: '',
      content: finalContent,
      rawVoiceText: aiCleanup ? rawContent : undefined,
      source,
    })
    setNewNote('')
    setSaving(false)
    loadNotes()
    message.success(aiCleanup ? 'AI 整理完成，笔记已保存' : '笔记已保存')
  }

  const handleDelete = async (id: number) => {
    await window.electronAPI.deleteNote(id)
    loadNotes()
  }

  const handleEdit = (note: Note) => {
    setEditingId(note.id)
    setEditContent(note.content)
  }

  const handleSaveEdit = async () => {
    if (editingId === null) return
    await window.electronAPI.updateNote(editingId, editContent)
    setEditingId(null)
    setEditContent('')
    loadNotes()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAddNote()
    }
  }

  return (
    <>
      <div className="right-panel-header">
        <span>笔记</span>
      </div>

      <div className="notes-list">
        {notes.length === 0 && (
          <Empty description="暂无笔记" style={{ marginTop: 40 }} />
        )}
        {notes.map((note) => (
          <div key={note.id} className="note-item">
            {editingId === note.id ? (
              <>
                <Input.TextArea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={4}
                  autoFocus
                />
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <Button size="small" icon={<SaveOutlined />} onClick={handleSaveEdit}>
                    保存
                  </Button>
                  <Button size="small" onClick={() => setEditingId(null)}>
                    取消
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div
                  className="note-content markdown-body"
                  dangerouslySetInnerHTML={{ __html: marked.parse(note.content || '') as string }}
                />
                {note.raw_voice_text && note.raw_voice_text !== note.content && (
                  <details style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
                    <summary style={{ cursor: 'pointer' }}>查看原始文本</summary>
                    <div style={{ marginTop: 4, padding: 6, background: '#fafafa', borderRadius: 4 }}>
                      {note.raw_voice_text}
                    </div>
                  </details>
                )}
                <div className="note-meta">
                  <span>{parseDbTime(note.created_at).toLocaleString('zh-CN')}</span>
                  {note.source === 'ai-cleaned' && (
                    <Tag color="purple" style={{ marginLeft: 8 }}>AI 整理</Tag>
                  )}
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(note)}
                    style={{ marginLeft: 8 }}
                  />
                  <Popconfirm
                    title="确定删除？"
                    onConfirm={() => handleDelete(note.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                  </Popconfirm>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="note-input-area">
        <Input.TextArea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={aiCleanup ? undefined : handleKeyDown}
          placeholder={aiCleanup ? '输入口语化内容，AI 会帮你整理成书面笔记...' : '写下你的想法... (Enter 保存)'}
          rows={3}
          disabled={saving}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <Button
            type={aiCleanup ? 'primary' : 'default'}
            icon={<ThunderboltOutlined />}
            onClick={() => setAiCleanup(!aiCleanup)}
            disabled={!apiKey}
            title={!apiKey ? '需要先配置 API Key' : aiCleanup ? '关闭 AI 整理' : '开启 AI 整理'}
            style={aiCleanup ? {} : { color: '#999' }}
          >
            AI 整理
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddNote}
            style={{ flex: 1 }}
            disabled={!newNote.trim() || saving}
            loading={saving}
          >
            {saving ? 'AI 整理中...' : aiCleanup ? 'AI 整理并保存' : '添加笔记'}
          </Button>
        </div>
      </div>
    </>
  )
}

export default NotesPanel
