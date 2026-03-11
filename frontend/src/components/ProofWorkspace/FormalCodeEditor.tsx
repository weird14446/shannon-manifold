import Editor from '@monaco-editor/react';
import { Columns2, FileText } from 'lucide-react';

import { configureFormalMonaco } from './monacoSetup';

type FormalLanguage = 'prooftext' | 'lean4' | 'rocq';

interface FormalCodeEditorProps {
  language: FormalLanguage;
  title: string;
  value: string;
  onChange: (value: string) => void;
}

export function FormalCodeEditor({
  language,
  title,
  value,
  onChange,
}: FormalCodeEditorProps) {
  const lineCount = value ? value.split('\n').length : 1;

  return (
    <div className="formal-editor-shell">
      <div className="formal-editor-titlebar">
        <div>
          <div className="formal-editor-title">{title}</div>
          <div className="formal-editor-subtitle">Mode: {language}</div>
        </div>
        <div className="formal-editor-icons">
          <span>
            <Columns2 size={14} />
            Infoview
          </span>
          <span>
            <FileText size={14} />
            {lineCount} lines
          </span>
        </div>
      </div>

      <div className="formal-editor-surface">
        <Editor
          beforeMount={configureFormalMonaco}
          height="100%"
          language={language}
          theme="shannon-proof-dark"
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? '')}
          options={{
            automaticLayout: true,
            fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
            fontLigatures: true,
            fontSize: 14,
            lineHeight: 22,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            tabSize: 2,
            wordWrap: 'on',
            glyphMargin: true,
            folding: true,
            renderLineHighlight: 'all',
            padding: { top: 16, bottom: 16 },
            suggestOnTriggerCharacters: true,
            quickSuggestions: {
              other: true,
              comments: false,
              strings: false,
            },
          }}
        />
      </div>

      <div className="formal-editor-statusbar">
        <span>{language === 'prooftext' ? 'Text workspace' : `${language} drafting mode`}</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}
