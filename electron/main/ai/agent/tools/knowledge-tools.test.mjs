import assert from 'node:assert/strict'
import test from 'node:test'

import { createKnowledgeTools } from './knowledge-tools.ts'

test('knowledge_save_document rejects overlong content instead of truncating saved data', async () => {
  const saved = []
  const [tool] = createKnowledgeTools({
    maxContentChars: 5,
    collectDocument(doc) {
      saved.push(doc)
      return 'doc-1'
    }
  })

  const result = await tool.handler({
    title: '长文档',
    sourceType: 'canon-fact',
    content: '123456'
  })

  assert.equal(result.isError, true)
  assert.match(result.content, /超过单文档上限/)
  assert.equal(saved.length, 0)
})

test('knowledge_save_document keeps valid content intact', async () => {
  const saved = []
  const [tool] = createKnowledgeTools({
    maxContentChars: 20,
    collectDocument(doc) {
      saved.push(doc)
      return 'doc-1'
    }
  })

  const result = await tool.handler({
    title: '短文档',
    sourceType: 'canon-fact',
    content: '完整内容'
  })

  assert.equal(result.isError, undefined)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].content, '完整内容')
})
