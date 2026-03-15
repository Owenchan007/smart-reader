import { getDb } from './db'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import JSZip from 'jszip'

export function copyBookToAppData(originalPath: string): string {
  const booksDir = path.join(app.getPath('userData'), 'books')
  if (!fs.existsSync(booksDir)) {
    fs.mkdirSync(booksDir, { recursive: true })
  }
  const filename = `${Date.now()}-${path.basename(originalPath)}`
  const destPath = path.join(booksDir, filename)
  fs.copyFileSync(originalPath, destPath)
  return destPath
}

export function saveBookRecord(title: string, author: string, filePath: string, coverImage?: string): number {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT INTO books (title, author, file_path, cover_image) VALUES (?, ?, ?, ?)'
  )
  const result = stmt.run(title, author, filePath, coverImage || null)
  return result.lastInsertRowid as number
}

export function saveChunks(bookId: number, chunks: Array<{ chapter: string; content: string; position: number }>) {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT INTO chunks (book_id, chapter, content, position) VALUES (?, ?, ?, ?)'
  )
  const insertMany = db.transaction((items: typeof chunks) => {
    for (const item of items) {
      stmt.run(bookId, item.chapter, item.content, item.position)
    }
  })
  insertMany(chunks)
}

export function searchChunks(bookId: number, query: string): Array<{ chapter: string; content: string }> {
  const db = getDb()

  const chapterMatch = query.match(/第(\d+|[一二三四五六七八九十百]+)章|chapter\s*(\d+)/i)
  if (chapterMatch) {
    const chapterNum = chapterMatch[1] || chapterMatch[2]
    const headingChunks = db.prepare(
      `SELECT id, chapter, content, position FROM chunks WHERE book_id = ? AND content LIKE ? ORDER BY position LIMIT 1`
    ).all(bookId, `%第${chapterNum}%`) as Array<{ id: number; chapter: string; content: string; position: number }>

    if (headingChunks.length > 0) {
      const startPos = headingChunks[0].position
      const chapterHref = headingChunks[0].chapter
      let results = db.prepare(
        `SELECT chapter, content FROM chunks WHERE book_id = ? AND chapter = ? ORDER BY position LIMIT 20`
      ).all(bookId, chapterHref) as Array<{ chapter: string; content: string }>

      if (results.length < 5) {
        results = db.prepare(
          `SELECT chapter, content FROM chunks WHERE book_id = ? AND position >= ? AND position < ? ORDER BY position`
        ).all(bookId, startPos, startPos + 20) as Array<{ chapter: string; content: string }>
      }
      return results
    }
  }

  const words = query.split(/\s+/).filter(w => w.length > 1)
  if (words.length === 0) return []

  const stopWords = ['什么', '东西', '哪些', '怎么', '为什么', '讲了', '说了', '关于', '介绍', '内容', '本书', '这本', '给我']
  const keywords = words.filter(w => !stopWords.includes(w))
  if (keywords.length === 0) return []

  const conditions = keywords.map(() => 'content LIKE ?').join(' OR ')
  const params = keywords.map(w => `%${w}%`)

  return db.prepare(
    `SELECT chapter, content FROM chunks WHERE book_id = ? AND (${conditions}) ORDER BY position LIMIT 15`
  ).all(bookId, ...params) as Array<{ chapter: string; content: string }>
}

/**
 * Extract text and cover from an EPUB file using JSZip (pure Node.js, no browser APIs).
 */
export async function extractEpubContent(filePath: string): Promise<{
  title: string
  author: string
  coverBase64: string | null
  chunks: Array<{ chapter: string; content: string; position: number }>
}> {
  const data = fs.readFileSync(filePath)
  const zip = await JSZip.loadAsync(data)

  // 1. Parse container.xml to find the OPF file
  const containerXml = await zip.file('META-INF/container.xml')?.async('text')
  if (!containerXml) throw new Error('无效的 EPUB 文件')

  const opfPathMatch = containerXml.match(/full-path="([^"]+)"/)
  const opfPath = opfPathMatch?.[1] || ''
  const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1)

  const opfXml = await zip.file(opfPath)?.async('text')
  if (!opfXml) throw new Error('无法读取 OPF 文件')

  // 2. Extract metadata
  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)
  const authorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)
  const title = titleMatch?.[1] || filePath.split('/').pop()?.replace('.epub', '') || '未知书名'
  const author = authorMatch?.[1] || '未知作者'

  // 3. Extract cover image
  let coverBase64: string | null = null
  try {
    // Method 1: look for meta cover
    const coverIdMatch = opfXml.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/i)
    let coverHref: string | null = null

    if (coverIdMatch) {
      const coverId = coverIdMatch[1]
      const itemRegex = new RegExp(`<item[^>]*id="${coverId}"[^>]*href="([^"]+)"`, 'i')
      const itemMatch = opfXml.match(itemRegex)
      if (itemMatch) coverHref = itemMatch[1]
    }

    // Method 2: look for item with properties="cover-image"
    if (!coverHref) {
      const coverPropMatch = opfXml.match(/<item[^>]*properties="cover-image"[^>]*href="([^"]+)"/i)
      if (coverPropMatch) coverHref = coverPropMatch[1]
    }

    // Method 3: look for image named cover
    if (!coverHref) {
      const coverNameMatch = opfXml.match(/<item[^>]*href="([^"]*cover[^"]*\.(jpg|jpeg|png|gif))"[^>]*/i)
      if (coverNameMatch) coverHref = coverNameMatch[1]
    }

    if (coverHref) {
      const coverPath = coverHref.startsWith('/') ? coverHref.slice(1) : opfDir + coverHref
      const coverFile = zip.file(coverPath)
      if (coverFile) {
        const coverData = await coverFile.async('base64')
        const ext = coverHref.toLowerCase().endsWith('.png') ? 'png' : 'jpeg'
        coverBase64 = `data:image/${ext};base64,${coverData}`
      }
    }
  } catch {}

  // 4. Extract spine items (reading order) and their text
  const spineMatches = [...opfXml.matchAll(/<itemref[^>]*idref="([^"]+)"/gi)]
  const spineIds = spineMatches.map(m => m[1])

  // Build id->href map from manifest
  const manifestItems = [...opfXml.matchAll(/<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*/gi)]
  const idToHref: Record<string, string> = {}
  for (const m of manifestItems) {
    idToHref[m[1]] = m[2]
  }

  const chunks: Array<{ chapter: string; content: string; position: number }> = []
  let position = 0

  for (const spineId of spineIds) {
    const href = idToHref[spineId]
    if (!href) continue

    const fullPath = href.startsWith('/') ? href.slice(1) : opfDir + href
    const file = zip.file(fullPath)
    if (!file) continue

    try {
      const html = await file.async('text')
      // Strip HTML tags to get plain text
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
        .replace(/\s+/g, ' ')
        .trim()

      if (!text || text.length < 5) continue

      const chunkSize = 500
      for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push({
          chapter: href,
          content: text.slice(i, i + chunkSize),
          position: position++,
        })
      }
    } catch {}
  }

  return { title, author, coverBase64, chunks }
}
