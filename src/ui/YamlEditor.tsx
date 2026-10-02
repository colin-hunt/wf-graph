import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { yamlSchema } from 'codemirror-json-schema/yaml';
import { useEffect, useRef } from 'react';

interface Props {
  /** The text on disk. The editor follows it until the user types. */
  value: string;
  /** Autocomplete, hover docs, and errors. Without it, a plain YAML editor. */
  schema?: object;
  /** Wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  /** Line to scroll to and select, 1-based. */
  focusLine?: number;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (text: string) => void;
  /** Receives a function that returns the current text. */
  bindGetText?: (get: () => string) => void;
}

const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'var(--expo-theme-background-subtle)', color: 'var(--expo-theme-text-default)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--wf-mono)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--expo-theme-text-quaternary)' },
  // The selection is drawn behind the lines, so the active-line tint must be see-through.
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--expo-theme-text-default) 5%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--expo-theme-text-default)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--blue-4)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--blue-6)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--blue-3)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--expo-theme-background-default)',
    border: '1px solid var(--expo-theme-border-default)',
    borderRadius: '8px',
    color: 'var(--expo-theme-text-default)',
    maxWidth: '420px',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--expo-theme-background-hover)', color: 'inherit' },
  '.cm-tooltip.cm-tooltip-hover, .cm-tooltip-lint': { padding: '6px 8px', fontSize: '12px', lineHeight: '1.5' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--expo-theme-background-element)', border: 'none' },
});

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--blue-11)' },
  { tag: [t.string, t.special(t.string), t.content], color: 'var(--expo-theme-text-default)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--orange-11)' },
  { tag: [t.comment, t.lineComment], color: 'var(--expo-theme-text-tertiary)' },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace], color: 'var(--expo-theme-text-secondary)' },
  { tag: [t.keyword, t.meta, t.typeName], color: 'var(--purple-11)' },
]);

export function YamlEditor({ value, schema, wrap, focusLine, onDirtyChange, onSave, bindGetText }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const base = useRef(value);
  const callbacks = useRef({ onDirtyChange, onSave });
  callbacks.current = { onDirtyChange, onSave };

  useEffect(() => {
    const extensions: Extension[] = [
      basicSetup,
      schema ? yamlSchema(schema) : yaml(),
      theme,
      syntaxHighlighting(highlight),
      wrap ? EditorView.lineWrapping : [],
      EditorView.updateListener.of((u) => {
        if (u.docChanged) callbacks.current.onDirtyChange(u.state.doc.toString() !== base.current);
      }),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: (v) => {
            callbacks.current.onSave(v.state.doc.toString());
            return true;
          },
        },
      ]),
    ];
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions }) });
    view.current = v;
    bindGetText?.(() => v.state.doc.toString());
    return () => v.destroy();
    // The editor is created once per mount; callers remount it with `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  // Follow the file on disk while the user has no unsaved edits.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    const dirty = text !== base.current;
    base.current = value;
    if (!dirty && text !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    callbacks.current.onDirtyChange(v.state.doc.toString() !== value);
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v || !focusLine || focusLine > v.state.doc.lines) return;
    const line = v.state.doc.line(focusLine);
    v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) });
  }, [focusLine]);

  return <div className="wf-editor" ref={host} />;
}
