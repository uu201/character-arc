import assert from 'node:assert/strict'
import test from 'node:test'

import { formatTextWindowNote, sliceTextWindow } from './text-window.ts'

test('sliceTextWindow returns a resumable first window for long text', () => {
  const window = sliceTextWindow('abcdef', {
    limit: 3
  })

  assert.equal(window.text, 'abc')
  assert.equal(window.total, 6)
  assert.equal(window.offset, 0)
  assert.equal(window.end, 3)
  assert.equal(window.truncated, true)
  assert.equal(window.nextOffset, 3)
  assert.match(formatTextWindowNote(window), /Next content_offset: 3/)
})

test('sliceTextWindow reads from content offset and reports end of content', () => {
  const window = sliceTextWindow('abcdef', {
    offset: 3,
    limit: 20
  })

  assert.equal(window.text, 'def')
  assert.equal(window.offset, 3)
  assert.equal(window.end, 6)
  assert.equal(window.truncated, false)
  assert.equal(window.nextOffset, undefined)
  assert.match(formatTextWindowNote(window), /End of content/)
})

test('formatTextWindowNote can name the continuation parameter', () => {
  const window = sliceTextWindow('abcdef', {
    limit: 2
  })

  assert.match(formatTextWindowNote(window, 'Search output', 'output_offset'), /Next output_offset: 2/)
  assert.doesNotMatch(formatTextWindowNote(window, 'Search output', 'output_offset'), /content_offset/)
})
