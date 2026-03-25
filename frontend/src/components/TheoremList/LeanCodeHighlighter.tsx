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

export interface LeanPdfMappingItem {
  symbol_name: string;
  declaration_kind: string;
  start_line: number;
  end_line: number;
  pdf_page: number | null;
  pdf_excerpt: string;
  confidence: number | null;
  reason: string | null;
}

export interface LeanDeclarationAnchor {
  declaration_kind: string;
  symbol_name: string;
  start_line: number;
  end_line: number;
}

interface LeanCodeHighlighterProps {
  code: string;
  mappingItems?: LeanPdfMappingItem[];
  activeSymbolName?: string | null;
  onDeclarationHover?: (item: LeanPdfMappingItem | null) => void;
  onDeclarationSelect?: (declaration: LeanDeclarationAnchor) => void;
  selectedDeclarationKey?: string | null;
  declarationDiscussionCounts?: Record<string, number>;
}

const TOP_LEVEL_DECLARATION_RE =
  /^\s*(theorem|lemma|def|structure|inductive|class|abbrev|instance)\s+([A-Za-z0-9_'.]+)/;

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

export function buildLeanDeclarationKey(symbolName: string, startLine: number) {
  return `${symbolName}:${startLine}`;
}

function extractDeclarationRanges(code: string): LeanDeclarationAnchor[] {
  const lines = code.split('\n');
  if (lines.length === 0) {
    return [];
  }

  const declarations: LeanDeclarationAnchor[] = [];
  let current: Omit<LeanDeclarationAnchor, 'end_line'> | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const match = line.match(TOP_LEVEL_DECLARATION_RE);
    if (!match) {
      continue;
    }
    if (current) {
      declarations.push({
        declaration_kind: current.declaration_kind,
        symbol_name: current.symbol_name,
        start_line: current.start_line,
        end_line: lineNumber - 1,
      });
    }
    current = {
      declaration_kind: match[1],
      symbol_name: match[2],
      start_line: lineNumber,
    };
  }

  if (current !== null) {
    declarations.push({
      declaration_kind: current.declaration_kind,
      symbol_name: current.symbol_name,
      start_line: current.start_line,
      end_line: lines.length,
    });
  }
  return declarations;
}

export function LeanCodeHighlighter({
  code,
  mappingItems = [],
  activeSymbolName = null,
  onDeclarationHover,
  onDeclarationSelect,
  selectedDeclarationKey = null,
  declarationDiscussionCounts = {},
}: LeanCodeHighlighterProps) {
  const lines = code.split('\n');
  const state: TokenizeState = { blockCommentDepth: 0 };
  const declarationRanges = extractDeclarationRanges(code);
  const mappedRanges = declarationRanges
    .map((range) => {
      const item = mappingItems.find(
        (candidate) =>
          candidate.symbol_name === range.symbol_name &&
          candidate.start_line === range.start_line,
      );
      return item
        ? {
            ...range,
            item,
          }
        : null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const findMappedRangeByLine = (lineNumber: number) =>
    mappedRanges.find((range) => lineNumber >= range.start_line && lineNumber <= range.end_line) ?? null;

  const findDeclarationByLine = (lineNumber: number) =>
    declarationRanges.find(
      (range) => lineNumber >= range.start_line && lineNumber <= range.end_line,
    ) ?? null;

  return (
    <div className="lean-code-block" role="region" aria-label="Lean code">
      {lines.map((line, lineIndex) => {
        const tokens = tokenizeLine(line, state);
        const lineNumber = lineIndex + 1;
        const mappedRange = findMappedRangeByLine(lineNumber);
        const declarationRange = findDeclarationByLine(lineNumber);
        const isActive = Boolean(
          mappedRange && activeSymbolName && mappedRange.item.symbol_name === activeSymbolName,
        );
        const declarationKey = declarationRange
          ? buildLeanDeclarationKey(declarationRange.symbol_name, declarationRange.start_line)
          : null;
        const isSelected = Boolean(
          declarationKey && selectedDeclarationKey && declarationKey === selectedDeclarationKey,
        );
        const threadCount =
          declarationRange && declarationRange.start_line === lineNumber && declarationKey
            ? declarationDiscussionCounts[declarationKey] ?? 0
            : 0;
        return (
          <div
            key={lineIndex}
            className={`lean-code-line${mappedRange ? ' is-mapped' : ''}${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${declarationRange ? ' is-declaration' : ''}`}
            onMouseEnter={() => onDeclarationHover?.(mappedRange?.item ?? null)}
            onMouseLeave={() => onDeclarationHover?.(null)}
            onClick={() => {
              if (declarationRange) {
                onDeclarationSelect?.(declarationRange);
              }
            }}
          >
            <span className="lean-code-line-number">
              <span>{lineIndex + 1}</span>
              {threadCount > 0 ? (
                <span className="lean-code-discussion-badge">{threadCount}</span>
              ) : null}
            </span>
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
