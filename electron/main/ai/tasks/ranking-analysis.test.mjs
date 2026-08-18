import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('../../../../', import.meta.url))

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, `file:///${rootDir.replaceAll('\\', '/')}/`), 'utf8')
}

test('起点榜单抓取按榜单和作品分类校验并分别缓存', () => {
  const source = readSource('electron/main/qidian-rank.ts')

  assert.match(source, /QIDIAN_RANK_URLS/)
  assert.match(source, /QIDIAN_CATEGORY_LABELS/)
  assert.match(source, /qidian-\$\{normalizedType\}-cat-\$\{normalizedCategory\}/)
  assert.match(source, /parseQidianRankHtml/)
  assert.match(source, /books\.length < 60/)
  assert.match(source, /source: '起点中文网'/)
})

test('扫榜任务明确区分市场风格和正文文风', () => {
  const source = readSource('electron/main/ai/tasks/ranking-style-analysis.ts')

  assert.match(source, /市场风格/)
  assert.match(source, /不是正文句式或作者文笔/)
  assert.match(source, /本报告基于榜单元数据与简介，不等于正文文风分析/)
  assert.match(source, /slice\(0, 60\)/)
})

test('脑洞任务要求四个方向、每个三个组合，并在前端手动触发', () => {
  const taskSource = readSource('electron/main/ai/tasks/ranking-idea-combinations.ts')
  const pageSource = readSource('renderer/src/pages/FanqieTrendsPage.vue')

  assert.match(taskSource, /恰好 4 个彼此明显不同的创作方向/)
  assert.match(taskSource, /每个方向恰好包含 3 个脑洞组合/)
  assert.match(taskSource, /不得复制、续写或拼接任何榜单作品/)
  assert.match(pageSource, /scanStage\.value = 'setup'/)
  assert.match(pageSource, /开始扫榜/)
  assert.match(pageSource, /appStore\.openWizard\(\{ title: idea\.title, genre: idea\.genre, premise \}\)/)
})
