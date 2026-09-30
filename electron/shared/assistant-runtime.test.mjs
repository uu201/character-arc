import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatTurnPromptWithDocuments,
  formatTurnUserMessage,
  getTurnDocumentAttachments,
  getTurnImageAttachments,
  normalizeTurnAttachments
} from './assistant-runtime.ts'

test('AI 助理接受受限图片附件并按真实字节数归一化', () => {
  const attachments = normalizeTurnAttachments([{
    kind: 'image',
    ref: 'image:test',
    label: '人物参考.png',
    mimeType: 'image/png',
    size: 99,
    dataUrl: 'data:image/png;base64,AQID'
  }])

  const images = getTurnImageAttachments(attachments)
  assert.equal(images.length, 1)
  assert.equal(images[0].size, 3)
  assert.equal(
    formatTurnUserMessage('分析人物造型', attachments),
    '分析人物造型\n\n【图片附件】人物参考.png'
  )
})

test('AI 助理拒绝不支持的图片格式', () => {
  assert.throws(() => normalizeTurnAttachments([{
    kind: 'image',
    ref: 'image:svg',
    label: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    size: 10,
    dataUrl: 'data:image/svg+xml;base64,PHN2Zz4='
  }]), /仅支持 PNG、JPEG、WebP 和 GIF/)
})

test('AI 助理接受文本附件并把正文加入模型提示', () => {
  const attachments = normalizeTurnAttachments([{
    kind: 'document',
    ref: 'document:test',
    label: '设定.txt',
    mimeType: 'text/plain',
    size: 999,
    content: '主角害怕深水。'
  }])

  const documents = getTurnDocumentAttachments(attachments)
  assert.equal(documents.length, 1)
  assert.equal(documents[0].size, new TextEncoder().encode('主角害怕深水。').byteLength)
  assert.match(formatTurnPromptWithDocuments('分析人物弱点', attachments), /设定\.txt/)
  assert.match(formatTurnPromptWithDocuments('分析人物弱点', attachments), /主角害怕深水/)
})
