import type * as Monaco from 'monaco-editor';

let isConfigured = false;

const leanKeywords = [
  'theorem',
  'lemma',
  'axiom',
  'example',
  'by',
  'have',
  'show',
  'exact',
  'simp',
  'rw',
  'calc',
  'match',
  'fun',
  'let',
  'where',
  'inductive',
  'structure',
  'namespace',
  'open',
  'import',
  'variable',
  'def',
];

const rocqKeywords = [
  'Theorem',
  'Lemma',
  'Proof',
  'Qed',
  'Defined',
  'intros',
  'apply',
  'exact',
  'rewrite',
  'simpl',
  'induction',
  'match',
  'Fixpoint',
  'Definition',
  'Require',
  'Import',
];

export function configureFormalMonaco(monaco: typeof Monaco) {
  if (isConfigured) {
    return;
  }

  isConfigured = true;

  monaco.languages.register({ id: 'prooftext' });
  monaco.languages.register({ id: 'lean4' });
  monaco.languages.register({ id: 'rocq' });

  monaco.languages.setMonarchTokensProvider('prooftext', {
    tokenizer: {
      root: [
        [/\b(Theorem|Lemma|Claim|Corollary|Proof|Suppose|Assume|Therefore)\b/, 'keyword'],
        [/\[[^\]]+\]/, 'annotation'],
      ],
    },
  });

  monaco.languages.setMonarchTokensProvider('lean4', {
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/-/, { token: 'comment', next: '@comment' }],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', next: '@string' }],
        [/\b(True|False|Nat|Int|Prop|Type)\b/, 'type.identifier'],
        [new RegExp(`\\b(?:${leanKeywords.join('|')})\\b`), 'keyword'],
        [/\b[A-Z][\w']*\b/, 'type.identifier'],
        [/\b[a-zA-Z_][\w']*\b/, 'identifier'],
        [/[{}()[\]]/, '@brackets'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
      comment: [
        [/[^\-\/]+/, 'comment'],
        [/-/, 'comment'],
        [/\/-/, { token: 'comment', next: '@push' }],
        [/-\//, { token: 'comment', next: '@pop' }],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration('lean4', {
    comments: {
      lineComment: '--',
      blockComment: ['/-', '-/'],
    },
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('rocq', {
    tokenizer: {
      root: [
        [/\(\*/, { token: 'comment', next: '@comment' }],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', next: '@string' }],
        [new RegExp(`\\b(?:${rocqKeywords.join('|')})\\b`), 'keyword'],
        [/\b(True|False|nat|Prop|Type)\b/, 'type.identifier'],
        [/\b[A-Z][\w']*\b/, 'type.identifier'],
        [/\b[a-zA-Z_][\w']*\b/, 'identifier'],
        [/[{}()[\]]/, '@brackets'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
      comment: [
        [/[^(*]+/, 'comment'],
        [/\(\*/, { token: 'comment', next: '@push' }],
        [/\*\)/, { token: 'comment', next: '@pop' }],
        [/[*()]/, 'comment'],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration('rocq', {
    comments: {
      blockComment: ['(*', '*)'],
    },
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  });

  monaco.editor.defineTheme('shannon-proof-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '8bc7ff', fontStyle: 'bold' },
      { token: 'type.identifier', foreground: 'ffd479' },
      { token: 'comment', foreground: '6c7a91' },
      { token: 'string', foreground: 'b8f1a8' },
      { token: 'annotation', foreground: 'f5a97f' },
    ],
    colors: {
      'editor.background': '#05080f',
      'editor.lineHighlightBackground': '#121827',
      'editorCursor.foreground': '#00d4ff',
      'editorLineNumber.foreground': '#5d6b84',
      'editorLineNumber.activeForeground': '#dce7ff',
      'editor.selectionBackground': '#24324f',
      'editor.inactiveSelectionBackground': '#1b2435',
      'editorIndentGuide.background1': '#172033',
      'editorIndentGuide.activeBackground1': '#32415f',
      'editorBracketMatch.background': '#1f3155',
      'editorBracketMatch.border': '#6ea6ff',
    },
  });
}
