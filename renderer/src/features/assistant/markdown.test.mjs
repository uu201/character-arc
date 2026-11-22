import assert from 'node:assert/strict'
import test from 'node:test'
import { marked } from 'marked'
import { ASSISTANT_MARKDOWN_SANITIZE_OPTIONS, parseAssistantMarkdown } from './markdown.ts'

test('截图中的中文列表标签在冒号后紧接正文时仍正确加粗', () => {
  const html = parseAssistantMarkdown([
    '2. **【世界与设定】**',
    '',
    '重点沉淀可执行规则，而不是只列设定名称：',
    '',
    '- **玉佩力量：**提供异常力量，也增加经脉负担。',
    '- **续脉机制：**按现有设定，三年内冲击大境界。',
    '- **灵雾潮：**采药发生在涨起后的有限窗口。',
    '- **灵嗅虫：**对气息敏感。',
    '- **断代令：**公开调查受禁。'
  ].join('\n'))
  for (const label of ['【世界与设定】', '玉佩力量：', '续脉机制：', '灵雾潮：', '灵嗅虫：', '断代令：']) {
    assert.ok(html.includes(`<strong>${label}</strong>`), label)
  }
  assert.doesNotMatch(html, /\*\*/)
  assert.match(html, /<ol start="2">/)
  assert.match(html, /<ul>/)
})

test('中文标签闭合标记内的多余空格不再导致星号原样显示', () => {
  assert.match(parseAssistantMarkdown('- **玉佩力量： **提供异常力量'), /<strong>玉佩力量： <\/strong>提供异常力量/)
})

test('行内代码和围栏代码中的 Markdown 示例保持原样', () => {
  const html = parseAssistantMarkdown('`**玉佩力量：**提供力量`\n\n```md\n**续脉机制：**说明\n```\n\n~~~text\n**灵雾潮：**说明\n~~~')
  assert.match(html, /<code>\*\*玉佩力量：\*\*提供力量<\/code>/)
  assert.match(html, /<code class="language-md">\*\*续脉机制：\*\*说明/)
  assert.match(html, /<code class="language-text">\*\*灵雾潮：\*\*说明/)
  assert.doesNotMatch(html, /<strong>/)
})

test('转义星号保持字面量，普通强调和嵌套强调沿用 Markdown 规则', () => {
  assert.doesNotMatch(parseAssistantMarkdown(String.raw`\*\*玉佩力量：\*\*提供力量`), /<strong>/)
  const html = parseAssistantMarkdown('**普通加粗**、*斜体*、**加粗和 *嵌套斜体* 内容**、***加粗斜体***')
  assert.match(html, /<strong>普通加粗<\/strong>/)
  assert.match(html, /<em>斜体<\/em>/)
  assert.match(html, /<strong>加粗和 <em>嵌套斜体<\/em> 内容<\/strong>/)
  assert.match(html, /<em><strong>加粗斜体<\/strong><\/em>/)
})

test('标题、表格、任务列表、链接和删除线继续按 GFM 渲染', () => {
  const html = parseAssistantMarkdown('## 标题\n\n| 条目 | 说明 |\n| --- | --- |\n| **规则：**内容 | 证据 |\n\n- [x] 已确认\n\n[参考](https://example.com)与~~删除线~~')
  assert.match(html, /<h2>标题<\/h2>/)
  assert.match(html, /<table>/)
  assert.match(html, /<strong>规则：<\/strong>内容/)
  assert.match(html, /<input checked="" disabled="" type="checkbox">/)
  assert.match(html, /<a href="https:\/\/example.com">参考<\/a>/)
  assert.match(html, /<del>删除线<\/del>/)
})

test('流式未闭合内容保持文本，接收到闭合标记后正常加粗', () => {
  assert.doesNotMatch(parseAssistantMarkdown('**玉佩力量：'), /<strong>/)
  assert.match(parseAssistantMarkdown('**玉佩力量：**提供异常力量'), /<strong>玉佩力量：<\/strong>提供异常力量/)
})

test('其他页面修改全局 marked 配置不会污染助手解析实例', (t) => {
  const defaults = { ...marked.defaults }
  t.after(() => marked.setOptions(defaults))
  marked.setOptions({ breaks: false, gfm: false })
  marked.use({ renderer: { strong() { return '<b>其他页面的渲染器</b>' } } })
  assert.match(parseAssistantMarkdown('**普通加粗**\n下一行'), /<strong>普通加粗<\/strong><br>\s*下一行/)
})

test('六级标题、段落、换行和分隔线均保留语义', () => {
  for (let level = 1; level <= 6; level++) {
    assert.match(parseAssistantMarkdown(`${'#'.repeat(level)} 标题`), new RegExp(`<h${level}>标题</h${level}>`))
  }
  const html = parseAssistantMarkdown('第一段\r\n第二行\r\n\r\n第二段\r\n\r\n---')
  assert.match(html, /第一段<br>\s*第二行/)
  assert.match(html, /<p>第二段<\/p>/)
  assert.match(html, /<hr>/)
})

