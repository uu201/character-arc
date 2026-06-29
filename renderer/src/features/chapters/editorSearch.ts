import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PmNode } from '@tiptap/pm/model'

export type SearchMatch = { from: number; to: number }

export interface EditorSearchStorage {
  matches: SearchMatch[]
  currentIndex: number
}

// TipTap 3.x requires module augmentation to type custom commands
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    editorSearch: {
      setSearchTerm: (term: string, caseSensitive?: boolean) => ReturnType
      nextSearchMatch: () => ReturnType
      prevSearchMatch: () => ReturnType
      replaceCurrentMatch: (replacement: string) => ReturnType
      replaceAllMatches: (replacement: string) => ReturnType
    }
  }

  interface Storage {
    editorSearch: EditorSearchStorage
  }
}

interface SearchPluginState {
  term: string
  caseSensitive: boolean
  matches: SearchMatch[]
  currentIndex: number
  decorations: DecorationSet
}

const SEARCH_KEY = new PluginKey<SearchPluginState>('editorSearch')

function findMatches(doc: PmNode, term: string, caseSensitive: boolean): SearchMatch[] {
  if (!term) return []
  const matches: SearchMatch[] = []
  const needle = caseSensitive ? term : term.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const haystack = caseSensitive ? node.text : node.text.toLowerCase()
    for (let i = 0; (i = haystack.indexOf(needle, i)) !== -1; i++) {
      matches.push({ from: pos + i, to: pos + i + term.length })
      i += term.length - 1
    }
  })
  return matches
}

function buildDecorations(doc: PmNode, matches: SearchMatch[], currentIndex: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty
  return DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === currentIndex ? 'search-hl search-hl-cur' : 'search-hl'
    })
  ))
}

export const EditorSearchExtension = Extension.create<object, EditorSearchStorage>({
  name: 'editorSearch',

  addStorage(): EditorSearchStorage {
    return { matches: [], currentIndex: 0 }
  },

  addProseMirrorPlugins() {
    const ext = this
    return [
      new Plugin<SearchPluginState>({
        key: SEARCH_KEY,
        state: {
          init(): SearchPluginState {
            return { term: '', caseSensitive: false, matches: [], currentIndex: 0, decorations: DecorationSet.empty }
          },
          apply(tr, prev): SearchPluginState {
            const meta = tr.getMeta(SEARCH_KEY) as Partial<SearchPluginState> | undefined
            let next: SearchPluginState = prev
            if (meta) {
              const term = meta.term ?? prev.term
              const caseSensitive = meta.caseSensitive ?? prev.caseSensitive
              const matches = meta.term !== undefined ? findMatches(tr.doc, term, caseSensitive) : prev.matches
              const currentIndex = meta.currentIndex !== undefined
                ? Math.max(0, Math.min(meta.currentIndex, Math.max(0, matches.length - 1)))
                : prev.currentIndex
              next = { term, caseSensitive, matches, currentIndex, decorations: buildDecorations(tr.doc, matches, currentIndex) }
            } else if (tr.docChanged && prev.term) {
              const matches = findMatches(tr.doc, prev.term, prev.caseSensitive)
              const currentIndex = Math.max(0, Math.min(prev.currentIndex, Math.max(0, matches.length - 1)))
              next = { ...prev, matches, currentIndex, decorations: buildDecorations(tr.doc, matches, currentIndex) }
            }
            // 把最新结果同步到 extension storage，方便外部（含 Vue 组件）读取
            // 注意：这里只赋值原始字段，外部需要响应式时应自己监听 transaction
            ext.storage.matches = next.matches
            ext.storage.currentIndex = next.currentIndex
            return next
          }
        },
        props: {
          decorations(state) { return SEARCH_KEY.getState(state)?.decorations }
        }
      })
    ]
  },

  addCommands() {
    return {
      setSearchTerm: (term: string, caseSensitive = false) => ({ editor, state, dispatch }: { editor: Editor; state: EditorState; dispatch: ((tr: Transaction) => void) | undefined }) => {
        if (!dispatch) return false
        const tr = state.tr.setMeta(SEARCH_KEY, { term, caseSensitive, currentIndex: 0 })
        dispatch(tr)
        const pluginState = SEARCH_KEY.getState(editor.state)
        const first = pluginState?.matches[0]
        if (first) {
          // 滚动到第一个匹配但不改动选区/焦点
          const dom = editor.view.domAtPos(first.from)
          const node = dom.node as HTMLElement | Node | null
          if (node && (node as HTMLElement).scrollIntoView) {
            ;(node as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
          } else if (node?.parentElement) {
            node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
        return true
      },

      nextSearchMatch: () => ({ editor, state, dispatch }: { editor: Editor; state: EditorState; dispatch: ((tr: Transaction) => void) | undefined }) => {
        const pluginState = SEARCH_KEY.getState(state)
        if (!pluginState?.matches.length || !dispatch) return false
        const nextIndex = (pluginState.currentIndex + 1) % pluginState.matches.length
        dispatch(state.tr.setMeta(SEARCH_KEY, { currentIndex: nextIndex }))
        const match = pluginState.matches[nextIndex]
        scrollMatchIntoView(editor, match.from)
        return true
      },

      prevSearchMatch: () => ({ editor, state, dispatch }: { editor: Editor; state: EditorState; dispatch: ((tr: Transaction) => void) | undefined }) => {
        const pluginState = SEARCH_KEY.getState(state)
        if (!pluginState?.matches.length || !dispatch) return false
        const prevIndex = (pluginState.currentIndex - 1 + pluginState.matches.length) % pluginState.matches.length
        dispatch(state.tr.setMeta(SEARCH_KEY, { currentIndex: prevIndex }))
        const match = pluginState.matches[prevIndex]
        scrollMatchIntoView(editor, match.from)
        return true
      },

      replaceCurrentMatch: (replacement: string) => ({ editor, tr, dispatch }: { editor: Editor; tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined }) => {
        const pluginState = SEARCH_KEY.getState(editor.state)
        if (!pluginState?.matches.length) return false
        if (!dispatch) return false
        const match = pluginState.matches[pluginState.currentIndex]
        // 直接用命令提供的 tr 操作，避免 chain 与外部 dispatch 时序冲突
        // 用 insertText 比 insertContent 更安全：跨 inline 节点也不会破坏结构
        tr.insertText(replacement, match.from, match.to)
        return true
      },

      replaceAllMatches: (replacement: string) => ({ editor, tr, dispatch }: { editor: Editor; tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined }) => {
        const pluginState = SEARCH_KEY.getState(editor.state)
        if (!pluginState?.matches.length) return false
        if (!dispatch) return false
        // 倒序替换：后面的修改不会影响前面位置
        const reversed = [...pluginState.matches].reverse()
        for (const match of reversed) {
          tr.insertText(replacement, match.from, match.to)
        }
        return true
      }
    }
  }
})

function scrollMatchIntoView(editor: Editor, pos: number): void {
  try {
    const dom = editor.view.domAtPos(pos)
    let target: HTMLElement | null = null
    if (dom.node.nodeType === Node.ELEMENT_NODE) {
      target = dom.node as HTMLElement
    } else if (dom.node.parentElement) {
      target = dom.node.parentElement
    }
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch {
    /* ignore */
  }
}
