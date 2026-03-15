import fs from 'fs'
import path from 'path'
import { getDb } from './db'
import { chatWithAISimple } from './ai-client'
import { BrowserWindow } from 'electron'

interface ExportParams {
  bookId: number
  vaultPath: string
  apiKey: string
  model?: string
}

interface Concept {
  name: string
  definition: string
  relevance: string
  related: string[]
}

/** Sanitize filename for cross-platform compatibility */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim()
}

/** Send progress to renderer */
function sendProgress(step: number, total: number, message: string) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send('obsidian:export-progress', { step, total, message })
  }
}

/** Replace concept names with [[wiki-links]] in text */
function insertConceptLinks(text: string, conceptNames: string[]): string {
  const sorted = [...conceptNames].sort((a, b) => b.length - a.length)
  let result = text
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'g'), `[[${name}]]`)
  }
  // Fix double-bracketed: [[[[x]]]] -> [[x]]
  result = result.replace(/\[\[\[\[([^\]]+)\]\]\]\]/g, '[[$1]]')
  return result
}

/** Generate book framework via AI */
async function generateFramework(
  title: string, author: string, notesContent: string, apiKey: string, model?: string,
): Promise<string> {
  try {
    return await chatWithAISimple({
      messages: [
        {
          role: 'system',
          content: '你是一个读书笔记整理专家。请根据提供的读书笔记，生成结构化的内容框架。用 Markdown 格式输出，直接输出内容，不要前言。',
        },
        {
          role: 'user',
          content: `以下是《${title}》（${author}）的读书笔记：\n\n${notesContent.slice(0, 20000)}\n\n请生成：\n1. 全书主题概括（1-2句话）\n2. 核心章节结构和要点\n3. 关键论点总结`,
        },
      ],
      apiKey,
      model,
    })
  } catch (err: any) {
    console.error('[Export] Framework generation failed:', err.message)
    return '*（AI 框架生成失败）*'
  }
}