test('有序列表的起始序号、嵌套列表及嵌套引用正常渲染', () => {
  const html = parseAssistantMarkdown('3. 第三项\n   - 子项\n     - 更深子项\n\n> 引用\n>\n> > 嵌套引用')
  assert.match(html, /<ol start="3">/)
  assert.equal((html.match(/<ul>/g) ?? []).length, 2)
  assert.equal((html.match(/<blockquote>/g) ?? []).length, 2)
})

test('中文标点后的斜体、下划线加粗、粗斜体和删除线不会露出标记', () => {
  for (const [source, expected] of [
    ['*注意：*必须确认', '<em>注意：</em>必须确认'],
    ['_注意：_必须确认', '<em>注意：</em>必须确认'],
    ['__规则：__需要核对', '<strong>规则：</strong>需要核对'],
    ['***重点：***检查正文', '<em><strong>重点：</strong></em>检查正文'],
    ['~~旧设定：~~已废弃', '<del>旧设定：</del>已废弃']
  ]) assert.ok(parseAssistantMarkdown(source).includes(expected), source)
})

test('中文标点加粗内部可包含斜体与含星号的行内代码', () => {
  assert.match(parseAssistantMarkdown('**规则 *重点*：**需要核对'), /<strong>规则 <em>重点<\/em>：<\/strong>需要核对/)
  assert.match(parseAssistantMarkdown('**规则 `a**b`：**需要核对'), /<strong>规则 <code>a\*\*b<\/code>：<\/strong>需要核对/)
})

test('普通标识符中的下划线和转义标记不被当作中文强调', () => {
  assert.doesNotMatch(parseAssistantMarkdown('prefix_中文：_suffix'), /<em>/)
  assert.doesNotMatch(parseAssistantMarkdown(String.raw`\*注意：\*正文`), /<em>/)
})

test('补齐 AI 生成表格缺少的分隔列，并保留后续正文', () => {
  const html = parseAssistantMarkdown('| 名称 | 规则 | 证据 |\n| --- | --- |\n| 玉佩 | 消耗灵力 | 第三章 |\n\n后续正文')
  assert.match(html, /<table>/)
  assert.equal((html.match(/<th>/g) ?? []).length, 3)
  assert.match(html, /<p>后续正文<\/p>/)
})

test('表格中的转义竖线不额外计列，对齐信息正常保留', () => {
  const html = parseAssistantMarkdown('| 名称 \\| 别名 | 规则 | 证据 |\n| :--- | ---: |\n| 玉佩 | 消耗灵力 | 第三章 |')
  assert.match(html, /<table>/)
  assert.match(html, /名称 \| 别名/)
  assert.match(html, /align="left"/)
  assert.match(html, /align="right"/)
})

test('反引号、波浪线与缩进代码中的表格示例不会被补列', () => {
  const table = '| 名称 | 规则 | 证据 |\n| --- | --- |\n| 玉佩 | 灵力 | 章节 |'
  for (const source of [
    `\`\`\`md\n${table}\n\`\`\``,
    `~~~md\n${table}\n~~~`,
    `\`\`\`\`md\n\`\`\`\n${table}\n\`\`\`\``,
    table.split('\n').map(line => `    ${line}`).join('\n')
  ]) {
    const html = parseAssistantMarkdown(source)
    assert.match(html, /<pre><code/)
    assert.match(html, /\| --- \| --- \|/)
    assert.doesNotMatch(html, /<table>/)
  }
})

test('未闭合的代码围栏按代码显示，不误解析里面的表格', () => {
  const html = parseAssistantMarkdown('~~~md\n| 名称 | 规则 | 证据 |\n| --- | --- |\n| 玉佩 | 灵力 | 章节 |')
  assert.match(html, /<pre><code/)
  assert.match(html, /\| --- \| --- \|/)
  assert.doesNotMatch(html, /<table>/)
})

test('引用链接、自动链接与已完成/未完成任务列表保持可读', () => {
  const html = parseAssistantMarkdown('[资料][ref]\n\n[ref]: https://example.com/docs\n\nhttps://example.com\n\n- [x] 已完成\n- [ ] 待确认')
  assert.match(html, /href="https:\/\/example.com\/docs"/)
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2)
  assert.equal((html.match(/checked=""/g) ?? []).length, 1)
})

test('HTML 清理保留列表起始序号、表格对齐和只读任务状态', () => {
  const { ALLOWED_TAGS, ALLOWED_ATTR } = ASSISTANT_MARKDOWN_SANITIZE_OPTIONS
  for (const tag of ['ol', 'table', 'input']) assert.ok(ALLOWED_TAGS.includes(tag), tag)
  for (const attr of ['start', 'align', 'checked', 'disabled', 'type']) assert.ok(ALLOWED_ATTR.includes(attr), attr)
  for (const tag of ['script', 'iframe']) assert.equal(ALLOWED_TAGS.includes(tag), false)
  for (const attr of ['onclick', 'onerror', 'srcdoc']) assert.equal(ALLOWED_ATTR.includes(attr), false)
})
