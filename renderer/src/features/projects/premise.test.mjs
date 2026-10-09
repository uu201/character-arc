import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveProjectPremise } from './premise.ts'

test('旧项目简介从故事开端分卷恢复，不受分卷顺序影响', () => {
  assert.equal(
    resolveProjectPremise({}, [
      { title: '序章', summary: '序章摘要' },
      { title: '故事开端', summary: '旧版简介' }
    ]),
    '旧版简介'
  )
})

test('独立简介优先，并允许主动清空', () => {
  const volumes = [{ title: '故事开端', summary: '旧版简介' }]
  assert.equal(resolveProjectPremise({ premise: '独立简介' }, volumes), '独立简介')
  assert.equal(resolveProjectPremise({ premise: '' }, volumes), '')
})

test('默认分卷摘要不作为简介显示', () => {
  assert.equal(
    resolveProjectPremise({}, [{ title: '故事开端', summary: '用于集中推进故事主冲突，并在较短篇幅内完成完整闭环。' }]),
    undefined
  )
})

test('未找到旧简介时保留未迁移状态，后续仍能恢复', () => {
  const migrated = JSON.parse(JSON.stringify({
    premise: resolveProjectPremise({}, [{ title: '序章', summary: '序章摘要' }])
  }))
  assert.equal(migrated.premise, undefined)
  assert.equal(
    resolveProjectPremise(migrated, [{ title: '故事开端', summary: '旧版简介' }]),
    '旧版简介'
  )
})

test('NULL 兼容恢复旧简介，空摘要仍保持未迁移状态', () => {
  assert.equal(resolveProjectPremise({ premise: null }, [{ title: '故事开端', summary: '旧版简介' }]), '旧版简介')
  assert.equal(resolveProjectPremise({}, [{ title: '故事开端', summary: '   ' }]), undefined)
})
