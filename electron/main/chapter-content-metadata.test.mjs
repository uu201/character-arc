import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  countChapterCharacters,
  ensureChapterContentMetadata
} from './chapter-content-metadata.ts'

function createLegacyDb() {
  const db = new DatabaseSync(':memory:')
  db.function('chapter_character_count', (content) => countChapterCharacters(String(content ?? '')))
  db.exec(`
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL
    ) STRICT;
    CREATE TABLE chapter_versions (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL
    ) STRICT;
    INSERT INTO chapters (id, content) VALUES ('chapter-1', '<p>第一章&nbsp;正文</p>');
    INSERT INTO chapter_versions (id, content) VALUES ('version-1', '<p>旧版 正文</p>');
  `)
  return db
}

test('旧数据库首次升级会回填章节和版本字数', () => {
  const db = createLegacyDb()

  ensureChapterContentMetadata(db)
  ensureChapterContentMetadata(db)

  assert.equal(db.prepare('SELECT content_length FROM chapters WHERE id = ?').get('chapter-1').content_length, 5)
  assert.equal(db.prepare('SELECT content_length FROM chapter_versions WHERE id = ?').get('version-1').content_length, 4)
})

test('纯文本不会被按 HTML 解码或误删比较符号', () => {
  assert.equal(countChapterCharacters('1 < 2 > 0 &amp;'), 10)
  assert.equal(countChapterCharacters('<p>&amp;</p>'), 1)
})

test('正文插入和更新会自动维护持久化字数', () => {
  const db = createLegacyDb()
  ensureChapterContentMetadata(db)

  db.prepare('UPDATE chapters SET content = ? WHERE id = ?').run('<p>更新 后正文</p>', 'chapter-1')
  db.prepare('INSERT INTO chapter_versions (id, content) VALUES (?, ?)').run('version-2', '<p>新版本正文</p>')

  assert.equal(db.prepare('SELECT content_length FROM chapters WHERE id = ?').get('chapter-1').content_length, 5)
  assert.equal(db.prepare('SELECT content_length FROM chapter_versions WHERE id = ?').get('version-2').content_length, 5)
})
