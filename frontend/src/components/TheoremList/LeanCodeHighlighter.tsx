const LEAN_KEYWORDS = new Set([
  'abbrev',
  'axiom',
  'by',
  'class',
  'constant',
  'def',
  'deriving',
  'else',
  'end',
  'example',
  'from',
  'fun',
  'have',
  'if',
  'import',
  'in',
  'inductive',
  'instance',
  'lemma',
  'let',
  'match',
  'namespace',
  'open',
  'section',
  'show',
  'structure',
  'theorem',
  'then',
  'variable',
  'where',
  'with',
]);

type TokenKind =
  | 'plain'
  | 'keyword'
  | 'comment'
  | 'string'
  | 'number'
  | 'directive'
  | 'identifier';

interface Token {
  kind: TokenKind;
  value: string;
}

interface TokenizeState {
  blockCommentDepth: number;
}

interface LeanCodeHighlighterProps {
  code: string;
}

function isIdentifierStart(char: string) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_'.]/.test(char);
}

function tokenizeLine(line: string, state: TokenizeState): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  const push = (kind: TokenKind, value: string) => {
    if (!value) {
      return;
    }
    tokens.push({ kind, value });
  };

  while (cursor < line.length) {
    if (state.blockCommentDepth > 0) {
      const start = cursor;
      while (cursor < line.length) {
        const pair = line.slice(cursor, cursor + 2);
        if (pair === '/-') {
          state.blockCommentDepth += 1;
          cursor += 2;
          continue;
        }
        if (pair === '-/') {
          state.blockCommentDepth -= 1;
          cursor += 2;
          if (state.blockCommentDepth === 0) {
            break;
          }
          continue;
        }
        cursor += 1;
      }
      push('comment', line.slice(start, cursor));
      continue;
    }

    const pair = line.slice(cursor, cursor + 2);
    const char = line[cursor];

    if (pair === '--') {
      push('comment', line.slice(cursor));
      break;
    }

    if (pair === '/-') {
      const start = cursor;
      state.blockCommentDepth = 1;
      cursor += 2;
      while (cursor < line.length && state.blockCommentDepth > 0) {
        const nestedPair = line.slice(cursor, cursor + 2);
        if (nestedPair === '/-') {
          state.blockCommentDepth += 1;
          cursor += 2;
          continue;
        }
        if (nestedPair === '-/') {
          state.blockCommentDepth -= 1;
          cursor += 2;
          continue;
        }
        cursor += 1;
      }
      push('comment', line.slice(start, cursor));
      continue;
    }

    if (char === '"') {
      const start = cursor;
      cursor += 1;
      while (cursor < line.length) {
        if (line[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (line[cursor] === '"') {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      push('string', line.slice(start, cursor));
      continue;
    }

    if (char === '#') {
      const start = cursor;
      cursor += 1;
      while (cursor < line.length && isIdentifierPart(line[cursor])) {
        cursor += 1;
      }
      push('directive', line.slice(start, cursor));
      continue;
    }

    if (/[0-9]/.test(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < line.length && /[0-9._]/.test(line[cursor])) {
        cursor += 1;
      }
      push('number', line.slice(start, cursor));
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = cursor;
      cursor += 1;
      while (cursor < line.length && isIdentifierPart(line[cursor])) {
        cursor += 1;
      }
      const value = line.slice(start, cursor);
      push(LEAN_KEYWORDS.has(value) ? 'keyword' : 'identifier', value);
      continue;
    }

    const start = cursor;
    cursor += 1;
    while (
      cursor < line.length &&
      !/[0-9A-Za-z_#"/-]/.test(line[cursor]) &&
      line.slice(cursor, cursor + 2) !== '--' &&
      line.slice(cursor, cursor + 2) !== '/-'
    ) {
      cursor += 1;
    }
    push('plain', line.slice(start, cursor));
  }

  return tokens;
}

export function LeanCodeHighlighter({ code }: LeanCodeHighlighterProps) {
  const lines = code.split('\n');
  const state: TokenizeState = { blockCommentDepth: 0 };

  return (
    <div className="lean-code-block" role="region" aria-label="Lean code">
      {lines.map((line, lineIndex) => {
        const tokens = tokenizeLine(line, state);
        return (
          <div key={lineIndex} className="lean-code-line">
            <span className="lean-code-line-number">{lineIndex + 1}</span>
            <span className="lean-code-line-content">
              {tokens.length > 0 ? (
                tokens.map((token, tokenIndex) => (
                  <span
                    key={`${lineIndex}-${tokenIndex}`}
                    className={`lean-token lean-token-${token.kind}`}
                  >
                    {token.value}
                  </span>
                ))
              ) : (
                <span className="lean-token lean-token-plain">{' '}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
