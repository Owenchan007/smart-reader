import { net } from 'electron'
import { BrowserWindow } from 'electron'

interface ChatMessage {
  role: string
  content: string
}

interface ChatParams {
  messages: ChatMessage[]
  model?: string
  apiKey: string
}

const API_URL = 'https://api.lkeap.cloud.tencent.com/coding/v3/chat/completions'

export async function chatWithAIStream(params: ChatParams): Promise<string> {
  const { messages, model = 'hunyuan-turbos', apiKey } = params
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]

  console.log('[AI] Sending stream request, model:', model, 'messages:', messages.length)

  const fetchFn = net.fetch ?? globalThis.fetch
  const response = await fetchFn(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[AI] API error:', response.status, errorText)
    throw new Error(`AI API 错误 (${response.status}): ${errorText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')

  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Process complete SSE lines
    const lines = buffer.split('\n')
    // Keep the last potentially incomplete line in buffer
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue

      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          fullContent += delta
          // Send chunk to renderer
          if (win && !win.isDestroyed()) {
            win.webContents.send('ai:stream-chunk', delta)
          }
        }
      } catch {}
    }
  }

  // Signal stream end
  if (win && !win.isDestroyed()) {
    win.webContents.send('ai:stream-end')
  }

  console.log('[AI] Stream complete, total chars:', fullContent.length)
  return fullContent
}
