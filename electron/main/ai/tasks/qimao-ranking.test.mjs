import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildQimaoViewData,
  parseQimaoBoardCatalog
} from '../../../../renderer/src/features/ranking/qimaoRanking.ts'

const rootDir = fileURLToPath(new URL('../../../../', import.meta.url))

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, `file:///${rootDir.replaceAll('\\', '/')}/`), 'utf8')
}

test('七猫榜单目录过滤非法和重复条目并保留动态分类', () => {
  const boards = parseQimaoBoardCatalog({
    boards: [
      {
        slug: 'boy-hot-date',
        name: '男生大热日榜',
        channel: 'male',
        categories: ['都市高武', '都市高武', '东方玄幻'],
        book_count: 20
      },
      { slug: '../escape', name: '非法路径' },
      { slug: 'boy-hot-date', name: '重复榜单' }
    ]
  })

  assert.equal(boards.length, 1)
  assert.equal(boards[0].name, '男生大热日榜')
  assert.deepEqual(boards[0].categories, ['都市高武', '东方玄幻'])
})

test('七猫数据适配为风向标现有的摘要、分类和作品结构', () => {
  const adapted = buildQimaoViewData({
    board: { slug: 'girl-new-date', name: '女生新书日榜', period_name: '日榜' },
    date: '2026-08-18',
    books: [{ book_id: 1, title: '测试新书', author: '作者甲', minor: '年代重生', heat: 12345, is_new: true }],
    categories: [{
      name: '年代重生',
      total_heat: 12345,
      books: [{ book_id: 1, title: '测试新书', author: '作者甲', minor: '年代重生', heat: 12345 }],
      trend: { summary: '新书势头明显' }
    }]
  }, {
    overview: { text: '七猫女频新书风向', ai_source: 'rule' },
    genre_groups: [{ name: '现代言情', total_heat: 12345 }],
    keywords: [{ word: '重生', count: 3 }]
  })

  assert.equal(adapted.summaryData.periods.all.summary, '七猫女频新书风向')
  assert.equal(adapted.summaryData.periods.all.hot_themes[0].name, '重生')
  assert.equal(adapted.allData.categories[0].name, '全部')
  assert.equal(adapted.allData.categories[1].books[0].id, '1')
  assert.deepEqual(adapted.allData.categories[0].trend.new_books, ['测试新书'])
})

test('七猫 IPC 只开放榜单目录、最新榜单和市场摘要路径', () => {
  const backend = readSource('electron/main/qimao-trends.ts')
  const page = readSource('renderer/src/pages/FanqieTrendsPage.vue')

  assert.match(backend, /siweimidu\/QiMaoRankTracker2/)
  assert.match(backend, /ALLOWED_PATH/)
  assert.match(backend, /latest\\\/all\\\.json\|market_summary\\\.json/)
  assert.match(page, /updateScanPlatform\('qimao'\)/)
  assert.match(page, /scanSelectedPlatform === 'qimao'/)
  assert.match(page, /点击“开始扫榜”后/)
})
