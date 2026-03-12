import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Github,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { LeanMonaco, LeanMonacoEditor, type LeanMonacoOptions } from 'lean4monaco';
import {
  getLeanWorkspaceInfo,
  pushLeanPlaygroundToGithub,
  uploadProofPdf,
  type ChatCodeContextPayload,
  type AuthUser,
  type LeanWorkspaceInfo,
} from '../../api';
import 'lean4monaco/dist/css/custom.css';
import 'lean4monaco/dist/css/vscode_webview.css';

const PLAYGROUND_FILE_PATH = 'ShannonManifold/Playground.lean';
const PLAYGROUND_STORAGE_KEY = 'shannon-manifold-lean-playground';

const DEFAULT_DOCUMENT: PlaygroundDocument = {
  code: '-- Start writing Lean here.\n',
  title: 'Playground',
};

const hasMeaningfulLeanCode = (code: string) =>
  code.trim().length > 0 && code.trim() !== DEFAULT_DOCUMENT.code.trim();

export interface LeanPlaygroundSeed {
  code: string;
  revision: number;
  title: string;
  proofWorkspaceId?: number | null;
  pdfFilename?: string | null;
}

interface LeanPlaygroundProps {
  seed: LeanPlaygroundSeed | null;
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  onDocumentChange?: (snapshot: ChatCodeContextPayload) => void;
  onAttachmentChange?: (file: File | null) => void;
  onPushSuccess?: () => void;
}

interface PlaygroundDocument {
  code: string;
  title: string;
  proofWorkspaceId?: number | null;
  pdfFilename?: string | null;
}

interface CursorSnapshot {
  line: number;
  column: number;
}

const toEditorModelPath = (workspacePath: string) => `/${workspacePath.replace(/^\/+/, '')}`;

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

const LEAN_IMPORT_RE = /^\s*import\s+(.+?)\s*$/gm;

const parseLeanImports = (code: string) => {
  const modules: string[] = [];
  for (const match of code.matchAll(LEAN_IMPORT_RE)) {
    const items = match[1]
      .split(/\s+/)
      .map((item) => item.trim().replace(/,$/, ''))
      .filter(Boolean);
    modules.push(...items);
  }
  return [...new Set(modules)];
};

const getLineText = (code: string, line: number) => {
  const lines = code.split('\n');
  return lines[line - 1]?.trim() ?? '';
};

const getNearbyCode = (code: string, line: number, radius = 3) => {
  const lines = code.split('\n');
  const start = Math.max(0, line - radius - 1);
  const end = Math.min(lines.length, line + radius);
  return lines.slice(start, end).join('\n').trim();
};

const normalizeInfoviewText = (value: string) =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

const extractActiveGoal = (proofState: string) => {
  if (!proofState.trim()) {
    return null;
  }

  const lines = proofState
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  if (lines[0].toLowerCase() === 'no goals') {
    return 'No goals';
  }

  return lines.slice(0, 8).join('\n');
};

