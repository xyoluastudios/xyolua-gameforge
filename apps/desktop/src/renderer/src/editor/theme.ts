import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** "Forge" dark theme — matches the app's palette. */
export const forgeTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#16191f', color: '#d6dbe3', fontSize: '13px', height: '100%' },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Consolas, monospace",
      lineHeight: '1.6',
    },
    '.cm-content': { caretColor: '#e8a33a', padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e8a33a', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(232, 163, 58, 0.22) !important',
    },
    '.cm-gutters': {
      backgroundColor: '#16191f',
      color: '#4d5564',
      border: 'none',
      paddingRight: '6px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a3acba' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(90, 162, 240, 0.14)' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(232, 163, 58, 0.18)', outline: 'none' },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(217, 181, 63, 0.25)',
      outline: '1px solid rgba(217,181,63,0.5)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(232, 163, 58, 0.45)' },
    '.cm-panels': {
      backgroundColor: '#13161b',
      color: '#d6dbe3',
      borderBottom: '1px solid #252a33',
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #252a33' },
    '.cm-panel input, .cm-panel button': { fontSize: '12px' },
    '.cm-textfield': {
      backgroundColor: '#0f1216',
      border: '1px solid #333a47',
      borderRadius: '4px',
      color: '#d6dbe3',
    },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: '#1d2129',
      border: '1px solid #333a47',
      borderRadius: '4px',
      color: '#d6dbe3',
    },
    '.cm-tooltip': { backgroundColor: '#13161b', border: '1px solid #333a47', borderRadius: '6px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#242a35',
      color: '#d6dbe3',
    },
    '.cm-foldPlaceholder': { backgroundColor: '#242a35', border: 'none', color: '#8a93a3' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #e5534b' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #d9b53f' },
    '.cm-diagnostic': { padding: '4px 8px' },
    '.cm-diagnostic-error': { borderLeft: '3px solid #e5534b' },
    '.cm-diagnostic-warning': { borderLeft: '3px solid #d9b53f' },
    '.cm-changedLine': { backgroundColor: 'rgba(76,195,138,0.08) !important' },
    '.cm-deletedChunk': { backgroundColor: 'rgba(229,83,75,0.1) !important' },
    '.cm-changedText': { background: 'rgba(76,195,138,0.25) !important' },
    '.cm-merge-a .cm-changedLine, .cm-merge-a .cm-changedText': {
      backgroundColor: 'rgba(229,83,75,0.12) !important',
    },
  },
  { dark: true },
);

export const forgeHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.keyword, color: '#e8a33a' },
    { tag: [t.atom, t.bool, t.null], color: '#d98cf0' },
    { tag: t.number, color: '#f0a66d' },
    { tag: t.string, color: '#9ccf8d' },
    { tag: [t.comment, t.lineComment], color: '#5f6878', fontStyle: 'italic' },
    { tag: t.docComment, color: '#7d8a9e', fontStyle: 'italic' },
    { tag: t.meta, color: '#ab86ee' },
    { tag: t.typeName, color: '#6cc5d9' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#8fb8f7' },
    { tag: t.labelName, color: '#e6c07b' },
    { tag: t.operator, color: '#a3acba' },
    { tag: t.propertyName, color: '#8fb8f7' },
    { tag: t.heading, color: '#e8a33a', fontWeight: '600' },
    { tag: t.variableName, color: '#d6dbe3' },
  ]),
);
