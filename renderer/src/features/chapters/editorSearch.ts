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
    return [
      new Plugin<SearchPluginState>({
        key: SEARCH_KEY,
        state: {
          init(): SearchPluginState {
            return { term: '', caseSensitive: false, matches: [], currentIndex: 0, decorations: DecorationSet.empty }
          },
          apply(tr, prev): SearchPluginState {
            const meta = tr.getMeta(SEARCH_KEY) as Partial<SearchPluginState> | undefined
            if (meta) {
              const term = meta.term ?? prev.term
              const caseSensitive = meta.caseSensitive ?? prev.caseSensitive
              const matches = meta.term !== undefined ? findMatches(tr.doc, term, caseSensitive) : prev.matches
              const currentIndex = meta.currentIndex !== undefined
                ? Math.max(0, Math.min(meta.currentIndex, Math.max(0, matches.length - 1)))
                : prev.currentIndex
              return { term, caseSensitive, matches, currentIndex, decorations: buildDecorations(tr.doc, matches, currentIndex) }
            }
            if (tr.docChanged && prev.term) {
              const matches = findMatches(tr.doc, prev.term, prev.caseSensitive)
              const currentIndex = Math.max(0, Math.min(prev.currentIndex, Math.max(0, matches.length - 1)))
              return { ...prev, matches, currentIndex, decorations: buildDecorations(tr.doc, matches, currentIndex) }
            }
            return prev
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
        const storage = editor.storage.editorSearch
        storage.matches = pluginState?.matches ?? []
        storage.currentIndex = 0
        const first = pluginState?.matches[0]
        if (first) {
          editor.chain().setTextSelection(first).scrollIntoView().run()
        }
        return true
      },

      nextSearchMatch: () => ({ editor, state, dispatch }: { editor: Editor; state: EditorState; dispatch: ((tr: Transaction) => void) | undefined }) => {
        const pluginState = SEARCH_KEY.getState(state)
        if (!pluginState?.matches.length || !dispatch) return false
        const nextIndex = (pluginState.currentIndex + 1) % pluginState.matches.length
        dispatch(state.tr.setMeta(SEARCH_KEY, { currentIndex: nextIndex }))
        editor.storage.editorSearch.currentIndex = nextIndex
        const match = pluginState.matches[nextIndex]
        editor.chain().setTextSelection(match).scrollIntoView().run()
        return true
      },

      prevSearchMatch: () => ({ editor, state, dispatch }: { editor: Editor; state: EditorState; dispatch: ((tr: Transaction) => void) | undefined }) => {
        const pluginState = SEARCH_KEY.getState(state)
        if (!pluginState?.matches.length || !dispatch) return false
        const prevIndex = (pluginState.currentIndex - 1 + pluginState.matches.length) % pluginState.matches.length
        dispatch(state.tr.setMeta(SEARCH_KEY, { currentIndex: prevIndex }))
        editor.storage.editorSearch.currentIndex = prevIndex
        const match = pluginState.matches[prevIndex]
        editor.chain().setTextSelection(match).scrollIntoView().run()
        return true
      },

      replaceCurrentMatch: (replacement: string) => ({ editor, state }: { editor: Editor; state: EditorState }) => {
        const pluginState = SEARCH_KEY.getState(state)
        if (!pluginState?.matches.length) return false
        const match = pluginState.matches[pluginState.currentIndex]
        editor.chain().setTextSelection(match).insertContent(replacement).run()
        return true
      },

      replaceAllMatches: (replacement: string) => ({ editor, state }: { editor: Editor; state: EditorState }) => {
        const pluginState = SEARCH_KEY.getState(state)
        if (!pluginState?.matches.length) return false
        const reversed = [...pluginState.matches].reverse()
        const chain = editor.chain()
        for (const match of reversed) {
          chain.setTextSelection(match).insertContent(replacement)
        }
        chain.run()
        return true
      }
    }
  }
})