const resolveInitialDocument = (seed: LeanPlaygroundSeed | null): PlaygroundDocument => {
  if (seed?.code) {
    return {
      code: seed.code,
      title: seed.title,
      proofWorkspaceId: seed.proofWorkspaceId ?? null,
      pdfFilename: seed.pdfFilename ?? null,
    };
  }

  return (
    readDocumentFromUrl() ??
    readDocumentFromStorage() ?? {
      code: DEFAULT_DOCUMENT.code,
      title: DEFAULT_DOCUMENT.title,
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
  onDocumentChange,
  onAttachmentChange,
  onPushSuccess,
}: LeanPlaygroundProps) {
  const sharedDocument = readDocumentFromUrl();
  const initialDocument = resolveInitialDocument(seed);
  const githubRepositoryUrl = import.meta.env.VITE_GITHUB_REPOSITORY_URL?.trim();
  const [currentCode, setCurrentCode] = useState(initialDocument.code);
  const [currentTitle, setCurrentTitle] = useState(initialDocument.title);
  const [documentSource, setDocumentSource] = useState<string>(
    seed?.code ? 'workspace' : sharedDocument ? 'shared' : 'local',
  );
  const [editorStatus, setEditorStatus] = useState<'booting' | 'ready' | 'error'>('booting');
  const [editorError, setEditorError] = useState('');
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [baselineDocument, setBaselineDocument] = useState(initialDocument);
  const [workspaceInfo, setWorkspaceInfo] = useState<LeanWorkspaceInfo | null>(null);
  const [workspaceAction, setWorkspaceAction] = useState<'idle' | 'pushing'>('idle');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [workspaceNoticeTone, setWorkspaceNoticeTone] = useState<'success' | 'error'>('success');
  const [savedWorkspacePath, setSavedWorkspacePath] = useState(PLAYGROUND_FILE_PATH);
  const [savedWorkspaceModule, setSavedWorkspaceModule] = useState('ShannonManifold.Playground');
  const [cursorSnapshot, setCursorSnapshot] = useState<CursorSnapshot>({ line: 1, column: 1 });
  const [infoviewSnapshot, setInfoviewSnapshot] = useState('');
  const [isAuxiliaryUiVisible, setIsAuxiliaryUiVisible] = useState(true);
  const [activeProofWorkspaceId, setActiveProofWorkspaceId] = useState<number | null>(
    initialDocument.proofWorkspaceId ?? null,
  );
  const [attachedPdfFilename, setAttachedPdfFilename] = useState<string | null>(null);
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [pendingPdfPreviewUrl, setPendingPdfPreviewUrl] = useState<string | null>(null);
  const editorModelPath = toEditorModelPath(savedWorkspacePath);

  const editorRef = useRef<HTMLDivElement>(null);
  const infoviewRef = useRef<HTMLDivElement>(null);
  const leanMonacoRef = useRef<LeanMonaco | null>(null);
  const leanEditorRef = useRef<LeanMonacoEditor | null>(null);
  const applyingExternalCodeRef = useRef(false);
  const latestCodeRef = useRef(initialDocument.code);
  const codeUploadInputRef = useRef<HTMLInputElement>(null);
  const pdfUploadInputRef = useRef<HTMLInputElement>(null);
  const parsedImports = useMemo(() => parseLeanImports(currentCode), [currentCode]);
  const cursorLineText = useMemo(
    () => getLineText(currentCode, cursorSnapshot.line),
    [currentCode, cursorSnapshot.line],
  );
  const nearbyCode = useMemo(
    () => getNearbyCode(currentCode, cursorSnapshot.line),
    [currentCode, cursorSnapshot.line],
  );
  const activeGoal = useMemo(
    () => extractActiveGoal(infoviewSnapshot),
    [infoviewSnapshot],
  );

  const replacePendingPdf = (file: File | null) => {
    if (pendingPdfPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(pendingPdfPreviewUrl);
    }

    setPendingPdfFile(file);
    setPendingPdfPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const publishWorkspaceNotice = (message: string, tone: 'success' | 'error') => {
    setWorkspaceNoticeTone(tone);
    setWorkspaceNotice(message);
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      PLAYGROUND_STORAGE_KEY,
      JSON.stringify({
        code: currentCode,
        title: currentTitle,
        proofWorkspaceId: activeProofWorkspaceId,
        pdfFilename: null,
      }),
    );

    latestCodeRef.current = currentCode;
  }, [activeProofWorkspaceId, attachedPdfFilename, currentCode, currentTitle]);

  useEffect(() => {
    return () => {
      if (pendingPdfPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(pendingPdfPreviewUrl);
      }
    };
  }, [pendingPdfPreviewUrl]);

  useEffect(() => {
    onAttachmentChange?.(pendingPdfFile);
    return () => {
      onAttachmentChange?.(null);
    };
  }, [onAttachmentChange, pendingPdfFile]);

  useEffect(() => {
    onDocumentChange?.({
      title: currentTitle,
      content: currentCode,
      language: 'Lean4',
      module_name: savedWorkspaceModule,
      path: savedWorkspacePath,
      imports: parsedImports,
      cursor_line: cursorSnapshot.line,
      cursor_column: cursorSnapshot.column,
      cursor_line_text: cursorLineText || null,
      nearby_code: nearbyCode || null,
      proof_state: infoviewSnapshot || null,
      active_goal: activeGoal || null,
      proof_workspace_id: activeProofWorkspaceId,
      attached_pdf_filename: pendingPdfFile?.name ?? null,
    });
  }, [
    activeGoal,
    activeProofWorkspaceId,
    currentCode,
    currentTitle,
    cursorLineText,
    cursorSnapshot.column,
    cursorSnapshot.line,
    infoviewSnapshot,
    nearbyCode,
    onDocumentChange,
    pendingPdfFile,
    parsedImports,
    savedWorkspaceModule,
    savedWorkspacePath,
  ]);

  useEffect(() => {
    let isCancelled = false;
    let modelDispose: { dispose: () => void } | undefined;
    let cursorDispose: { dispose: () => void } | undefined;

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
          'editor.quickSuggestions': {
            other: 'on',
            comments: 'off',
            strings: 'off',
          },
          'editor.suggestOnTriggerCharacters': true,
          'editor.acceptSuggestionOnEnter': 'on',
          'editor.tabCompletion': 'on',
          'editor.inlineSuggest.enabled': true,
          'editor.parameterHints.enabled': true,
          'editor.snippetSuggestions': 'top',
          'editor.suggestSelection': 'first',
          'editor.wordBasedSuggestions': 'matchingDocuments',
          'workbench.colorTheme': 'Default Dark+',
        },
      };

      try {
        await leanMonaco.start(options);
        if (isCancelled) {
          return;
        }

        await leanEditor.start(editorRef.current, editorModelPath, latestCodeRef.current);
        if (isCancelled) {
          return;
        }

        leanEditor.editor.updateOptions({
          wordWrap: 'on',
          minimap: { enabled: false },
          stickyScroll: { enabled: false },
          fontLigatures: true,
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
          tabCompletion: 'on',
          inlineSuggest: { enabled: true },
          parameterHints: { enabled: true },
          snippetSuggestions: 'top',
          suggestSelection: 'first',
          wordBasedSuggestions: 'matchingDocuments',
        });

        const model = leanEditor.editor.getModel();
        modelDispose = model?.onDidChangeContent(() => {
          if (applyingExternalCodeRef.current) {
            return;
          }

          setCurrentCode(model.getValue());
        });
        cursorDispose = leanEditor.editor.onDidChangeCursorPosition((event) => {
          setCursorSnapshot({
            line: event.position.lineNumber,
            column: event.position.column,
          });
        });
        const initialPosition = leanEditor.editor.getPosition();
        if (initialPosition) {
          setCursorSnapshot({
            line: initialPosition.lineNumber,
            column: initialPosition.column,
          });
        }

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
      cursorDispose?.dispose();
      leanEditorRef.current?.dispose();
      leanMonacoRef.current?.dispose();
      leanEditorRef.current = null;
      leanMonacoRef.current = null;
    };
  }, [editorModelPath]);

  useEffect(() => {
    if (!infoviewRef.current) {
      return;
    }

    let detachLoadListener: (() => void) | null = null;
    let detachFrameObserver: (() => void) | null = null;

    const bindInfoviewTheme = () => {
      const iframe = infoviewRef.current?.querySelector('iframe');
      if (!iframe) {
        return;
      }

      const connectFrameDocument = () => {
        const documentRef = iframe.contentDocument;
        const body = documentRef?.body;
        applyInfoviewFrameTheme(iframe);
        if (!body) {
          return;
        }

        const updateProofState = () => {
          setInfoviewSnapshot(
            normalizeInfoviewText(body.innerText || body.textContent || ''),
          );
        };

        updateProofState();
        const frameObserver = new MutationObserver(updateProofState);
        frameObserver.observe(body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        detachFrameObserver = () => frameObserver.disconnect();
      };

      const handleLoad = () => {
        detachFrameObserver?.();
        detachFrameObserver = null;
        connectFrameDocument();
      };

      iframe.addEventListener('load', handleLoad);
      connectFrameDocument();
      detachLoadListener = () => iframe.removeEventListener('load', handleLoad);
    };

    bindInfoviewTheme();

    const observer = new MutationObserver(() => {
      detachLoadListener?.();
      detachLoadListener = null;
      detachFrameObserver?.();
      detachFrameObserver = null;
      bindInfoviewTheme();
    });

    observer.observe(infoviewRef.current, {
      childList: true,
      subtree: true,
    });

    return () => {
      detachLoadListener?.();
      detachFrameObserver?.();
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
          setSavedWorkspacePath(info.playground_file);
          setSavedWorkspaceModule(info.playground_module);
        }
      } catch (error) {
        console.error('Failed to load Lean workspace info:', error);
        if (isMounted) {
          publishWorkspaceNotice('Failed to load Lean workspace metadata.', 'error');
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

    replacePendingPdf(null);
    applyDocument({
      code: seed.code,
      title: seed.title,
      source: 'workspace',
      proofWorkspaceId: seed.proofWorkspaceId ?? null,
      pdfFilename: seed.pdfFilename ?? null,
    });
  }, [seed?.code, seed?.pdfFilename, seed?.proofWorkspaceId, seed?.revision, seed?.title]);

  const applyDocument = ({
    code,
    title,
    source,
    proofWorkspaceId = null,
    pdfFilename: _pdfFilename = null,
  }: {
    code: string;
    title: string;
    source: string;
    proofWorkspaceId?: number | null;
    pdfFilename?: string | null;
  }) => {
    latestCodeRef.current = code;
    setCurrentCode(code);
    setCurrentTitle(title);
    setDocumentSource(source);
    setActiveProofWorkspaceId(proofWorkspaceId);
    setAttachedPdfFilename(null);
    setBaselineDocument({ code, title, proofWorkspaceId, pdfFilename: null });
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

  const handleReset = () => {
    applyDocument({
      code: baselineDocument.code,
      title: baselineDocument.title,
      source: documentSource,
    });
  };

  const handleRestartLean = () => {
    leanMonacoRef.current?.restart();
  };

  const handlePushGithub = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setWorkspaceAction('pushing');
    setWorkspaceNotice('');
    let persistedWorkspace:
      | {
        id: number;
        title: string;
        lean4_code: string;
        pdf_filename?: string | null;
        source_filename?: string | null;
      }
      | null = null;

    try {
      let nextTitle = currentTitle;
      let nextCode = currentCode;
      let nextProofWorkspaceId = activeProofWorkspaceId;

      if (pendingPdfFile) {
        const fallbackTitle = pendingPdfFile.name.replace(/\.pdf$/i, '') || 'Uploaded proof';
        const normalizedTitle =
          currentTitle.trim() && currentTitle.trim() !== DEFAULT_DOCUMENT.title
            ? currentTitle.trim()
            : fallbackTitle;
        const workspace = await uploadProofPdf(normalizedTitle, pendingPdfFile, {
          workspace_id: activeProofWorkspaceId,
          lean4_code: hasMeaningfulLeanCode(currentCode) ? currentCode : null,
        });
        persistedWorkspace = workspace;
        nextTitle = workspace.title;
        nextCode = workspace.lean4_code;
        nextProofWorkspaceId = workspace.id;
        replacePendingPdf(null);
        applyDocument({
          code: workspace.lean4_code,
          title: workspace.title,
          source: 'workspace',
          proofWorkspaceId: workspace.id,
          pdfFilename: null,
        });
      }

      const response = await pushLeanPlaygroundToGithub({
        code: nextCode,
        title: nextTitle,
        proof_workspace_id: nextProofWorkspaceId,
      });
      setWorkspaceInfo(response);
      setSavedWorkspacePath(response.saved_path);
      setSavedWorkspaceModule(response.saved_module);
      if (!persistedWorkspace) {
        setActiveProofWorkspaceId(response.proof_workspace_id ?? null);
        setAttachedPdfFilename(null);
      }
      leanMonacoRef.current?.restart();
      if (persistedWorkspace) {
        publishWorkspaceNotice(
          response.pushed
            ? `Saved the PDF-backed Lean document, updated the verified database entry, and pushed ${response.saved_module} to GitHub.`
            : `Saved the PDF-backed Lean document and updated the verified database entry locally.`,
          'success',
        );
      } else {
        publishWorkspaceNotice(
          response.pushed
            ? response.remote_content_url
              ? `Built ${response.saved_module} for import and pushed it to GitHub.`
              : `Built ${response.saved_module} for import and updated the configured repository.`
            : response.repository_url
              ? `Built ${response.saved_module} for import locally. Set GITHUB_ACCESS_TOKEN to push it to GitHub.`
              : `Built ${response.saved_module} for import in the Lean workspace.`,
          'success',
        );
      }
      onPushSuccess?.();
    } catch (error: any) {
      console.error('Failed to push Lean playground file:', error);
      if (error?.response?.status === 401) {
        onLogout();
        onOpenAuth();
        publishWorkspaceNotice('Your session expired. Please sign in again.', 'error');
      } else {
        publishWorkspaceNotice(
          persistedWorkspace
            ? `Saved the PDF-backed document, but the final workspace sync failed: ${error?.response?.data?.detail ?? 'Failed to push the Lean playground file.'}`
            : error?.response?.data?.detail ?? 'Failed to push the Lean playground file.',
          'error',
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

  const handleSelectPdfUpload = () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    pdfUploadInputRef.current?.click();
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
        source: 'uploaded',
        proofWorkspaceId: null,
        pdfFilename: null,
      });
    } catch (error) {
      console.error('Failed to read uploaded Lean code:', error);
      setEditorError('Failed to read the uploaded Lean code file.');
      setEditorStatus('error');
    } finally {
      event.target.value = '';
    }
  };

  const handlePdfUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    replacePendingPdf(file);
    setAttachedPdfFilename(file.name);
    setWorkspaceNotice('');
    event.target.value = '';
  };

  const handleCancelPendingPdfUpload = () => {
    replacePendingPdf(null);
    setAttachedPdfFilename(null);
    setWorkspaceNotice('');
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
  const attachedPdfPreviewUrl = pendingPdfPreviewUrl;
  const attachedPdfDownloadUrl = pendingPdfPreviewUrl;
  const visiblePdfName = pendingPdfFile?.name ?? null;

  return (
    <section className="playground-screen">
      <input
        ref={codeUploadInputRef}
        type="file"
        accept=".lean,.txt,.rocq,.v,text/plain"
        hidden
        onChange={handleCodeUpload}
      />
      <input
        ref={pdfUploadInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={handlePdfUpload}
      />

      {workspaceNotice && (
        <div className={`playground-inline-notice is-${workspaceNoticeTone}`}>
          {workspaceNotice}
        </div>
      )}

      <div className="playground-stage">
        <div className={`glass-panel playground-shell ${!isAuxiliaryUiVisible ? 'is-compact' : ''}`}>
          {isAuxiliaryUiVisible && (
            <div className="playground-shell-header">
              <div>
                <div className="formal-editor-title">{currentTitle}</div>
                <div className="formal-editor-subtitle">
                  {documentSource === 'workspace'
                    ? 'Loaded from your proof workspace'
                    : documentSource === 'shared'
                      ? 'Loaded from a shared URL'
                      : documentSource === 'uploaded'
                        ? 'Loaded from an uploaded Lean file'
                        : 'Lean workspace document'}
                </div>
              </div>
              <div className="formal-editor-icons">
                <span>
                  {editorStatus === 'booting' ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                  {editorStatus === 'booting' ? 'Booting Lean' : 'Lean4'}
                </span>
                <span>{savedWorkspacePath}</span>
              </div>
            </div>
          )}

          {isAuxiliaryUiVisible && pendingPdfFile && visiblePdfName && attachedPdfPreviewUrl && attachedPdfDownloadUrl && (
            <div className="playground-pdf-banner is-pending">
              <div className="playground-pdf-banner-info">
                <div className="playground-pdf-banner-label">
                  <FileText size={16} />
                  <span>{visiblePdfName}</span>
                </div>
                <span className="proof-badge">Local Only</span>
              </div>
              <div className="playground-pdf-banner-actions">
                <a
                  className="button-secondary"
                  href={attachedPdfPreviewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={16} />
                  Open PDF
                </a>
                <a
                  className="button-secondary"
                  href={attachedPdfDownloadUrl}
                  download={visiblePdfName}
                >
                  <Download size={16} />
                  Download
                </a>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleCancelPendingPdfUpload}
                >
                  <X size={16} />
                  Cancel Upload
                </button>
              </div>
            </div>
          )}

          <div className={`playground-columns ${!isAuxiliaryUiVisible ? 'is-compact' : ''}`}>
            <div className="playground-code-panel">
              <div ref={editorRef} className="playground-editor-host" />
            </div>
            <aside className="playground-infoview-panel">
              <div className="playground-infoview-head">
                <div className="playground-infoview-head-top">
                  <div className="proof-section-heading">
                    <Sparkles size={16} color="var(--secondary-accent)" />
                    <span>Infoview</span>
                  </div>
                  <button
                    type="button"
                    className="playground-aux-toggle"
                    onClick={() => setIsAuxiliaryUiVisible((current) => !current)}
                  >
                    {isAuxiliaryUiVisible ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    {isAuxiliaryUiVisible ? 'Hide UI' : 'Show UI'}
                  </button>
                </div>
                <div>
                  <p>
                    Goals, messages, tactics, and diagnostics from the Lean server. Place the cursor
                    inside a theorem or `by` block to inspect the current proof state.
                  </p>
                </div>
              </div>

              <div ref={infoviewRef} className="playground-infoview-host" />
            </aside>
            {isAuxiliaryUiVisible && (
              <aside className="playground-sidebar-panel">
                <div className="playground-sidebar-section">
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
                    className="button-primary"
                    onClick={handlePushGithub}
                    disabled={workspaceAction !== 'idle'}
                  >
                    <Github size={16} />
                    {workspaceAction === 'pushing' ? 'Saving...' : 'Save / Push'}
                  </button>
                  <button type="button" className="button-secondary" onClick={handleSelectCodeUpload}>
                    <FileUp size={16} />
                    Upload Code
                  </button>
                  <button type="button" className="button-secondary" onClick={handleSelectPdfUpload}>
                    <FileUp size={16} />
                    Upload PDF
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
                    <span className="proof-badge">{`L${cursorSnapshot.line}:C${cursorSnapshot.column}`}</span>
                    <span className="proof-badge">{savedWorkspaceModule}</span>
                    <span className="proof-badge">{webSocketUrl}</span>
                  </div>
                  <div className="proof-infoview-card">
                    <div className="proof-infoview-label">Workspace File</div>
                    <div className="proof-infoview-detail">
                      {savedWorkspacePath}
                    </div>
                  </div>
                  {pendingPdfFile && attachedPdfPreviewUrl && attachedPdfDownloadUrl && (
                    <div className="proof-infoview-card playground-pdf-card">
                      <div className="proof-infoview-label">PDF Preview</div>
                      <div className="playground-pdf-actions">
                        <a
                          className="button-secondary"
                          href={attachedPdfPreviewUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={16} />
                          Open PDF
                        </a>
                        <a
                          className="button-secondary"
                          href={attachedPdfDownloadUrl}
                          download={visiblePdfName ?? pendingPdfFile.name}
                        >
                          <Download size={16} />
                          Download PDF
                        </a>
                      </div>
                      <iframe
                        className="playground-pdf-frame"
                        src={attachedPdfPreviewUrl}
                        title={`${currentTitle} PDF preview`}
                      />
                      <div className="proof-infoview-detail">
                        This PDF is attached only in the playground right now. Use Save / Push to
                        store it together with the current Lean code in the verified database.
                      </div>
                    </div>
                  )}
                  <div className="proof-infoview-card">
                    <div className="proof-infoview-label">Copilot Focus</div>
                    <div className="proof-infoview-detail">
                      {activeGoal || 'Move the cursor inside a theorem or `by` block to send the active goal to the Oracle.'}
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
            )}
          </div>

          {isAuxiliaryUiVisible && (
            <div className="formal-editor-statusbar playground-statusbar">
              <span>{editorStatus === 'ready' ? 'Lean server ready' : 'Preparing Lean runtime'}</span>
              <span>{lineCount} lines</span>
              <span>{webSocketUrl}</span>
            </div>
          )}
        </div>
      </div>

      {editorError && <div className="auth-error">{editorError}</div>}
    </section>
  );
}
