import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildZonghengViewData,
  parseZonghengBoardCatalog
} from '../../../../renderer/src/features/ranking/zonghengRanking.ts'

const rootDir = fileURLToPath(new URL('../../../../', import.meta.url))

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, `file:///${rootDir.replaceAll('\\', '/')}/`), 'utf8')
}

test('纵横榜单目录保留指标和作者榜标记并过滤非法路径', () => {
  const boards = parseZonghengBoardCatalog({
    boards: [
      { slug: 'click', name: '点击榜', desc: '流量入口', metric_label: '点击', is_author: false },
      { slug: 'author-popularity', name: '作者人气榜', metric_label: '人气', is_author: true },
      { slug: '../escape', name: '非法榜单' },
      { slug: 'click', name: '重复榜单' }
    ]
  })

  assert.equal(boards.length, 2)
  assert.equal(boards[0].metricLabel, '点击')
  assert.equal(boards[1].isAuthor, true)
})

test('纵横数据适配为现有摘要、分类、趋势和作品结构', () => {
  const adapted = buildZonghengViewData({
    date: '2026-08-19',
    board: { slug: 'click', name: '点击榜', metric_label: '点击' },
    categories: [
      {
        name: '全部',
        books: [{ bookId: 1, title: '测试作品', author: '作者甲', category: '都市', metric: 1234, metricLabel: '点击', updatedToday: true, intro: '简介' }]
      },
      { name: '都市', books: [] }
    ],
    analysis: {
      date: '2026-08-19',
      prev_date: '2026-08-18',
      trends: {
        全部: {
          summary: '榜单结构稳定',
          new_books: [{ title: '测试作品' }],
          top_movers: [{ title: '测试作品', rankChange: 2, metricGrowth: 0.125 }]
        }
      },
      category_heat: [{ name: '都市', heat: 88 }],
      keyword_heat: [{ keyword: '穿越', count: 3 }]
    }
  }, { date: '2026-08-19', engine: 'AI', brief: '全站风向日报' })

  assert.equal(adapted.summaryData.periods.all.summary, '全站风向日报')
  assert.equal(adapted.summaryData.periods.all.source, 'ai')
  assert.equal(adapted.allData.prev_date, '2026-08-18')
  assert.equal(adapted.allData.categories[0].books[0].id, '1')
  assert.equal(adapted.allData.categories[0].books[0].metric, 1234)
  assert.deepEqual(adapted.allData.categories[0].trend.new_books, ['测试作品'])
  assert.equal(adapted.allData.categories[0].trend.top_risers[0].change, '+2')
  assert.equal(adapted.summaryData.periods.all.hot_themes[0].name, '穿越')
})

test('纵横 IPC 只开放静态 API 所需路径', () => {
  const backend = readSource('electron/main/zongheng-trends.ts')
  const page = readSource('renderer/src/pages/FanqieTrendsPage.vue')

  assert.match(backend, /siweimidu\/ZongHengRankTracker/)
  assert.match(backend, /ALLOWED_PATH/)
  assert.match(backend, /market-brief/)
  assert.match(backend, /latest/)
  assert.match(page, /updateScanPlatform\('zongheng'\)/)
  assert.match(page, /platform === 'zongheng'/)
})
