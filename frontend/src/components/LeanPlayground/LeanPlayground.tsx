import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Check,
  CloudUpload,
  Copy,
  ExternalLink,
  FileUp,
  Github,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { LeanMonaco, LeanMonacoEditor, type LeanMonacoOptions } from 'lean4monaco';
import {
  getLeanWorkspaceInfo,
  pushLeanPlaygroundToGithub,
  syncLeanPlaygroundToWorkspace,
  type AuthUser,
  type LeanWorkspaceInfo,
} from '../../api';
import 'lean4monaco/dist/css/custom.css';
import 'lean4monaco/dist/css/vscode_webview.css';

const PLAYGROUND_FILE_PATH = 'ShannonManifold/Playground.lean';
const PLAYGROUND_STORAGE_KEY = 'shannon-manifold-lean-playground';

const EXAMPLES = [
  {
    id: 'hello',
    title: 'Hello Lean',
    description: 'Start with the shared Shannon Manifold workspace modules.',
    code: `import ShannonManifold

open ShannonManifold

#eval banner
#eval proofGreeting

example : 2 + 2 = 4 := by
  decide

#check pythagoreanStatement
`,
  },
  {
    id: 'functions',
    title: 'Functions',
    description: 'A small definition and a theorem about it.',
    code: `def twice (n : Nat) : Nat :=
  n + n

#eval twice 7

theorem twice_zero : twice 0 = 0 := by
  rfl
`,
  },
  {
    id: 'structures',
    title: 'Structure',
    description: 'Simple data declarations and pattern matching.',
    code: `structure Point where
  x : Nat
  y : Nat

def swapPoint (p : Point) : Point :=
  { x := p.y, y := p.x }

#eval swapPoint { x := 2, y := 5 }
`,
  },
] as const;

const DEFAULT_EXAMPLE = EXAMPLES[0];

export interface LeanPlaygroundSeed {
  code: string;
  revision: number;
  title: string;
}

interface LeanPlaygroundProps {
  seed: LeanPlaygroundSeed | null;
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => void;
}

interface PlaygroundDocument {
  code: string;
  title: string;
}

