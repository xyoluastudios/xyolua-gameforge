import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { languageFor } from './languages';
import { forgeHighlight, forgeTheme } from './theme';

export interface EditorDiagnostic {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

interface Props {
  path: string;
  value: string;
  readOnly?: boolean;
  diagnostics?: EditorDiagnostic[];
  revealLine?: { line: number; at: number } | null;
  onChange?: (content: string) => void;
  onSave?: (content: string) => void;
  onAiEdit?: (selection: { startLine: number; endLine: number; text: string } | undefined) => void;
}

export function CodeEditor({
  path,
  value,
  readOnly,
  diagnostics,
  revealLine,
  onChange,
  onSave,
  onAiEdit,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave, onAiEdit });
  callbacks.current = { onChange, onSave, onAiEdit };

  useEffect(() => {
    if (!host.current) return;
    const usesTabs = path.endsWith('.gd') || path.endsWith('.tscn') || path.endsWith('.godot');
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of(usesTabs ? '\t' : '  '),
        EditorState.tabSize.of(4),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        lintGutter(),
        forgeTheme,
        forgeHighlight,
        ...languageFor(path),
        EditorState.readOnly.of(!!readOnly),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: (v) => {
              callbacks.current.onSave?.(v.state.doc.toString());
              return true;
            },
          },
          {
            key: 'Mod-i',
            preventDefault: true,
            run: (v) => {
              const range = v.state.selection.main;
              if (range.empty) callbacks.current.onAiEdit?.(undefined);
              else {
                const start = v.state.doc.lineAt(range.from).number;
                const end = v.state.doc.lineAt(range.to).number;
                callbacks.current.onAiEdit?.({
                  startLine: start,
                  endLine: end,
                  text: v.state.sliceDoc(range.from, range.to),
                });
              }
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange?.(update.state.doc.toString());
        }),
      ],
    });
    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Recreate only when the file or read-only mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly]);

  // External content updates (file changed on disk, changes applied).
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value)
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const doc = editor.state.doc;
    const items: Diagnostic[] = (diagnostics ?? [])
      .filter((d) => d.line >= 1 && d.line <= doc.lines)
      .map((d) => {
        const line = doc.line(d.line);
        return {
          from: line.from,
          to: Math.max(line.from, line.to),
          severity: d.severity,
          message: d.message,
        };
      });
    editor.dispatch(setDiagnostics(editor.state, items));
  }, [diagnostics, value]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !revealLine) return;
    const doc = editor.state.doc;
    const line = doc.line(Math.min(Math.max(revealLine.line, 1), doc.lines));
    editor.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    editor.focus();
  }, [revealLine]);

  return <div className="editor-host" ref={host} data-testid="code-editor" />;
}
