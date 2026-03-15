import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Input, Popconfirm, message, Tag, Empty, Progress, Alert } from 'antd'
import { PlusOutlined, DeleteOutlined, AudioOutlined, EditOutlined, SaveOutlined, DownloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
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
  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState('')
  const [recordingTime, setRecordingTime] = useState(0)
  const [modelReady, setModelReady] = useState<boolean | null>(null) // null = checking
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState({ percent: 0, downloadedMB: 0, totalMB: 0 })
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadNotes = useCallback(async () => {
    const list = await window.electronAPI.getNotes(bookId)
    setNotes(list)
  }, [bookId])

  useEffect(() => {
    loadNotes()
  }, [loadNotes])

  // Check if whisper model is downloaded on mount
  useEffect(() => {
    window.electronAPI.checkWhisperModel('medium').then(setModelReady)
  }, [])

  // Listen for download progress
  useEffect(() => {
    const unsub = window.electronAPI.onWhisperDownloadProgress((info) => {
      setDownloadProgress(info)
    })
    return unsub
  }, [])

  const handleDownloadModel = async () => {
    setDownloading(true)
    setDownloadProgress({ percent: 0, downloadedMB: 0, totalMB: 0 })
    try {
      await window.electronAPI.downloadWhisperModel('medium')
      setModelReady(true)
      message.success('Whisper 模型下载完成！')
    } catch (err: any) {
      message.error(`模型下载失败: ${err.message}`)
    }
    setDownloading(false)
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

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

  const startRecording = async () => {
    // Double-check model is ready
    if (!modelReady) {
      const ready = await window.electronAPI.checkWhisperModel('medium')
      if (!ready) {
        message.warning('请先下载 Whisper 语音识别模型')
        setModelReady(false)
        return
      }
      setModelReady(true)
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      setRecordingTime(0)

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size < 1000) {
          message.warning('录音时间太短')
          return
        }
        await processVoiceNote(blob)
      }

      mediaRecorder.start(500) // collect data every 500ms
      setRecording(true)

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1)
      }, 1000)
    } catch (err) {
      message.error('无法访问麦克风，请检查系统权限')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  const processVoiceNote = async (audioBlob: Blob) => {
    setProcessing(true)

    try {
      // Step 1: Convert webm to wav using AudioContext
      setProcessingStep('转换音频格式...')
      const wavBuffer = await convertToWav(audioBlob)

      // Step 2: Send to Whisper for transcription
      setProcessingStep('Whisper 语音识别中...')
      const rawText = await window.electronAPI.transcribeAudio(new Uint8Array(wavBuffer))

      if (!rawText.trim()) {
        message.warning('未识别到语音内容')
        setProcessing(false)
        setProcessingStep('')
        return
      }

      // Step 3: AI cleanup (if API key available)
      let finalText = rawText
      if (apiKey) {
        setProcessingStep('AI 整理笔记...')
        try {
          finalText = await window.electronAPI.chatWithAI({
            messages: [
              {
                role: 'system',
                content: [
                  '请将以下语音转写文本整理为条理清晰的笔记：',
                  '1. 去除语气词（嗯、啊、那个、就是、然后、对吧、这个...）',
                  '2. 修正口语化表达为书面语',
                  '3. 保持原意不变，按逻辑分段',
                  '4. 如果有明显的要点，用列表形式呈现',
                  '5. 直接输出整理后的笔记内容，不要添加任何前言或说明',
                ].join('\n'),
              },
              { role: 'user', content: rawText },
            ],
            model: aiModel,
            apiKey,
          })
        } catch {
          // AI cleanup failed, use raw text
          finalText = rawText
        }
      }

      await window.electronAPI.createNote({
        bookId,
        chapter: '',
        content: finalText,
        rawVoiceText: rawText,
        source: 'voice',
      })

      loadNotes()
      message.success('语音笔记已保存')
    } catch (err: any) {
      console.error('Voice note error:', err)
      message.error(`语音处理失败: ${err.message}`)
    }

    setProcessing(false)
    setProcessingStep('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAddNote()
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return (
    <>
      <div className="right-panel-header">
        <span>笔记</span>
        <Button
          type={recording ? 'primary' : 'text'}
          danger={recording}
          icon={<AudioOutlined />}
          onClick={recording ? stopRecording : startRecording}
          loading={processing}
          disabled={modelReady === false && !downloading}
          size="small"
        >
          {recording ? `停止 ${formatTime(recordingTime)}` : processing ? processingStep : '语音笔记'}
        </Button>
      </div>

      <div className="notes-list">
        {/* Model download prompt */}
        {modelReady === false && !downloading && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="需要下载语音识别模型"
            description={
              <div>
                <div style={{ marginBottom: 8 }}>
                  首次使用语音笔记需要下载 Whisper Medium 模型（约 1.5 GB），下载后即可离线使用。
                </div>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleDownloadModel}
                  size="small"
                >
                  开始下载
                </Button>
              </div>
            }
          />
        )}

        {/* Model downloading progress */}
        {downloading && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="正在下载 Whisper 模型..."
            description={
              <div>
                <Progress
                  percent={downloadProgress.percent}
                  size="small"
                  status="active"
                  format={() => `${downloadProgress.downloadedMB} / ${downloadProgress.totalMB} MB`}
                />
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  下载完成后即可使用语音笔记功能
                </div>
              </div>
            }
          />
        )}

        {/* Recording indicator */}
        {recording && (
          <div className="note-item" style={{ borderColor: '#ff4d4f', background: '#fff2f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-block', width: 10, height: 10,
                borderRadius: '50%', background: '#ff4d4f',
                animation: 'pulse 1s infinite',
              }} />
              <span style={{ fontWeight: 600, color: '#ff4d4f' }}>
                录音中 {formatTime(recordingTime)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              说完后点击"停止"，将自动转写并整理
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {processing && (
          <div className="note-item" style={{ borderColor: '#1890ff', background: '#f0f8ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#1890ff', fontWeight: 600 }}>{processingStep}</span>
            </div>
          </div>
        )}

        {notes.length === 0 && !recording && !processing && (
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
                    <summary style={{ cursor: 'pointer' }}>
                      {note.source === 'voice' ? '查看原始语音' : '查看原始文本'}
                    </summary>
                    <div style={{ marginTop: 4, padding: 6, background: '#fafafa', borderRadius: 4 }}>
                      {note.raw_voice_text}
                    </div>
                  </details>
                )}
                <div className="note-meta">
                  <span>{parseDbTime(note.created_at).toLocaleString('zh-CN')}</span>
                  {note.source === 'voice' && (
                    <Tag color="blue" style={{ marginLeft: 8 }}>语音</Tag>
                  )}
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

/**
 * Convert audio blob (webm) to WAV format using AudioContext.
 * Whisper requires WAV input.
 */
async function convertToWav(blob: Blob): Promise<ArrayBuffer> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioContext = new AudioContext({ sampleRate: 16000 })
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

  // Get mono channel data
  const channelData = audioBuffer.getChannelData(0)
  const sampleRate = 16000

  // Create WAV file
  const wavBuffer = new ArrayBuffer(44 + channelData.length * 2)
  const view = new DataView(wavBuffer)

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + channelData.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)           // fmt chunk size
  view.setUint16(20, 1, true)            // PCM format
  view.setUint16(22, 1, true)            // mono
  view.setUint32(24, sampleRate, true)    // sample rate
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true)            // block align
  view.setUint16(34, 16, true)           // bits per sample
  writeString(36, 'data')
  view.setUint32(40, channelData.length * 2, true)

  // Write PCM samples
  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]))
    view.setInt16(44 + i * 2, sample * 0x7FFF, true)
  }

  await audioContext.close()
  return wavBuffer
}

export default NotesPanel