/** Extract concepts via AI */
async function extractConcepts(
  title: string, notesContent: string, apiKey: string, model?: string,
): Promise<Concept[]> {
  try {
    const response = await chatWithAISimple({
      messages: [
        {
          role: 'system',
          content: [
            '你是一个知识图谱专家，擅长从读书笔记中提取核心概念。',
            '请严格按 JSON 数组格式返回，不要包含任何其他文本，不要用 markdown 代码块包裹。',
            '格式：[{"name": "概念名", "definition": "定义(2-3句话)", "relevance": "与本书的关联", "related": ["相关概念1"]}]',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `以下是《${title}》的读书笔记：\n\n${notesContent.slice(0, 20000)}\n\n请提取 5-15 个核心概念。`,
        },
      ],
      apiKey,
      model,
    })

    // Parse JSON from response (handle possible markdown code block wrapping)
    let jsonStr = response.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch (err: any) {
    console.error('[Export] Concept extraction failed:', err.message)
    return []
  }
}

/** Build the book main page markdown */
function buildBookPage(
  title: string,
  author: string,
  framework: string,
  notes: Array<{ content: string; source: string; created_at: string }>,
  conversations: Array<{ role: string; content: string }>,
  conceptNames: string[],
): string {
  const now = new Date().toISOString().split('T')[0]
  const lines: string[] = [
    '---',
    `title: "${title}"`,
    `author: "${author}"`,
    `exported_at: ${now}`,
    'tags: [book]',
    '---',
    '',
    `# ${title}`,
    `> 作者：${author}`,
    '',
    '## 内容框架',
    '',
    insertConceptLinks(framework, conceptNames),
    '',
    '## 读书笔记',
    '',
  ]

  if (notes.length === 0) {
    lines.push('*暂无笔记*', '')
  } else {
    for (const note of notes) {
      const tag = note.source === 'voice' ? ' `语音`' : note.source === 'ai-cleaned' ? ' `AI整理`' : ''
      lines.push(
        insertConceptLinks(note.content, conceptNames),
        '',
        `> — ${note.created_at.split('T')[0] || now}${tag}`,
        '',
        '---',
        '',
      )
    }
  }

  // Add notable AI conversations (assistant replies only, max 5)
  const aiReplies = conversations.filter((c) => c.role === 'assistant').slice(-5)
  if (aiReplies.length > 0) {
    lines.push('## AI 对话摘要', '')
    for (const reply of aiReplies) {
      lines.push(
        insertConceptLinks(reply.content.slice(0, 2000), conceptNames),
        '',
        '---',
        '',
      )
    }
  }

  return lines.join('\n')
}

/** Build a concept card markdown */
function buildConceptPage(concept: Concept, bookTitle: string): string {
  const lines: string[] = [
    '---',
    'tags: [concept]',
    `related_book: "[[${bookTitle}]]"`,
    '---',
    '',
    `# ${concept.name}`,
    '',
    '## 定义',
    '',
    concept.definition,
    '',
    `## 与《[[${bookTitle}]]》的关联`,
    '',
    concept.relevance,
    '',
  ]

  if (concept.related && concept.related.length > 0) {
    lines.push('## 相关概念', '')
    for (const r of concept.related) {
      lines.push(`- [[${r}]]`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** Update or create the MOC index file */
function updateMOC(vaultPath: string, title: string, author: string) {
  const mocDir = path.join(vaultPath, 'MOC')
  if (!fs.existsSync(mocDir)) fs.mkdirSync(mocDir, { recursive: true })

  const mocPath = path.join(mocDir, '读书总览.md')
  const now = new Date().toISOString().split('T')[0]
  const entry = `- [[${title}]] — ${author}（${now}）`

  if (fs.existsSync(mocPath)) {
    let content = fs.readFileSync(mocPath, 'utf-8')
    // Check if book already listed, update date
    const pattern = new RegExp(`^- \\[\\[${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\].*$`, 'm')
    if (pattern.test(content)) {
      content = content.replace(pattern, entry)
    } else {
      content = content.trimEnd() + '\n' + entry + '\n'
    }
    fs.writeFileSync(mocPath, content, 'utf-8')
  } else {
    const content = [
      '---',
      'tags: [MOC]',
      '---',
      '',
      '# 读书总览',
      '',
      entry,
      '',
    ].join('\n')
    fs.writeFileSync(mocPath, content, 'utf-8')
  }
}

/** Main export function for a single book */
export async function exportBookToObsidian(params: ExportParams): Promise<string[]> {
  const { bookId, vaultPath, apiKey, model } = params
  const db = getDb()
  const totalSteps = 5
  const filesWritten: string[] = []

  // Step 1: Gather data
  sendProgress(1, totalSteps, '读取书籍数据...')
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as any
  if (!book) throw new Error('书籍不存在')

  const notes = db.prepare(
    'SELECT content, source, created_at FROM notes WHERE book_id = ? ORDER BY created_at ASC'
  ).all(bookId) as any[]

  const conversations = db.prepare(
    'SELECT role, content FROM conversations WHERE book_id = ? ORDER BY created_at ASC'
  ).all(bookId) as any[]

  const title = sanitizeFilename(book.title)
  const notesContent = notes.map((n: any) => n.content).join('\n\n')

  // Step 2: AI generate framework
  sendProgress(2, totalSteps, 'AI 生成内容框架...')
  const framework = notesContent
    ? await generateFramework(book.title, book.author, notesContent, apiKey, model)
    : '*导入书籍后尚未记录笔记*'

  // Step 3: AI extract concepts
  sendProgress(3, totalSteps, 'AI 提取核心概念...')
  const concepts = notesContent
    ? await extractConcepts(book.title, notesContent, apiKey, model)
    : []
  const conceptNames = concepts.map((c) => c.name)

  // Step 4: Write files
  sendProgress(4, totalSteps, '写入 Obsidian 文件...')

  // Books dir
  const booksDir = path.join(vaultPath, 'Books')
  if (!fs.existsSync(booksDir)) fs.mkdirSync(booksDir, { recursive: true })

  const bookPageContent = buildBookPage(
    book.title, book.author, framework, notes, conversations, conceptNames,
  )
  const bookFilePath = path.join(booksDir, `${title}.md`)
  fs.writeFileSync(bookFilePath, bookPageContent, 'utf-8')
  filesWritten.push(bookFilePath)

  // Concepts dir
  if (concepts.length > 0) {
    const conceptsDir = path.join(vaultPath, 'Concepts')
    if (!fs.existsSync(conceptsDir)) fs.mkdirSync(conceptsDir, { recursive: true })

    for (const concept of concepts) {
      const conceptContent = buildConceptPage(concept, book.title)
      const conceptPath = path.join(conceptsDir, `${sanitizeFilename(concept.name)}.md`)

      // If concept file exists (from another book), append this book's section
      if (fs.existsSync(conceptPath)) {
        const existing = fs.readFileSync(conceptPath, 'utf-8')
        if (!existing.includes(`[[${book.title}]]`)) {
          const appendSection = [
            '',
            `## 与《[[${book.title}]]》的关联`,
            '',
            concept.relevance,
            '',
          ].join('\n')
          fs.writeFileSync(conceptPath, existing.trimEnd() + '\n' + appendSection, 'utf-8')
        }
      } else {
        fs.writeFileSync(conceptPath, conceptContent, 'utf-8')
      }
      filesWritten.push(conceptPath)
    }
  }

  // Step 5: Update MOC
  sendProgress(5, totalSteps, '更新索引...')
  updateMOC(vaultPath, book.title, book.author)

  return filesWritten
}

/** Export all books */
export async function exportAllBooksToObsidian(
  vaultPath: string, apiKey: string, model?: string,
): Promise<{ booksExported: number; filesWritten: string[] }> {
  const db = getDb()
  const books = db.prepare('SELECT id, title FROM books ORDER BY updated_at DESC').all() as any[]
  const allFiles: string[] = []

  for (let i = 0; i < books.length; i++) {
    sendProgress(i + 1, books.length, `导出《${books[i].title}》...`)
    const files = await exportBookToObsidian({
      bookId: books[i].id, vaultPath, apiKey, model,
    })
    allFiles.push(...files)
  }

  return { booksExported: books.length, filesWritten: allFiles }
}