const getDefaultWebSocketUrl = () => {
  if (typeof window === 'undefined') {
    return 'ws://localhost:8080/';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8080/`;
};

const encodeSharedCode = (code: string) => {
  const bytes = new TextEncoder().encode(code);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window.btoa(binary);
};

const decodeSharedCode = (value: string) => {
  const binary = window.atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const readDocumentFromUrl = (): PlaygroundDocument | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const encodedCode = params.get('leanCode');
  if (!encodedCode) {
    return null;
  }

  try {
    return {
      code: decodeSharedCode(encodedCode),
      title: params.get('leanTitle') || 'Shared Lean Playground',
    };
  } catch (error) {
    console.error('Failed to decode shared Lean code:', error);
    return null;
  }
};

const readDocumentFromStorage = (): PlaygroundDocument | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(PLAYGROUND_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as PlaygroundDocument;
    if (!parsed.code) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('Failed to parse stored Lean playground state:', error);
    return null;
  }
};

const resolveInitialDocument = (seed: LeanPlaygroundSeed | null): PlaygroundDocument => {
  if (seed?.code) {
    return { code: seed.code, title: seed.title };
  }

  return (
    readDocumentFromUrl() ??
    readDocumentFromStorage() ?? {
      code: DEFAULT_EXAMPLE.code,
      title: DEFAULT_EXAMPLE.title,
    }
  );
};

const INFOVIEW_THEME_STYLE_ID = 'shannon-infoview-theme';

const applyInfoviewFrameTheme = (iframe: HTMLIFrameElement) => {
  const documentRef = iframe.contentDocument;
  if (!documentRef) {
    return;
  }

  let styleElement = documentRef.getElementById(INFOVIEW_THEME_STYLE_ID);
  if (!styleElement) {
    styleElement = documentRef.createElement('style');
    styleElement.id = INFOVIEW_THEME_STYLE_ID;
    styleElement.textContent = `
      html,
      body {
        height: 100% !important;
        overflow: auto !important;
        background: transparent !important;
        color: #eef6ff !important;
      }

      #react_root {
        min-height: 100% !important;
        overflow: auto !important;
        background: transparent !important;
        color: #eef6ff !important;
      }

      body {
        margin: 0 !important;
        padding: 0 !important;
        background:
          radial-gradient(circle at top left, rgba(0, 212, 255, 0.08), transparent 26%),
          linear-gradient(180deg, rgba(6, 10, 18, 0.98), rgba(3, 6, 11, 0.98)) !important;
      }

      body::-webkit-scrollbar,
      #react_root::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }

      body::-webkit-scrollbar-track,
      #react_root::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.04);
      }

      body::-webkit-scrollbar-thumb,
      #react_root::-webkit-scrollbar-thumb {
        background: rgba(34, 199, 255, 0.32);
        border-radius: 999px;
      }

      #react_root,
      #react_root > div,
      #react_root details,
      #react_root summary,
      #react_root div,
      #react_root section,
      #react_root article {
        background-color: transparent !important;
        color: inherit !important;
      }

      #react_root > div:first-child {
        min-height: 100% !important;
      }

      #react_root a,
      #react_root .link,
      #react_root .codicon {
        color: #22c7ff !important;
      }

      #react_root pre,
      #react_root code,
      #react_root kbd {
        background: rgba(255, 255, 255, 0.07) !important;
        color: #eef6ff !important;
      }

      #react_root button,
      #react_root input,
      #react_root textarea,
      #react_root select {
        background: rgba(15, 20, 32, 0.9) !important;
        color: #eef6ff !important;
        border-color: rgba(255, 255, 255, 0.14) !important;
      }

      #react_root [style*="background-color: rgb(255, 255, 255)"],
      #react_root [style*="background-color:#fff"],
      #react_root [style*="background-color: white"],
      #react_root .bg-white,
      #react_root .near-white {
        background: rgba(13, 18, 30, 0.94) !important;
        color: #eef6ff !important;
      }

      #react_root * {
        border-color: rgba(255, 255, 255, 0.12) !important;
      }
    `;
    documentRef.head.appendChild(styleElement);
  }
};

export function LeanPlayground({
  seed,
  currentUser,
  onOpenAuth,
  onLogout,
}: LeanPlaygroundProps) {
  const sharedDocument = readDocumentFromUrl();
  const initialDocument = resolveInitialDocument(seed);
  const githubRepositoryUrl = import.meta.env.VITE_GITHUB_REPOSITORY_URL?.trim();
  const [currentCode, setCurrentCode] = useState(initialDocument.code);
  const [currentTitle, setCurrentTitle] = useState(initialDocument.title);
  const [selectedExampleId, setSelectedExampleId] = useState<string>(
    seed?.code ? 'workspace' : sharedDocument ? 'shared' : DEFAULT_EXAMPLE.id,
  );
  const [editorStatus, setEditorStatus] = useState<'booting' | 'ready' | 'error'>('booting');
  const [editorError, setEditorError] = useState('');
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [baselineDocument, setBaselineDocument] = useState(initialDocument);
  const [workspaceInfo, setWorkspaceInfo] = useState<LeanWorkspaceInfo | null>(null);
  const [workspaceAction, setWorkspaceAction] = useState<'idle' | 'syncing' | 'pushing'>('idle');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [workspaceNoticeTone, setWorkspaceNoticeTone] = useState<'success' | 'error'>('success');

  const editorRef = useRef<HTMLDivElement>(null);
  const infoviewRef = useRef<HTMLDivElement>(null);
  const leanMonacoRef = useRef<LeanMonaco | null>(null);
  const leanEditorRef = useRef<LeanMonacoEditor | null>(null);
  const applyingExternalCodeRef = useRef(false);
  const latestCodeRef = useRef(initialDocument.code);
  const codeUploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      PLAYGROUND_STORAGE_KEY,
      JSON.stringify({
        code: currentCode,
        title: currentTitle,
      }),
    );

    latestCodeRef.current = currentCode;
  }, [currentCode, currentTitle]);

  useEffect(() => {
    let isCancelled = false;
    let modelDispose: { dispose: () => void } | undefined;

    const bootEditor = async () => {
      if (!editorRef.current || !infoviewRef.current) {
        return;
      }

      setEditorStatus('booting');
      setEditorError('');

      const leanMonaco = new LeanMonaco();
      const leanEditor = new LeanMonacoEditor();
      leanMonacoRef.current = leanMonaco;
      leanEditorRef.current = leanEditor;
      leanMonaco.setInfoviewElement(infoviewRef.current);

      const options: LeanMonacoOptions = {
        websocket: {
          url: import.meta.env.VITE_LEAN_WS_URL || getDefaultWebSocketUrl(),
        },
        htmlElement: editorRef.current ?? undefined,
        vscode: {
          'editor.wordWrap': 'on',
          'editor.minimap.enabled': false,
          'editor.stickyScroll.enabled': false,
          'editor.folding': true,
          'editor.fontLigatures': true,
          'workbench.colorTheme': 'Default Dark+',
        },
      };

      try {
        await leanMonaco.start(options);
        if (isCancelled) {
          return;
        }

        await leanEditor.start(editorRef.current, PLAYGROUND_FILE_PATH, latestCodeRef.current);
        if (isCancelled) {
          return;
        }

        leanEditor.editor.updateOptions({
          wordWrap: 'on',
          minimap: { enabled: false },
          stickyScroll: { enabled: false },
          fontLigatures: true,
        });

        const model = leanEditor.editor.getModel();
        modelDispose = model?.onDidChangeContent(() => {
          if (applyingExternalCodeRef.current) {
            return;
          }

          setCurrentCode(model.getValue());
        });

        setEditorStatus('ready');
      } catch (error) {
        console.error('Lean playground bootstrap failed:', error);
        setEditorStatus('error');
        setEditorError(error instanceof Error ? error.message : 'Lean playground failed to start.');
      }
    };

    void bootEditor();

    return () => {
      isCancelled = true;
      modelDispose?.dispose();
      leanEditorRef.current?.dispose();
      leanMonacoRef.current?.dispose();
      leanEditorRef.current = null;
      leanMonacoRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!infoviewRef.current) {
      return;
    }

    let detachLoadListener: (() => void) | null = null;

    const bindInfoviewTheme = () => {
      const iframe = infoviewRef.current?.querySelector('iframe');
      if (!iframe) {
        return;
      }

      const handleLoad = () => {
        applyInfoviewFrameTheme(iframe);
      };

      iframe.addEventListener('load', handleLoad);
      applyInfoviewFrameTheme(iframe);
      detachLoadListener = () => iframe.removeEventListener('load', handleLoad);
    };

    bindInfoviewTheme();

    const observer = new MutationObserver(() => {
      detachLoadListener?.();
      detachLoadListener = null;
      bindInfoviewTheme();
    });

    observer.observe(infoviewRef.current, {
      childList: true,
      subtree: true,
    });

    return () => {
      detachLoadListener?.();
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadWorkspaceInfo = async () => {
      try {
        const info = await getLeanWorkspaceInfo();
        if (isMounted) {
          setWorkspaceInfo(info);
        }
      } catch (error) {
        console.error('Failed to load Lean workspace info:', error);
        if (isMounted) {
          setWorkspaceNoticeTone('error');
          setWorkspaceNotice('Failed to load Lean workspace metadata.');
        }
      }
    };

    void loadWorkspaceInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!seed?.code || seed.revision === 0) {
      return;
    }

    applyDocument({
      code: seed.code,
      title: seed.title,
      exampleId: 'workspace',
    });
  }, [seed?.code, seed?.revision, seed?.title]);

  const applyDocument = ({
    code,
    title,
    exampleId,
  }: {
    code: string;
    title: string;
    exampleId: string;
  }) => {
    latestCodeRef.current = code;
    setCurrentCode(code);
    setCurrentTitle(title);
    setSelectedExampleId(exampleId);
    setBaselineDocument({ code, title });
    setShareState('idle');

    const model = leanEditorRef.current?.editor?.getModel();
    if (!model) {
      return;
    }

    applyingExternalCodeRef.current = true;
    try {
      model.setValue(code);
      leanEditorRef.current?.editor.setPosition({ lineNumber: 1, column: 1 });
      leanEditorRef.current?.editor.focus();
    } finally {
      applyingExternalCodeRef.current = false;
    }
  };

  const handleLoadExample = (exampleId: string) => {
    if (exampleId === 'workspace' && seed?.code) {
      applyDocument({
        code: seed.code,
        title: seed.title,
        exampleId: 'workspace',
      });
      return;
    }

    if (exampleId === 'shared') {
      if (!sharedDocument) {
        return;
      }

      applyDocument({
        code: sharedDocument.code,
        title: sharedDocument.title,
        exampleId: 'shared',
      });
      return;
    }

    const example = EXAMPLES.find((item) => item.id === exampleId);
    if (!example) {
      return;
    }

    applyDocument({
      code: example.code,
      title: example.title,
      exampleId: example.id,
    });
  };

  const handleReset = () => {
    applyDocument({
      code: baselineDocument.code,
      title: baselineDocument.title,
      exampleId: selectedExampleId,
    });
  };

  const handleRestartLean = () => {
    leanMonacoRef.current?.restart();
  };

  const handleSyncWorkspace = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setWorkspaceAction('syncing');
    setWorkspaceNotice('');

    try {
      const response = await syncLeanPlaygroundToWorkspace({
        code: currentCode,
        title: currentTitle,
      });
      setWorkspaceInfo(response);
      setWorkspaceNoticeTone('success');
      setWorkspaceNotice(`Synced ${response.saved_module} into the Lean workspace.`);
    } catch (error: any) {
      console.error('Failed to sync Lean workspace:', error);
      setWorkspaceNoticeTone('error');
      if (error?.response?.status === 401) {
        onLogout();
        onOpenAuth();
        setWorkspaceNotice('Your session expired. Please sign in again.');
      } else {
        setWorkspaceNotice(
          error?.response?.data?.detail ?? 'Failed to sync the Lean playground file.',
        );
      }
    } finally {
      setWorkspaceAction('idle');
    }
  };

  const handlePushGithub = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setWorkspaceAction('pushing');
    setWorkspaceNotice('');

    try {
      const response = await pushLeanPlaygroundToGithub({
        code: currentCode,
        title: currentTitle,
      });
      setWorkspaceInfo(response);
      setWorkspaceNoticeTone('success');
      setWorkspaceNotice(
        response.remote_content_url
          ? `Pushed ${response.saved_module} to GitHub.`
          : `Updated ${response.saved_module} in the configured repository.`,
      );
    } catch (error: any) {
      console.error('Failed to push Lean playground file:', error);
      setWorkspaceNoticeTone('error');
      if (error?.response?.status === 401) {
        onLogout();
        onOpenAuth();
        setWorkspaceNotice('Your session expired. Please sign in again.');
      } else {
        setWorkspaceNotice(
          error?.response?.data?.detail ?? 'Failed to push the Lean playground file.',
        );
      }
    } finally {
      setWorkspaceAction('idle');
    }
  };

  const handleCopyShareLink = async () => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'playground');
      url.searchParams.set('leanCode', encodeSharedCode(currentCode));
      url.searchParams.set('leanTitle', currentTitle);
      await navigator.clipboard.writeText(url.toString());
      setShareState('copied');
    } catch (error) {
      console.error('Failed to copy share link:', error);
      setShareState('failed');
    }
  };

  const handleSelectCodeUpload = () => {
    codeUploadInputRef.current?.click();
  };

  const handleCodeUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const code = await file.text();
      const title = file.name.replace(/\.[^/.]+$/, '') || 'Uploaded Lean File';
      setEditorError('');
      applyDocument({
        code,
        title,
        exampleId: 'uploaded',
      });
    } catch (error) {
      console.error('Failed to read uploaded Lean code:', error);
      setEditorError('Failed to read the uploaded Lean code file.');
      setEditorStatus('error');
    } finally {
      event.target.value = '';
    }
  };

  const handleOpenRepository = () => {
    if (!githubRepositoryUrl || typeof window === 'undefined') {
      return;
    }

    window.open(githubRepositoryUrl, '_blank', 'noopener,noreferrer');
  };

  const lineCount = Math.max(currentCode.split('\n').length, 1);
  const webSocketUrl = import.meta.env.VITE_LEAN_WS_URL || getDefaultWebSocketUrl();
  const workspaceModules = workspaceInfo?.importable_modules ?? [];
  const repositoryPushEnabled = Boolean(workspaceInfo?.repository_url);

  return (
    <section className="playground-screen">
      <input
        ref={codeUploadInputRef}
        type="file"
        accept=".lean,.txt,.rocq,.v,text/plain"
        hidden
        onChange={handleCodeUpload}
      />

      {workspaceNotice && (
        <div className={`playground-inline-notice is-${workspaceNoticeTone}`}>
          {workspaceNotice}
        </div>
      )}

      <div className="playground-stage">
        <div className="glass-panel playground-shell">
          <div className="playground-shell-header">
            <div>
              <div className="formal-editor-title">{currentTitle}</div>
              <div className="formal-editor-subtitle">
                {selectedExampleId === 'workspace'
                  ? 'Loaded from your proof workspace'
                  : selectedExampleId === 'shared'
                    ? 'Loaded from a shared URL'
                    : EXAMPLES.find((example) => example.id === selectedExampleId)?.description ??
                      'Lean sandbox'}
              </div>
            </div>
            <div className="formal-editor-icons">
              <span>
                {editorStatus === 'booting' ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                {editorStatus === 'booting' ? 'Booting Lean' : 'Lean4'}
              </span>
              <span>{PLAYGROUND_FILE_PATH}</span>
            </div>
          </div>

          <div className="playground-columns">
            <div className="playground-code-panel">
              <div ref={editorRef} className="playground-editor-host" />
            </div>
            <aside className="playground-infoview-panel">
              <div className="playground-infoview-head">
                <div className="proof-section-heading">
                  <Sparkles size={16} color="var(--secondary-accent)" />
                  <span>Infoview</span>
                </div>
                <p>
                  Goals, messages, tactics, and diagnostics from the Lean server. Place the cursor
                  inside a theorem or `by` block to inspect the current proof state.
                </p>
              </div>

              <div ref={infoviewRef} className="playground-infoview-host" />
            </aside>
            <aside className="playground-sidebar-panel">
              <div className="playground-sidebar-section">
                <label className="playground-toolbar-group">
                  <span>Example</span>
                  <select
                    className="input-field playground-select"
                    value={selectedExampleId}
                    onChange={(event) => handleLoadExample(event.target.value)}
                  >
                    {seed?.code && <option value="workspace">Workspace Draft</option>}
                    {sharedDocument && <option value="shared">Shared URL</option>}
                    {selectedExampleId === 'uploaded' && <option value="uploaded">Uploaded File</option>}
                    {EXAMPLES.map((example) => (
                      <option key={example.id} value={example.id}>
                        {example.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="playground-toolbar-group playground-title-field">
                  <span>Document</span>
                  <input
                    className="input-field"
                    value={currentTitle}
                    onChange={(event) => setCurrentTitle(event.target.value)}
                    placeholder="Lean document title"
                  />
                </label>
              </div>

              <div className="playground-toolbar-actions playground-sidebar-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleSyncWorkspace}
                  disabled={workspaceAction !== 'idle'}
                >
                  <CloudUpload size={16} />
                  {workspaceAction === 'syncing' ? 'Syncing...' : 'Sync Workspace'}
                </button>
                <button
                  type="button"
                  className="button-primary"
                  onClick={handlePushGithub}
                  disabled={workspaceAction !== 'idle' || !repositoryPushEnabled}
                >
                  <Github size={16} />
                  {workspaceAction === 'pushing' ? 'Pushing...' : 'Push to GitHub'}
                </button>
                <button type="button" className="button-secondary" onClick={handleSelectCodeUpload}>
                  <FileUp size={16} />
                  Upload Code
                </button>
                <button type="button" className="button-secondary" onClick={handleRestartLean}>
                  <ExternalLink size={16} />
                  Restart Lean
                </button>
                <button type="button" className="button-secondary" onClick={handleReset}>
                  <RotateCcw size={16} />
                  Reset
                </button>
                <button type="button" className="button-secondary" onClick={handleCopyShareLink}>
                  {shareState === 'copied' ? <Check size={16} /> : <Copy size={16} />}
                  {shareState === 'copied' ? 'Link Copied' : 'Share URL'}
                </button>
                {githubRepositoryUrl && (
                  <button type="button" className="button-secondary" onClick={handleOpenRepository}>
                    <ExternalLink size={16} />
                    Repository
                  </button>
                )}
              </div>

              <div className="playground-note-list">
                <div className="playground-sidebar-meta">
                  <span className="proof-badge">{editorStatus}</span>
                  <span className="proof-badge">{lineCount} lines</span>
                  <span className="proof-badge">{workspaceInfo?.playground_module ?? 'ShannonManifold.Playground'}</span>
                  <span className="proof-badge">{webSocketUrl}</span>
                </div>
                <div className="proof-infoview-card">
                  <div className="proof-infoview-label">Workspace File</div>
                  <div className="proof-infoview-detail">
                    {workspaceInfo?.playground_file ?? PLAYGROUND_FILE_PATH}
                  </div>
                </div>
                <div className="proof-infoview-card">
                  <div className="proof-infoview-label">Imports</div>
                  <div className="proof-infoview-detail">
                    Save or push from the playground, then import any module below from the shared
                    Lean project.
                  </div>
                  <div className="playground-import-list">
                    {workspaceModules.slice(0, 8).map((item) => (
                      <code key={item.path}>{`import ${item.module}`}</code>
                    ))}
                  </div>
                </div>
                <div className="proof-infoview-card">
                  <div className="proof-infoview-label">Share</div>
                  <div className="proof-infoview-detail">
                    Copy a URL snapshot of the current code, similar to the official Lean live editor.
                  </div>
                </div>
                <div className="proof-infoview-card">
                  <div className="proof-infoview-label">Container</div>
                  <div className="proof-infoview-detail">
                    The Lean server runs in the dedicated Docker service on port 8080.
                  </div>
                </div>
                {workspaceInfo?.repository_url && (
                  <div className="proof-infoview-card">
                    <div className="proof-infoview-label">Repository</div>
                    <div className="proof-infoview-detail">
                      Branch `{workspaceInfo.repository_branch}` is configured through `.env`. Push
                      from the playground to keep the repository and local Lean workspace aligned.
                    </div>
                    {!workspaceInfo.can_push && (
                      <div className="proof-infoview-detail" style={{ marginTop: '8px', color: '#ffcf8b' }}>
                        Set `GITHUB_ACCESS_TOKEN` in `.env` to enable remote GitHub writes.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>

          <div className="formal-editor-statusbar playground-statusbar">
            <span>{editorStatus === 'ready' ? 'Lean server ready' : 'Preparing Lean runtime'}</span>
            <span>{lineCount} lines</span>
            <span>{webSocketUrl}</span>
          </div>
        </div>
      </div>

      {editorError && <div className="auth-error">{editorError}</div>}
    </section>
  );
}
