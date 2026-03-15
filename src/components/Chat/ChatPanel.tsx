import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Button, message, Spin, Tag, Collapse } from 'antd'
import {
  SendOutlined, ClearOutlined, UnorderedListOutlined, FileTextOutlined,
  DownOutlined,
} from '@ant-design/icons'
import { marked } from 'marked'
import { useStore } from '../../stores/useStore'

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true })

interface Props {
  bookId: number
}

const MODEL_CHAR_LIMITS: Record<string, number> = {
  'kimi-k2.5': 200000,
  'hunyuan-2.0-thinking': 60000,
  'hunyuan-turbos': 28000,
  'glm-4-plus': 100000,
  'minimax': 80000,
}

const MarkdownBubble: React.FC<{ content: string }> = ({ content }) => {
  const html = useMemo(() => {
    try {
      return marked.parse(content || '') as string
    } catch {
      return content
    }
  }, [content])

  return (
    <div
      className="bubble markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const ChatPanel: React.FC<Props> = ({ bookId }) => {
  const { apiKey, aiModel, currentBook, currentChapterLabel } = useStore()
  const [messages, setMessages] = useState<Conversation[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [bookText, setBookText] = useState('')
  const [bookLoading, setBookLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamingRef = useRef('')

  useEffect(() => {
    window.electronAPI.getConversations(bookId).then(setMessages)

    setBookLoading(true)
    window.electronAPI.getChunksForBook(bookId).then((chunks) => {
      const fullText = chunks.map((c: any) => c.content).join('')
      setBookText(fullText)
      setBookLoading(false)
    })
  }, [bookId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const getBookContext = () => {
    const charLimit = MODEL_CHAR_LIMITS[aiModel] || 28000
    const maxBookChars = charLimit - 2000
    if (bookText.length <= maxBookChars) return bookText
    return bookText.slice(0, maxBookChars) + '\n\n[...书籍内容过长，已截取前部分...]'
  }

  const getSystemPrompt = () => {
    const bookTitle = currentBook?.title || '未知书名'
    const bookAuthor = currentBook?.author || '未知作者'
    return [
      `你是一个智能读书助手。用户正在阅读《${bookTitle}》（作者：${bookAuthor}）。`,
      `以下是这本书的完整内容（或主要内容），请基于此回答用户的任何问题。`,
      `回答时尽量引用书中原文，并标注大致出处（如章节名）。`,
      '',
      '=== 书籍内容开始 ===',
      getBookContext(),
      '=== 书籍内容结束 ===',
    ].join('\n')
  }

  /** Send a message and get streaming reply, appending both to chat history */
  const sendMessage = async (userContent: string) => {
    if (!apiKey) { message.warning('请先在设置中配置 API Key'); return }

    setStreamingContent('')
    streamingRef.current = ''

    // Add user message
    await window.electronAPI.saveMessage({ bookId, role: 'user', content: userContent })
    const userMsg: Conversation = {
      id: Date.now(), book_id: bookId, role: 'user',
      content: userContent, created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    const removeChunk = window.electronAPI.onStreamChunk((chunk) => {
      streamingRef.current += chunk
      setStreamingContent(streamingRef.current)
    })
    const removeEnd = window.electronAPI.onStreamEnd(() => {})

    try {
      const fullReply = await window.electronAPI.chatWithAI({
        messages: [
          { role: 'system', content: getSystemPrompt() },
          ...messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: userContent },
        ],
        model: aiModel,
        apiKey,
      })

      const finalContent = fullReply || streamingRef.current
      await window.electronAPI.saveMessage({ bookId, role: 'assistant', content: finalContent })
      setMessages((prev) => [...prev, {
        id: Date.now() + 1, book_id: bookId, role: 'assistant',
        content: finalContent, created_at: new Date().toISOString(),
      }])
      setStreamingContent('')
      streamingRef.current = ''
    } catch (err: any) {
      const errMsg = err.message || String(err)
      if (errMsg.includes('401') || errMsg.includes('403')) {
        message.error('API Key 无效或已过期，请在设置中检查')
      } else {
        message.error(`AI 回答失败: ${errMsg}`)
      }
      if (streamingRef.current) {
        setMessages((prev) => [...prev, {
          id: Date.now() + 1, book_id: bookId, role: 'assistant',
          content: streamingRef.current, created_at: new Date().toISOString(),
        }])
        setStreamingContent('')
        streamingRef.current = ''
      }
    }

    removeChunk()
    removeEnd()
    setLoading(false)
  }

  const handleSend = () => {
    const question = input.trim()
    if (!question) return
    setInput('')
    sendMessage(question)
  }

  const handleOutline = () => {
    sendMessage([
      '请为这本书提炼一个完整的内容框架，帮助我快速预习和理解全书结构。要求：',
      '1. 先用一两句话概括全书主题',
      '2. 列出全书的章节结构，每章用一句话概括核心内容',
      '3. 标注各章节之间的逻辑关系（递进/并列/因果等）',
      '4. 最后总结全书的核心论点或故事主线',
      '请用清晰的层级结构呈现，使用 Markdown 格式。',
    ].join('\n'))
  }

  const handleChapterSummary = () => {
    if (!currentChapterLabel) {
      message.info('请先翻到某个章节再点击总结')
      return
    }
    sendMessage([
      `请总结当前章节「${currentChapterLabel}」的内容。要求：`,
      '1. 用 2-3 句话概括本章核心内容',
      '2. 列出本章的关键要点（3-5 个）',
      '3. 如有重要概念或术语，简要解释',
      '4. 本章与前后章节的关联（如果能判断）',
      '请用 Markdown 格式输出，简洁清晰。',
    ].join('\n'))
  }

  const handleClear = async () => {
    await window.electronAPI.clearConversations(bookId)
    setMessages([])
    message.success('对话已清空')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const bookCharCount = bookText.length
  const charLimit = MODEL_CHAR_LIMITS[aiModel] || 28000
  const isFull = bookCharCount <= charLimit

  return (
    <>
      <div className="right-panel-header">
        <span>AI 问答</span>
        <Button type="text" icon={<ClearOutlined />} onClick={handleClear} size="small">
          清空
        </Button>
      </div>

      <div className="chat-messages">
        {/* Book status */}
        <div style={{ padding: '8px 0', textAlign: 'center', fontSize: 12, color: '#999' }}>
          {bookLoading ? (
            <span><Spin size="small" /> 正在加载书籍内容...</span>
          ) : (
            <span>
              已加载 {(bookCharCount / 10000).toFixed(1)} 万字
              {isFull ? (
                <Tag color="green" style={{ marginLeft: 8 }}>全书已载入</Tag>
              ) : (
                <Tag color="orange" style={{ marginLeft: 8 }}>
                  已载入前 {(charLimit / 10000).toFixed(0)} 万字
                </Tag>
              )}
            </span>
          )}
        </div>

        {messages.length === 0 && !bookLoading && !streamingContent && (
          <div style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>
            <p>向 AI 提问关于这本书的任何问题</p>
            <p style={{ fontSize: 12, marginTop: 8 }}>AI 已读取书籍内容，可直接提问</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            {msg.role === 'assistant' ? (
              <MarkdownBubble content={msg.content} />
            ) : (
              <div className="bubble">{msg.content}</div>
            )}
          </div>
        ))}

        {streamingContent && (
          <div className="chat-message assistant">
            <MarkdownBubble content={streamingContent} />
          </div>
        )}

        {loading && !streamingContent && (
          <div className="chat-message assistant">
            <div className="bubble"><Spin size="small" /> 思考中...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions - collapsible above input */}
      <div className="quick-actions-container">
        <Collapse
          size="small"
          expandIcon={({ isActive }) => <DownOutlined rotate={isActive ? 180 : 0} style={{ fontSize: 11 }} />}
          items={[{
            key: 'tools',
            label: (
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                AI 快捷工具
                {currentChapterLabel && (
                  <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
                    当前：{currentChapterLabel}
                  </span>
                )}
              </span>
            ),
            children: (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  icon={<UnorderedListOutlined />}
                  onClick={handleOutline}
                  disabled={loading || bookLoading}
                  size="small"
                  block
                >
                  提炼全书框架
                </Button>
                <Button
                  icon={<FileTextOutlined />}
                  onClick={handleChapterSummary}
                  disabled={loading || bookLoading || !currentChapterLabel}
                  size="small"
                  block
                >
                  总结当前章节
                </Button>
              </div>
            ),
          }]}
        />
      </div>

      {/* Chat input */}
      <div className="chat-input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题... (Enter 发送, Shift+Enter 换行)"
          rows={2}
          disabled={loading || bookLoading}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={loading}
          disabled={bookLoading}
        />
      </div>
    </>
  )
}

export default ChatPanel
