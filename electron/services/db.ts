import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

let db: Database.Database

export function getDb(): Database.Database {
  return db
}

export function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'smart-reader.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      cover_image TEXT,
      last_position TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter TEXT DEFAULT '',
      content TEXT NOT NULL,
      position INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      chapter TEXT DEFAULT '',
      content TEXT NOT NULL,
      raw_voice_text TEXT DEFAULT '',
      source TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_book_id ON chunks(book_id);
    CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes(book_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_book_id ON conversations(book_id);
  `)

  // Migrate: add status column if missing
  const columns = db.pragma('table_info(books)') as Array<{ name: string }>
  if (!columns.find((c) => c.name === 'status')) {
    db.exec(`ALTER TABLE books ADD COLUMN status TEXT DEFAULT 'reading'`)
  }
}
