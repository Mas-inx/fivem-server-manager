import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

const RESOURCE_COMMANDS = new Set(['ensure', 'start', 'stop', 'restart', 'exec'])
const SET_COMMANDS = new Set(['set', 'sets', 'setr', 'seta'])

interface CfgState {
  word: number
  prev: string
}

/** server.cfg: first word is a command, `set*` is followed by a convar name, everything else is a value. */
const cfg = StreamLanguage.define<CfgState>({
  startState: () => ({ word: 0, prev: '' }),
  token(stream, state) {
    if (stream.sol()) {
      state.word = 0
      state.prev = ''
    }
    if (stream.eatSpace()) return null
    if (stream.match('#') || stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
      state.word++
      return 'string'
    }
    if (stream.match(/^-?\d+(\.\d+)?(?=\s|$)/)) {
      state.word++
      return 'number'
    }
    if (stream.match(/^\[[^\]\s]*\]/)) {
      state.word++
      return 'typeName'
    }
    const m = stream.match(/^[^\s"]+/) as RegExpMatchArray | null
    if (!m) {
      stream.next()
      return null
    }
    const word = m[0]
    const idx = state.word++
    const prev = state.prev
    state.prev = word.toLowerCase()
    if (idx === 0) return RESOURCE_COMMANDS.has(state.prev) || SET_COMMANDS.has(state.prev) ? 'keyword' : 'propertyName'
    if (idx === 1 && SET_COMMANDS.has(prev)) return 'propertyName'
    if (/^(true|false|on|off)$/i.test(word)) return 'atom'
    return null
  }
})

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: t.propertyName, color: 'var(--syn-property)' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: [t.number, t.atom], color: 'var(--syn-number)' },
  { tag: t.typeName, color: 'var(--syn-type)' },
  { tag: t.comment, color: 'var(--fg-subtle)', fontStyle: 'italic' }
])

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--fg)' },
  '.cm-content': { padding: '14px 0', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0 20px 0 12px' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--fg-faint)' },
  '.cm-gutterElement': { padding: '0 4px 0 20px !important', minWidth: '44px' },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-muted)' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)', borderLeftWidth: '1.5px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgb(127 127 140 / 0.3) !important'
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--active)' },
  '.cm-panels': { backgroundColor: 'var(--raised)', color: 'var(--fg)', borderColor: 'var(--line) !important' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-search': { padding: '8px 12px', fontFamily: 'var(--font-sans)', fontSize: '12px' },
  '.cm-search input, .cm-search button': {
    font: 'inherit',
    borderRadius: '6px',
    border: 'none',
    boxShadow: 'inset 0 0 0 1px var(--line-strong)',
    background: 'var(--sunken)',
    color: 'var(--fg)',
    padding: '3px 8px',
    margin: '0 4px 0 0'
  },
  '.cm-search label': { color: 'var(--fg-muted)', fontSize: '12px' },
  '.cm-search button[name=close]': { boxShadow: 'none', background: 'transparent', color: 'var(--fg-subtle)' },
  '.cm-searchMatch': { backgroundColor: 'rgb(229 168 59 / 0.25)' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgb(229 168 59 / 0.45)' }
})

export function CfgEditor({
  value,
  docKey,
  onChange,
  onSave
}: {
  value: string
  docKey: string
  onChange: (value: string) => void
  onSave: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const handlers = useRef({ onChange, onSave })
  handlers.current = { onChange, onSave }

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        search({ top: false }),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        cfg,
        syntaxHighlighting(highlight),
        theme,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              handlers.current.onSave()
              return true
            }
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) handlers.current.onChange(u.state.doc.toString())
        })
      ]
    })
    view.current = new EditorView({ state, parent: host.current })
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // A new document key means a different file: rebuild the editor instead of patching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // External resets (revert, reload from disk) replace the whole document.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  return <div ref={host} className="h-full min-h-0 select-text" />
}
