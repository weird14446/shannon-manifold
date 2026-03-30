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
  LoaderCircle,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { LeanMonaco, LeanMonacoEditor, type LeanMonacoOptions } from 'lean4monaco';
import {
  getVerifiedBuildJob,
  getLeanWorkspaceInfo,
  getTheoremDetail,
  listProjectModules,
  getProofWorkspacePdfUrl,
  listProjects,
  openProject,
  saveProjectFile,
  syncLeanPlaygroundToWorkspace,
  updateProject,
  uploadProofPdf,
  type ChatCodeContextPayload,
  type AuthUser,
  type IndexedProofDetail,
  type LeanWorkspaceInfo,
  type ProjectModule,
  type ProjectSummary,
} from '../../api';
import { VerifiedModulePreviewCard } from './VerifiedModulePreviewCard';
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
  linkedPdfFilename?: string | null;
  linkedPdfPreviewUrl?: string | null;
  linkedPdfDownloadUrl?: string | null;
  projectSlug?: string | null;
  projectOwnerSlug?: string | null;
  projectTitle?: string | null;
  projectRoot?: string | null;
  packageName?: string | null;
  projectGithubUrl?: string | null;
  projectVisibility?: 'public' | 'private' | null;
  projectCanEdit?: boolean | null;
  projectFilePath?: string | null;
  projectModuleName?: string | null;
  projectEntryFilePath?: string | null;
  projectEntryModuleName?: string | null;
}

interface LeanPlaygroundProps {
  seed: LeanPlaygroundSeed | null;
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  onSessionMetadataChange?: (metadata: PlaygroundSessionMetadata | null) => void;
  onDocumentChange?: (snapshot: ChatCodeContextPayload) => void;
  onAttachmentChange?: (file: File | null) => void;
}

interface PlaygroundDocument {
  code: string;
  title: string;
  proofWorkspaceId?: number | null;
  pdfFilename?: string | null;
  linkedPdfFilename?: string | null;
  linkedPdfPreviewUrl?: string | null;
  linkedPdfDownloadUrl?: string | null;
  projectSlug?: string | null;
  projectOwnerSlug?: string | null;
  projectTitle?: string | null;
  projectRoot?: string | null;
  packageName?: string | null;
  projectGithubUrl?: string | null;
  projectVisibility?: 'public' | 'private' | null;
  projectCanEdit?: boolean | null;
  projectFilePath?: string | null;
  projectModuleName?: string | null;
  projectEntryFilePath?: string | null;
  projectEntryModuleName?: string | null;
}

interface CursorSnapshot {
  line: number;
  column: number;
}

interface PendingVerifiedSaveSnapshot {
  code: string;
  title: string;
  proofWorkspaceId: number | null;
  pdfFilename: string | null;
  projectFilePath: string | null;
  projectModuleName: string | null;
}

interface PlaygroundSessionMetadata {
  title: string;
  proofWorkspaceId?: number | null;
  pdfFilename?: string | null;
  linkedPdfFilename?: string | null;
  linkedPdfPreviewUrl?: string | null;
  linkedPdfDownloadUrl?: string | null;
  projectSlug?: string | null;
  projectOwnerSlug?: string | null;
  projectTitle?: string | null;
  projectRoot?: string | null;
  packageName?: string | null;
  projectGithubUrl?: string | null;
  projectVisibility?: 'public' | 'private' | null;
  projectCanEdit?: boolean | null;
  projectFilePath?: string | null;
  projectModuleName?: string | null;
  projectEntryFilePath?: string | null;
  projectEntryModuleName?: string | null;
}

const toEditorModelPath = (workspacePath: string) => `/${workspacePath.replace(/^\/+/, '')}`;

const getDefaultWebSocketUrl = () => {
  if (typeof window === 'undefined') {
    return 'ws://localhost:8080/';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8080/`;
};

const buildWebSocketUrl = (projectRoot?: string | null) => {
  const baseUrl = import.meta.env.VITE_LEAN_WS_URL || getDefaultWebSocketUrl();
  if (!projectRoot) {
    return baseUrl;
  }

  if (typeof window === 'undefined') {
    return `${baseUrl}?projectRoot=${encodeURIComponent(projectRoot)}`;
  }

  const url = new URL(baseUrl, window.location.href);
  url.searchParams.set('projectRoot', projectRoot);
  return url.toString();
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
const LEAN_FILENAME_TOKEN_RE = /[A-Za-z0-9]+/g;

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

const normalizeLeanFileStem = (value: string, fallbackStem: string) => {
  const parts = value.trim().match(LEAN_FILENAME_TOKEN_RE) ?? [];
  if (parts.length > 0) {
    const stem = parts.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join('');
    return /^\d/.test(stem) ? `Doc${stem}` : stem;
  }

  return fallbackStem;
};

const resolveSharedWorkspaceTarget = (title: string) => {
  const configuredPath = PLAYGROUND_FILE_PATH.replace(/^\/+/, '');
  const segments = configuredPath.split('/').filter(Boolean);
  const filename = segments.pop() ?? 'Playground.lean';
  const parent = segments.join('/');
  const fallbackStem = filename.replace(/\.lean$/i, '') || 'Playground';
  const stem = normalizeLeanFileStem(title, fallbackStem);
  const path = parent ? `${parent}/${stem}.lean` : `${stem}.lean`;
  return {
    path,
    module: path.replace(/\.lean$/i, '').split('/').join('.'),
  };
};

const resolveProjectWorkspaceTarget = (
  packageName: string,
  title: string,
  entryFilePath?: string | null,
) => {
  const fallbackStem = entryFilePath?.split('/').pop()?.replace(/\.lean$/i, '') || 'Main';
  const stem = normalizeLeanFileStem(title, fallbackStem);
  return {
    title: stem,
    path: `${packageName}/${stem}.lean`,
    module: `${packageName}.${stem}`,
  };
};

const resolveDisplayedWorkspaceTarget = ({
  title,
  projectSlug,
  packageName,
  entryFilePath,
  fallbackPath,
  fallbackModule,
}: {
  title: string;
  projectSlug: string | null;
  packageName: string | null;
  entryFilePath?: string | null;
  fallbackPath: string;
  fallbackModule: string;
}) => {
  if (projectSlug && packageName) {
    return resolveProjectWorkspaceTarget(packageName, title, entryFilePath);
  }

  if (projectSlug) {
    return {
      title,
      path: fallbackPath,
      module: fallbackModule,
    };
  }

  const sharedTarget = resolveSharedWorkspaceTarget(title);
  return {
    title: title.trim() || sharedTarget.path.replace(/.*\//, '').replace(/\.lean$/i, ''),
    path: sharedTarget.path,
    module: sharedTarget.module,
  };
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
  if (seed?.projectSlug) {
    return {
      code: seed.code,
      title: seed.title,
      proofWorkspaceId: seed.proofWorkspaceId ?? null,
      pdfFilename: seed.pdfFilename ?? null,
      linkedPdfFilename: seed.linkedPdfFilename ?? null,
      linkedPdfPreviewUrl: seed.linkedPdfPreviewUrl ?? null,
      linkedPdfDownloadUrl: seed.linkedPdfDownloadUrl ?? null,
      projectSlug: seed.projectSlug ?? null,
      projectOwnerSlug: seed.projectOwnerSlug ?? null,
      projectTitle: seed.projectTitle ?? null,
      projectRoot: seed.projectRoot ?? null,
      packageName: seed.packageName ?? null,
      projectGithubUrl: seed.projectGithubUrl ?? null,
      projectVisibility: seed.projectVisibility ?? null,
      projectCanEdit: seed.projectCanEdit ?? null,
      projectFilePath: seed.projectFilePath ?? null,
      projectModuleName: seed.projectModuleName ?? null,
      projectEntryFilePath: seed.projectEntryFilePath ?? null,
      projectEntryModuleName: seed.projectEntryModuleName ?? null,
    };
  }

  if (seed?.code) {
    return {
      code: seed.code,
      title: seed.title,
      proofWorkspaceId: seed.proofWorkspaceId ?? null,
      pdfFilename: seed.pdfFilename ?? null,
      linkedPdfFilename: seed.linkedPdfFilename ?? null,
      linkedPdfPreviewUrl: seed.linkedPdfPreviewUrl ?? null,
      linkedPdfDownloadUrl: seed.linkedPdfDownloadUrl ?? null,
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
  onSessionMetadataChange,
  onDocumentChange,
  onAttachmentChange,
}: LeanPlaygroundProps) {
  const sharedDocument = readDocumentFromUrl();
  const initialDocument = resolveInitialDocument(seed);
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
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [workspaceNoticeTone, setWorkspaceNoticeTone] = useState<'success' | 'error'>('success');
  const [savedWorkspacePath, setSavedWorkspacePath] = useState(
    initialDocument.projectFilePath ?? PLAYGROUND_FILE_PATH,
  );
  const [savedWorkspaceModule, setSavedWorkspaceModule] = useState(
    initialDocument.projectModuleName ?? 'ShannonManifold.Playground',
  );
  const [cursorSnapshot, setCursorSnapshot] = useState<CursorSnapshot>({ line: 1, column: 1 });
  const [infoviewSnapshot, setInfoviewSnapshot] = useState('');
  const [isAuxiliaryUiVisible, setIsAuxiliaryUiVisible] = useState(true);
  const [activeProofWorkspaceId, setActiveProofWorkspaceId] = useState<number | null>(
    initialDocument.proofWorkspaceId ?? null,
  );
  const [activeProjectSlug, setActiveProjectSlug] = useState<string | null>(
    initialDocument.projectSlug ?? null,
  );
  const [activeProjectOwnerSlug, setActiveProjectOwnerSlug] = useState<string | null>(
    initialDocument.projectOwnerSlug ?? null,
  );
  const [activeProjectTitle, setActiveProjectTitle] = useState<string | null>(
    initialDocument.projectTitle ?? null,
  );
  const [activeProjectRoot, setActiveProjectRoot] = useState<string | null>(
    initialDocument.projectRoot ?? null,
  );
  const [activeProjectPackageName, setActiveProjectPackageName] = useState<string | null>(
    initialDocument.packageName ?? null,
  );
  const [activeProjectGithubUrl, setActiveProjectGithubUrl] = useState<string | null>(
    initialDocument.projectGithubUrl ?? null,
  );
  const [activeProjectVisibility, setActiveProjectVisibility] = useState<'public' | 'private'>(
    initialDocument.projectVisibility ?? 'private',
  );
  const [activeProjectCanEdit, setActiveProjectCanEdit] = useState(
    initialDocument.projectCanEdit ?? true,
  );
  const [projectGithubUrlDraft, setProjectGithubUrlDraft] = useState(
    initialDocument.projectGithubUrl ?? '',
  );
  const [activeProjectEntryFilePath, setActiveProjectEntryFilePath] = useState<string | null>(
    initialDocument.projectEntryFilePath ?? null,
  );
  const [activeProjectEntryModuleName, setActiveProjectEntryModuleName] = useState<string | null>(
    initialDocument.projectEntryModuleName ?? null,
  );
  const [availableProjects, setAvailableProjects] = useState<ProjectSummary[]>([]);
  const [projectModules, setProjectModules] = useState<ProjectModule[]>([]);
  const [projectModuleQuery, setProjectModuleQuery] = useState('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingProjectModules, setIsLoadingProjectModules] = useState(false);
  const [openingProjectModulePath, setOpeningProjectModulePath] = useState<string | null>(null);
  const [previewModuleDetail, setPreviewModuleDetail] = useState<IndexedProofDetail | null>(null);
  const [previewModuleError, setPreviewModuleError] = useState('');
  const [previewModulePath, setPreviewModulePath] = useState<string | null>(null);
  const [isSavingProjectLink, setIsSavingProjectLink] = useState(false);
  const [attachedPdfFilename, setAttachedPdfFilename] = useState<string | null>(
    initialDocument.pdfFilename ?? null,
  );
  const [linkedPdfFilename, setLinkedPdfFilename] = useState<string | null>(
    initialDocument.linkedPdfFilename ?? null,
  );
  const [linkedPdfPreviewUrl, setLinkedPdfPreviewUrl] = useState<string | null>(
    initialDocument.linkedPdfPreviewUrl ?? null,
  );
  const [linkedPdfDownloadUrl, setLinkedPdfDownloadUrl] = useState<string | null>(
    initialDocument.linkedPdfDownloadUrl ?? null,
  );
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [pendingPdfPreviewUrl, setPendingPdfPreviewUrl] = useState<string | null>(null);
  const [isUploadingToDatabase, setIsUploadingToDatabase] = useState(false);
  const [activeBuildJobId, setActiveBuildJobId] = useState<string | null>(null);
  const [activeBuildJobStatus, setActiveBuildJobStatus] = useState<string | null>(null);
  const [pendingVerifiedSave, setPendingVerifiedSave] = useState<PendingVerifiedSaveSnapshot | null>(null);
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
  const projectSelectionValue = activeProjectSlug
    ? `${activeProjectOwnerSlug ?? ''}:${activeProjectSlug}`
    : '';
  const displayedWorkspaceTarget = useMemo(
    () =>
      resolveDisplayedWorkspaceTarget({
        title: currentTitle,
        projectSlug: activeProjectSlug,
        packageName: activeProjectPackageName,
        entryFilePath: activeProjectEntryFilePath,
        fallbackPath: savedWorkspacePath,
        fallbackModule: savedWorkspaceModule,
      }),
    [
      activeProjectEntryFilePath,
      activeProjectPackageName,
      activeProjectSlug,
      currentTitle,
      savedWorkspaceModule,
      savedWorkspacePath,
    ],
  );
  const normalizedProjectModuleQuery = projectModuleQuery.trim().toLowerCase();
  const filteredProjectModules = useMemo(() => {
    if (!normalizedProjectModuleQuery) {
      return projectModules;
    }

    return projectModules.filter((module) => {
      const haystacks = [module.title, module.path, module.module_name];
      return haystacks.some((value) => value.toLowerCase().includes(normalizedProjectModuleQuery));
    });
  }, [normalizedProjectModuleQuery, projectModules]);
  const selectableProjects = useMemo(() => {
    const ownedProjects = availableProjects.filter((project) => project.can_edit);
    if (
      activeProjectSlug &&
      activeProjectOwnerSlug &&
      !ownedProjects.some(
        (project) =>
          project.slug === activeProjectSlug && project.owner_slug === activeProjectOwnerSlug,
      )
    ) {
      return [
        {
          title: activeProjectTitle ?? activeProjectSlug,
          slug: activeProjectSlug,
          owner_slug: activeProjectOwnerSlug,
          project_root: activeProjectRoot ?? '',
          package_name: activeProjectPackageName ?? '',
          entry_file_path:
            activeProjectEntryFilePath ??
            `${activeProjectPackageName ?? 'Project'}/${currentTitle || 'Main'}.lean`,
          entry_module_name:
            activeProjectEntryModuleName ??
            `${activeProjectPackageName ?? 'Project'}.${currentTitle || 'Main'}`,
          github_url: activeProjectGithubUrl ?? null,
          visibility: activeProjectVisibility,
          can_edit: activeProjectCanEdit,
          can_delete: activeProjectCanEdit,
        },
        ...ownedProjects,
      ];
    }
    return ownedProjects;
  }, [
    activeProjectCanEdit,
    activeProjectEntryFilePath,
    activeProjectEntryModuleName,
    activeProjectGithubUrl,
    activeProjectOwnerSlug,
    activeProjectPackageName,
    activeProjectRoot,
    activeProjectSlug,
    activeProjectTitle,
    activeProjectVisibility,
    availableProjects,
    currentTitle,
  ]);

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

  const commitProjectFileName = (rawTitle = currentTitle) => {
    if (!activeProjectSlug || !activeProjectPackageName) {
      return {
        title: rawTitle,
        path: savedWorkspacePath,
        module: savedWorkspaceModule,
      };
    }

    const nextTarget = resolveProjectWorkspaceTarget(
      activeProjectPackageName,
      rawTitle,
      activeProjectEntryFilePath,
    );
    if (nextTarget.title !== currentTitle) {
      setCurrentTitle(nextTarget.title);
    }
    if (nextTarget.path !== savedWorkspacePath) {
      setSavedWorkspacePath(nextTarget.path);
    }
    if (nextTarget.module !== savedWorkspaceModule) {
      setSavedWorkspaceModule(nextTarget.module);
    }
    return nextTarget;
  };

  const applyProjectSelection = (project: ProjectSummary | null) => {
    setProjectModuleQuery('');
    setPreviewModuleDetail(null);
    setPreviewModuleError('');
    setPreviewModulePath(null);
    if (!project) {
      const sharedTarget = resolveSharedWorkspaceTarget(currentTitle);
      setActiveProjectSlug(null);
      setActiveProjectOwnerSlug(null);
      setActiveProjectTitle(null);
      setActiveProjectRoot(null);
      setActiveProjectPackageName(null);
      setActiveProjectGithubUrl(null);
      setActiveProjectVisibility('private');
      setActiveProjectCanEdit(true);
      setProjectGithubUrlDraft('');
      setActiveProjectEntryFilePath(null);
      setActiveProjectEntryModuleName(null);
      setSavedWorkspacePath(sharedTarget.path);
      setSavedWorkspaceModule(sharedTarget.module);
      return;
    }

    const nextTarget = resolveProjectWorkspaceTarget(
      project.package_name,
      currentTitle,
      project.entry_file_path,
    );
    setCurrentTitle(nextTarget.title);
    setActiveProjectSlug(project.slug);
    setActiveProjectOwnerSlug(project.owner_slug);
    setActiveProjectTitle(project.title);
    setActiveProjectRoot(project.project_root);
    setActiveProjectPackageName(project.package_name);
    setActiveProjectGithubUrl(project.github_url);
    setActiveProjectVisibility(project.visibility);
    setActiveProjectCanEdit(project.can_edit);
    setProjectGithubUrlDraft(project.github_url ?? '');
    setActiveProjectEntryFilePath(project.entry_file_path);
    setActiveProjectEntryModuleName(project.entry_module_name);
    setSavedWorkspacePath(nextTarget.path);
    setSavedWorkspaceModule(nextTarget.module);
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    latestCodeRef.current = currentCode;
    const persistTimer = window.setTimeout(() => {
      window.localStorage.setItem(
        PLAYGROUND_STORAGE_KEY,
        JSON.stringify({
          code: currentCode,
          title: currentTitle,
          proofWorkspaceId: activeProofWorkspaceId,
          pdfFilename: attachedPdfFilename,
          linkedPdfFilename,
          linkedPdfPreviewUrl,
          linkedPdfDownloadUrl,
          projectSlug: activeProjectSlug,
          projectOwnerSlug: activeProjectOwnerSlug,
          projectTitle: activeProjectTitle,
          projectRoot: activeProjectRoot,
          packageName: activeProjectPackageName,
          projectGithubUrl: activeProjectGithubUrl,
          projectVisibility: activeProjectVisibility,
          projectCanEdit: activeProjectCanEdit,
          projectFilePath: savedWorkspacePath,
          projectModuleName: savedWorkspaceModule,
          projectEntryFilePath: activeProjectEntryFilePath,
          projectEntryModuleName: activeProjectEntryModuleName,
        }),
      );
    }, 250);

    return () => window.clearTimeout(persistTimer);
  }, [
    activeProofWorkspaceId,
    activeProjectEntryFilePath,
    activeProjectEntryModuleName,
    activeProjectGithubUrl,
    activeProjectOwnerSlug,
    activeProjectPackageName,
    activeProjectCanEdit,
    activeProjectRoot,
    activeProjectSlug,
    activeProjectTitle,
    activeProjectVisibility,
    attachedPdfFilename,
    currentCode,
    currentTitle,
    linkedPdfDownloadUrl,
    linkedPdfFilename,
    linkedPdfPreviewUrl,
    savedWorkspaceModule,
    savedWorkspacePath,
  ]);

  useEffect(() => {
    onSessionMetadataChange?.({
      title: currentTitle,
      proofWorkspaceId: activeProofWorkspaceId,
      pdfFilename: attachedPdfFilename,
      linkedPdfFilename,
      linkedPdfPreviewUrl,
      linkedPdfDownloadUrl,
      projectSlug: activeProjectSlug,
      projectOwnerSlug: activeProjectOwnerSlug,
      projectTitle: activeProjectTitle,
      projectRoot: activeProjectRoot,
      packageName: activeProjectPackageName,
      projectGithubUrl: activeProjectGithubUrl,
      projectVisibility: activeProjectVisibility,
      projectCanEdit: activeProjectCanEdit,
      projectFilePath: savedWorkspacePath,
      projectModuleName: savedWorkspaceModule,
      projectEntryFilePath: activeProjectEntryFilePath,
      projectEntryModuleName: activeProjectEntryModuleName,
    });
  }, [
    activeProofWorkspaceId,
    activeProjectCanEdit,
    activeProjectEntryFilePath,
    activeProjectEntryModuleName,
    activeProjectGithubUrl,
    activeProjectOwnerSlug,
    activeProjectPackageName,
    activeProjectRoot,
    activeProjectSlug,
    activeProjectTitle,
    activeProjectVisibility,
    attachedPdfFilename,
    currentTitle,
    linkedPdfDownloadUrl,
    linkedPdfFilename,
    linkedPdfPreviewUrl,
    onSessionMetadataChange,
    savedWorkspaceModule,
    savedWorkspacePath,
  ]);

  useEffect(() => {
    let isMounted = true;

    if (!currentUser) {
      setAvailableProjects([]);
      setIsLoadingProjects(false);
      return;
    }

    const loadProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const items = await listProjects();
        if (isMounted) {
          setAvailableProjects(items);
        }
      } catch (error) {
        if (isMounted) {
          console.error('Failed to load selectable projects:', error);
        }
      } finally {
        if (isMounted) {
          setIsLoadingProjects(false);
        }
      }
    };

    void loadProjects();

    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!activeBuildJobId || !currentUser || typeof window === 'undefined') {
      return;
    }

    let cancelled = false;
    let pollTimer: number | null = null;

    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const pollJob = async () => {
      try {
        const job = await getVerifiedBuildJob(activeBuildJobId);
        if (cancelled) {
          return;
        }

        setActiveBuildJobStatus(job.status);
        if (job.status === 'queued' || job.status === 'running') {
          pollTimer = window.setTimeout(() => {
            void pollJob();
          }, 1500);
          return;
        }

        setActiveBuildJobId(null);

        if (job.status === 'succeeded') {
          if (pendingVerifiedSave) {
            setBaselineDocument((current) => ({
              ...current,
              code: pendingVerifiedSave.code,
              title: pendingVerifiedSave.title,
              proofWorkspaceId: pendingVerifiedSave.proofWorkspaceId,
              pdfFilename: pendingVerifiedSave.pdfFilename,
              projectFilePath: pendingVerifiedSave.projectFilePath,
              projectModuleName: pendingVerifiedSave.projectModuleName,
            }));
          }
          publishWorkspaceNotice(
            job.pdf_filename ?? pendingVerifiedSave?.pdfFilename
              ? 'Lean build finished and the verified database entry was updated with its linked PDF.'
              : 'Lean build finished and the verified database entry was updated.',
            'success',
          );
        } else {
          publishWorkspaceNotice(
            job.error ?? 'Lean build failed before the verified database entry could be updated.',
            'error',
          );
        }

        setPendingVerifiedSave(null);
      } catch (error: any) {
        if (cancelled) {
          return;
        }
        if (error?.response?.status === 401) {
          onLogout();
          onOpenAuth();
          publishWorkspaceNotice('Your session expired. Please sign in again.', 'error');
          setActiveBuildJobId(null);
          setPendingVerifiedSave(null);
          return;
        }
        if (error?.response?.status === 404) {
          publishWorkspaceNotice(
            'The background build status could not be found anymore. Refresh later to confirm the verified database entry.',
            'error',
          );
          setActiveBuildJobId(null);
          setPendingVerifiedSave(null);
          return;
        }
        pollTimer = window.setTimeout(() => {
          void pollJob();
        }, 2000);
      }
    };

    void pollJob();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [activeBuildJobId, currentUser, onLogout, onOpenAuth, pendingVerifiedSave]);

  useEffect(() => {
    let isMounted = true;

    if (!activeProjectSlug) {
      setProjectModules([]);
      setIsLoadingProjectModules(false);
      return;
    }

    const loadProjectModules = async () => {
      setIsLoadingProjectModules(true);
      try {
        const items = await listProjectModules(
          activeProjectSlug,
          activeProjectOwnerSlug ?? undefined,
        );
        if (isMounted) {
          setProjectModules(items);
        }
      } catch (error) {
        if (isMounted) {
          console.error('Failed to load project modules:', error);
        }
      } finally {
        if (isMounted) {
          setIsLoadingProjectModules(false);
        }
      }
    };

    void loadProjectModules();

    return () => {
      isMounted = false;
    };
  }, [activeProjectOwnerSlug, activeProjectSlug]);

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
      path: activeProjectRoot
        ? `${activeProjectRoot}/${savedWorkspacePath.replace(/^\/+/, '')}`
        : savedWorkspacePath,
      imports: parsedImports,
      cursor_line: cursorSnapshot.line,
      cursor_column: cursorSnapshot.column,
      cursor_line_text: cursorLineText || null,
      nearby_code: nearbyCode || null,
      proof_state: infoviewSnapshot || null,
      active_goal: activeGoal || null,
      proof_workspace_id: activeProofWorkspaceId,
      attached_pdf_filename: pendingPdfFile?.name ?? attachedPdfFilename ?? null,
    });
  }, [
    activeGoal,
    activeProofWorkspaceId,
    attachedPdfFilename,
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
          url: buildWebSocketUrl(activeProjectRoot),
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
        cursorDispose = leanEditor.editor.onDidChangeCursorPosition((event: { position: { lineNumber: number; column: number } }) => {
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
  }, [activeProjectRoot, editorModelPath]);

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
          if (!activeProjectSlug) {
            setSavedWorkspacePath(info.playground_file);
            setSavedWorkspaceModule(info.playground_module);
          }
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
  }, [activeProjectSlug]);

  useEffect(() => {
    if ((!seed?.code && !seed?.projectSlug) || seed.revision === 0) {
      return;
    }

    replacePendingPdf(null);
    applyDocument({
      code: seed.code,
      title: seed.title,
      source: seed.projectSlug ? 'project' : 'workspace',
      proofWorkspaceId: seed.proofWorkspaceId ?? null,
      pdfFilename: seed.pdfFilename ?? null,
      linkedPdfFilename: seed.linkedPdfFilename ?? null,
      linkedPdfPreviewUrl: seed.linkedPdfPreviewUrl ?? null,
      linkedPdfDownloadUrl: seed.linkedPdfDownloadUrl ?? null,
      workspacePath: seed.projectFilePath ?? savedWorkspacePath,
      workspaceModule: seed.projectModuleName ?? savedWorkspaceModule,
      projectSlug: seed.projectSlug ?? null,
      projectOwnerSlug: seed.projectOwnerSlug ?? null,
      projectTitle: seed.projectTitle ?? null,
      projectRoot: seed.projectRoot ?? null,
      packageName: seed.packageName ?? null,
      projectGithubUrl: seed.projectGithubUrl ?? null,
      projectVisibility: seed.projectVisibility ?? null,
      projectCanEdit: seed.projectCanEdit ?? null,
      projectEntryFilePath: seed.projectEntryFilePath ?? null,
      projectEntryModuleName: seed.projectEntryModuleName ?? null,
    });
  }, [
    savedWorkspaceModule,
    savedWorkspacePath,
    seed?.code,
    seed?.linkedPdfDownloadUrl,
    seed?.linkedPdfFilename,
    seed?.linkedPdfPreviewUrl,
    seed?.packageName,
    seed?.pdfFilename,
    seed?.projectEntryFilePath,
    seed?.projectEntryModuleName,
    seed?.projectFilePath,
    seed?.projectGithubUrl,
    seed?.projectOwnerSlug,
    seed?.projectModuleName,
    seed?.projectCanEdit,
    seed?.projectRoot,
    seed?.projectSlug,
    seed?.projectTitle,
    seed?.projectVisibility,
    seed?.proofWorkspaceId,
    seed?.revision,
    seed?.title,
  ]);

  useEffect(() => {
    if (!seed?.projectSlug) {
      return;
    }
    if (seed.code) {
      return;
    }

    let isMounted = true;

    const loadProjectDocument = async () => {
      try {
        const project = await openProject(
          seed.projectSlug!,
          seed.projectFilePath ?? undefined,
          seed.projectOwnerSlug ?? undefined,
        );
        if (!isMounted) {
          return;
        }

        replacePendingPdf(null);
        applyDocument({
          code: project.content,
          title: project.workspace_title,
          source: 'project',
          workspacePath: project.workspace_file_path,
          workspaceModule: project.workspace_module_name,
          projectSlug: project.slug,
          projectOwnerSlug: project.owner_slug,
          projectTitle: project.title,
          projectRoot: project.project_root,
          packageName: project.package_name,
          projectGithubUrl: project.github_url,
          projectVisibility: project.visibility,
          projectCanEdit: project.can_edit,
          projectEntryFilePath: project.entry_file_path,
          projectEntryModuleName: project.entry_module_name,
          linkedPdfFilename: seed.linkedPdfFilename ?? null,
          linkedPdfPreviewUrl: seed.linkedPdfPreviewUrl ?? null,
          linkedPdfDownloadUrl: seed.linkedPdfDownloadUrl ?? null,
        });
      } catch (error: any) {
        if (!isMounted) {
          return;
        }
        if (error?.response?.status === 401) {
          onLogout();
          onOpenAuth();
          publishWorkspaceNotice('Sign in to open project workspaces.', 'error');
          return;
        }
        publishWorkspaceNotice(
          error?.response?.data?.detail ?? 'Failed to open the selected project file.',
          'error',
        );
      }
    };

    void loadProjectDocument();

    return () => {
      isMounted = false;
    };
  }, [
    onLogout,
    onOpenAuth,
    seed?.code,
    seed?.linkedPdfDownloadUrl,
    seed?.linkedPdfFilename,
    seed?.linkedPdfPreviewUrl,
    seed?.projectFilePath,
    seed?.projectOwnerSlug,
    seed?.projectSlug,
    seed?.revision,
  ]);

  const applyDocument = ({
    code,
    title,
    source,
    proofWorkspaceId = null,
    pdfFilename: _pdfFilename = null,
    linkedPdfFilename: nextLinkedPdfFilename = null,
    linkedPdfPreviewUrl: nextLinkedPdfPreviewUrl = null,
    linkedPdfDownloadUrl: nextLinkedPdfDownloadUrl = null,
    workspacePath = savedWorkspacePath,
    workspaceModule = savedWorkspaceModule,
    projectSlug = null,
    projectOwnerSlug = null,
    projectTitle = null,
    projectRoot = null,
    packageName = null,
    projectGithubUrl = null,
    projectVisibility = null,
    projectCanEdit = null,
    projectEntryFilePath = null,
    projectEntryModuleName = null,
  }: {
    code: string;
    title: string;
    source: string;
    proofWorkspaceId?: number | null;
    pdfFilename?: string | null;
    linkedPdfFilename?: string | null;
    linkedPdfPreviewUrl?: string | null;
    linkedPdfDownloadUrl?: string | null;
    workspacePath?: string;
    workspaceModule?: string;
    projectSlug?: string | null;
    projectOwnerSlug?: string | null;
    projectTitle?: string | null;
    projectRoot?: string | null;
    packageName?: string | null;
    projectGithubUrl?: string | null;
    projectVisibility?: 'public' | 'private' | null;
    projectCanEdit?: boolean | null;
    projectEntryFilePath?: string | null;
    projectEntryModuleName?: string | null;
  }) => {
    setPreviewModuleDetail(null);
    setPreviewModuleError('');
    setPreviewModulePath(null);
    latestCodeRef.current = code;
    setCurrentCode(code);
    setCurrentTitle(title);
    setDocumentSource(source);
    setActiveProofWorkspaceId(proofWorkspaceId);
    setSavedWorkspacePath(workspacePath);
    setSavedWorkspaceModule(workspaceModule);
    setActiveProjectSlug(projectSlug);
    setActiveProjectOwnerSlug(projectOwnerSlug);
    setActiveProjectTitle(projectTitle);
    setActiveProjectRoot(projectRoot);
    setActiveProjectPackageName(packageName);
    setActiveProjectGithubUrl(projectGithubUrl);
    setActiveProjectVisibility(projectVisibility ?? 'private');
    setActiveProjectCanEdit(projectCanEdit ?? true);
    setProjectGithubUrlDraft(projectGithubUrl ?? '');
    setActiveProjectEntryFilePath(projectEntryFilePath);
    setActiveProjectEntryModuleName(projectEntryModuleName);
    setAttachedPdfFilename(_pdfFilename);
    setLinkedPdfFilename(nextLinkedPdfFilename);
    setLinkedPdfPreviewUrl(nextLinkedPdfPreviewUrl);
    setLinkedPdfDownloadUrl(nextLinkedPdfDownloadUrl);
    setBaselineDocument({
      code,
      title,
      proofWorkspaceId,
      pdfFilename: _pdfFilename,
      linkedPdfFilename: nextLinkedPdfFilename,
      linkedPdfPreviewUrl: nextLinkedPdfPreviewUrl,
      linkedPdfDownloadUrl: nextLinkedPdfDownloadUrl,
      projectSlug,
      projectOwnerSlug,
      projectTitle,
      projectRoot,
      packageName,
      projectGithubUrl,
      projectVisibility,
      projectCanEdit,
      projectFilePath: workspacePath,
      projectModuleName: workspaceModule,
      projectEntryFilePath,
      projectEntryModuleName,
    });
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
      source: baselineDocument.projectSlug ? 'project' : documentSource,
      proofWorkspaceId: baselineDocument.proofWorkspaceId ?? null,
      pdfFilename: baselineDocument.pdfFilename ?? null,
      linkedPdfFilename: baselineDocument.linkedPdfFilename ?? null,
      linkedPdfPreviewUrl: baselineDocument.linkedPdfPreviewUrl ?? null,
      linkedPdfDownloadUrl: baselineDocument.linkedPdfDownloadUrl ?? null,
      workspacePath: baselineDocument.projectFilePath ?? savedWorkspacePath,
      workspaceModule: baselineDocument.projectModuleName ?? savedWorkspaceModule,
      projectSlug: baselineDocument.projectSlug ?? null,
      projectOwnerSlug: baselineDocument.projectOwnerSlug ?? null,
      projectTitle: baselineDocument.projectTitle ?? null,
      projectRoot: baselineDocument.projectRoot ?? null,
      packageName: baselineDocument.packageName ?? null,
      projectGithubUrl: baselineDocument.projectGithubUrl ?? null,
      projectVisibility: baselineDocument.projectVisibility ?? null,
      projectCanEdit: baselineDocument.projectCanEdit ?? null,
      projectEntryFilePath: baselineDocument.projectEntryFilePath ?? null,
      projectEntryModuleName: baselineDocument.projectEntryModuleName ?? null,
    });
  };

  const handleRestartLean = () => {
    leanMonacoRef.current?.restart();
  };

  const handleCopyShareLink = async () => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'playground');
      if (activeProjectSlug) {
        url.searchParams.set('project', activeProjectSlug);
        if (activeProjectOwnerSlug) {
          url.searchParams.set('projectOwner', activeProjectOwnerSlug);
        } else {
          url.searchParams.delete('projectOwner');
        }
        if (savedWorkspacePath) {
          url.searchParams.set('projectFile', savedWorkspacePath);
        } else {
          url.searchParams.delete('projectFile');
        }
        url.searchParams.delete('leanCode');
        url.searchParams.delete('leanTitle');
      } else {
        url.searchParams.set('leanCode', encodeSharedCode(currentCode));
        url.searchParams.set('leanTitle', currentTitle);
        url.searchParams.delete('project');
        url.searchParams.delete('projectOwner');
        url.searchParams.delete('projectFile');
      }
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
      const nextTarget = resolveDisplayedWorkspaceTarget({
        title,
        projectSlug: activeProjectSlug,
        packageName: activeProjectPackageName,
        entryFilePath: activeProjectEntryFilePath,
        fallbackPath: savedWorkspacePath,
        fallbackModule: savedWorkspaceModule,
      });
      setEditorError('');
      applyDocument({
        code,
        title,
        source: activeProjectSlug ? 'project' : 'uploaded',
        proofWorkspaceId: activeProjectSlug ? activeProofWorkspaceId : null,
        pdfFilename: null,
        workspacePath: nextTarget.path,
        workspaceModule: nextTarget.module,
        projectSlug: activeProjectSlug,
        projectOwnerSlug: activeProjectOwnerSlug,
        projectTitle: activeProjectTitle,
        projectRoot: activeProjectRoot,
        packageName: activeProjectPackageName,
        projectGithubUrl: activeProjectGithubUrl,
        projectVisibility: activeProjectVisibility,
        projectCanEdit: activeProjectCanEdit,
        projectEntryFilePath: activeProjectEntryFilePath,
        projectEntryModuleName: activeProjectEntryModuleName,
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
    setAttachedPdfFilename(baselineDocument.pdfFilename ?? null);
    setWorkspaceNotice('');
  };

  const handleProjectSelectionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value;
    if (!nextValue) {
      applyProjectSelection(null);
      return;
    }

    const nextProject = selectableProjects.find(
      (project) => `${project.owner_slug}:${project.slug}` === nextValue,
    );
    if (!nextProject) {
      return;
    }

    applyProjectSelection(nextProject);
  };

  const handleOpenProjectModule = async (module: ProjectModule) => {
    if (!activeProjectSlug || !module.document_id) {
      return;
    }

    setOpeningProjectModulePath(module.path);
    setPreviewModulePath(module.path);
    setPreviewModuleError('');
    setPreviewModuleDetail(null);
    setWorkspaceNotice('');
    try {
      const theorem = await getTheoremDetail(module.document_id);
      setPreviewModuleDetail(theorem);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        onLogout();
        onOpenAuth();
        setPreviewModuleError('Sign in to open verified code entries.');
      } else {
        setPreviewModuleError(
          error?.response?.data?.detail ?? 'Failed to open the verified database entry for this module.',
        );
      }
    } finally {
      setOpeningProjectModulePath(null);
    }
  };

  const handleRemixPreviewModule = () => {
    if (!previewModuleDetail) {
      return;
    }
    const remixTarget = resolveSharedWorkspaceTarget(previewModuleDetail.title);

    replacePendingPdf(null);
    applyDocument({
      code: previewModuleDetail.content,
      title: previewModuleDetail.title,
      source: 'local',
      proofWorkspaceId: null,
      pdfFilename: null,
      linkedPdfFilename: null,
      linkedPdfPreviewUrl: null,
      linkedPdfDownloadUrl: null,
      workspacePath: remixTarget.path,
      workspaceModule: remixTarget.module,
      projectSlug: null,
      projectOwnerSlug: null,
      projectTitle: null,
      projectRoot: null,
      packageName: null,
      projectGithubUrl: null,
      projectVisibility: null,
      projectCanEdit: null,
      projectEntryFilePath: null,
      projectEntryModuleName: null,
    });
    setPreviewModuleDetail(null);
    setPreviewModuleError('');
    setPreviewModulePath(null);
  };

  const performVerifiedDatabaseSave = async () => {
    const effectiveTitleInput = currentTitle;
    const preparedProjectTarget = activeProjectSlug
      ? commitProjectFileName(effectiveTitleInput)
      : null;
    let effectiveTitle =
      activeProjectSlug && preparedProjectTarget
        ? preparedProjectTarget.title
        : currentTitle.trim() || DEFAULT_DOCUMENT.title;
    let targetProjectRoot = activeProjectRoot;
    let targetProjectFilePath = activeProjectSlug
      ? (preparedProjectTarget?.path ?? savedWorkspacePath)
      : null;
    let targetProjectModuleName = activeProjectSlug
      ? (preparedProjectTarget?.module ?? savedWorkspaceModule)
      : null;
    let validationProjectRoot = activeProjectRoot;
    let validationProjectFilePath = activeProjectSlug
      ? (preparedProjectTarget?.path ?? savedWorkspacePath)
      : null;

    if (activeProjectSlug) {
      if (!canEditProject) {
        throw new Error(
          'The selected project is read-only. Choose one of your editable projects or clear the project selection.',
        );
      }

      const savedProjectFile = await saveProjectFile(activeProjectSlug, {
        path: targetProjectFilePath ?? savedWorkspacePath,
        content: currentCode,
      });

      effectiveTitle = savedProjectFile.workspace_title;
      targetProjectRoot = savedProjectFile.project_root;
      targetProjectFilePath = savedProjectFile.workspace_file_path;
      targetProjectModuleName = savedProjectFile.workspace_module_name;
      validationProjectRoot = savedProjectFile.project_root;
      validationProjectFilePath = savedProjectFile.workspace_file_path;

      setCurrentTitle(savedProjectFile.workspace_title);
      setSavedWorkspacePath(savedProjectFile.workspace_file_path);
      setSavedWorkspaceModule(savedProjectFile.workspace_module_name);
      setDocumentSource('project');
      setBaselineDocument((current) => ({
        ...current,
        title: savedProjectFile.workspace_title,
        projectSlug: savedProjectFile.slug,
        projectOwnerSlug: savedProjectFile.owner_slug,
        projectTitle: savedProjectFile.title,
        projectRoot: savedProjectFile.project_root,
        packageName: savedProjectFile.package_name,
        projectGithubUrl: savedProjectFile.github_url,
        projectVisibility: savedProjectFile.visibility,
        projectCanEdit: savedProjectFile.can_edit,
        projectFilePath: savedProjectFile.workspace_file_path,
        projectModuleName: savedProjectFile.workspace_module_name,
        projectEntryFilePath: savedProjectFile.entry_file_path,
        projectEntryModuleName: savedProjectFile.entry_module_name,
      }));
    }

    if (pendingPdfFile) {
      const fallbackTitle = pendingPdfFile.name.replace(/\.pdf$/i, '') || 'Uploaded proof';
      const normalizedTitle =
        effectiveTitle.trim() && effectiveTitle.trim() !== DEFAULT_DOCUMENT.title
          ? effectiveTitle.trim()
          : fallbackTitle;
      const workspace = await uploadProofPdf(normalizedTitle, pendingPdfFile, {
        workspace_id: activeProofWorkspaceId,
        lean4_code: hasMeaningfulLeanCode(currentCode) ? currentCode : null,
        project_root: targetProjectRoot,
        project_file_path: targetProjectFilePath,
        validation_project_root: validationProjectRoot,
        validation_project_file_path: validationProjectFilePath,
      });
      const nextTitle = activeProjectSlug ? effectiveTitle : workspace.title;
      const nextCode =
        activeProjectSlug || hasMeaningfulLeanCode(currentCode) ? currentCode : workspace.lean4_code;
      const nextPdfFilename =
        workspace.pdf_filename ?? workspace.source_filename ?? pendingPdfFile.name;

      replacePendingPdf(null);
      setAttachedPdfFilename(nextPdfFilename);
      setActiveProofWorkspaceId(workspace.id);
      if (!activeProjectSlug) {
        setCurrentTitle(nextTitle);
        setCurrentCode(nextCode);
        latestCodeRef.current = nextCode;
        const model = leanEditorRef.current?.editor?.getModel();
        if (model && model.getValue() !== nextCode) {
          applyingExternalCodeRef.current = true;
          try {
            model.setValue(nextCode);
          } finally {
            applyingExternalCodeRef.current = false;
          }
        }
      }
      const queuedSnapshot: PendingVerifiedSaveSnapshot = {
        code: nextCode,
        title: nextTitle,
        proofWorkspaceId: workspace.id,
        pdfFilename: nextPdfFilename,
        projectFilePath: targetProjectFilePath,
        projectModuleName: targetProjectModuleName,
      };
      if (workspace.build_job_id) {
        setPendingVerifiedSave(queuedSnapshot);
        setActiveBuildJobId(workspace.build_job_id);
        setActiveBuildJobStatus(workspace.build_status ?? 'queued');
        publishWorkspaceNotice(
          'Uploaded the current Lean code and attached PDF. Lean build and verified database sync are running in the background.',
          'success',
        );
      } else {
        setBaselineDocument((current) => ({
          ...current,
          ...queuedSnapshot,
        }));
        publishWorkspaceNotice(
          'Uploaded the current Lean code and attached PDF to the verified database. Open the entry there to inspect the split view.',
          'success',
        );
      }
      return;
    }

    const response = await syncLeanPlaygroundToWorkspace({
      code: currentCode,
      title: effectiveTitle,
      proof_workspace_id: activeProofWorkspaceId,
      project_root: targetProjectRoot,
      project_file_path: targetProjectFilePath,
      validation_project_root: validationProjectRoot,
      validation_project_file_path: validationProjectFilePath,
    });

    setWorkspaceInfo(response);
    if (!activeProjectSlug) {
      setSavedWorkspacePath(response.saved_path);
      setSavedWorkspaceModule(response.saved_module);
    }
    setActiveProofWorkspaceId(response.proof_workspace_id ?? activeProofWorkspaceId);
    setAttachedPdfFilename(response.pdf_filename ?? attachedPdfFilename ?? null);
    leanMonacoRef.current?.restart();
    const queuedSnapshot: PendingVerifiedSaveSnapshot = {
      code: currentCode,
      title: effectiveTitle,
      proofWorkspaceId: response.proof_workspace_id ?? activeProofWorkspaceId ?? null,
      pdfFilename: response.pdf_filename ?? attachedPdfFilename ?? null,
      projectFilePath: targetProjectFilePath,
      projectModuleName: targetProjectModuleName,
    };
    if (response.build_job_id) {
      setPendingVerifiedSave(queuedSnapshot);
      setActiveBuildJobId(response.build_job_id);
      setActiveBuildJobStatus(response.build_status ?? 'queued');
      publishWorkspaceNotice(
        'Saved the current Lean code locally. Lean build and verified database sync are running in the background.',
        'success',
      );
    } else {
      setBaselineDocument((current) => ({
        ...current,
        ...queuedSnapshot,
      }));
      publishWorkspaceNotice(
        response.pdf_filename
          ? 'Updated the verified database entry and kept the linked PDF. The detail page will render both in split view.'
          : 'Saved the current Lean code to the verified database.',
        'success',
      );
    }
  };

  const handleUploadToVerifiedDatabase = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setIsUploadingToDatabase(true);
    setWorkspaceNotice('');

    try {
      await performVerifiedDatabaseSave();
    } catch (error: any) {
      console.error('Failed to upload the Lean playground code to the verified database:', error);
      if (error?.response?.status === 401) {
        onLogout();
        onOpenAuth();
        publishWorkspaceNotice('Your session expired. Please sign in again.', 'error');
      } else {
        publishWorkspaceNotice(
          error?.response?.data?.detail ?? error?.message ?? 'Failed to upload the current Lean code to the verified database.',
          'error',
        );
      }
    } finally {
      setIsUploadingToDatabase(false);
    }
  };

  const handleSaveProjectLink = async () => {
    if (!activeProjectSlug) {
      return;
    }
    if (!activeProjectCanEdit) {
      publishWorkspaceNotice('This public project is read-only for you.', 'error');
      return;
    }

    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setIsSavingProjectLink(true);
    setWorkspaceNotice('');

    try {
      const project = await updateProject(activeProjectSlug, {
        title: activeProjectTitle,
        github_url: projectGithubUrlDraft.trim() || null,
        visibility: activeProjectVisibility,
      });
      setActiveProjectTitle(project.title);
      setActiveProjectGithubUrl(project.github_url);
      setActiveProjectVisibility(project.visibility);
      setActiveProjectCanEdit(project.can_edit);
      setProjectGithubUrlDraft(project.github_url ?? '');
      setBaselineDocument((current) => ({
        ...current,
        projectTitle: project.title,
        projectGithubUrl: project.github_url,
        projectVisibility: project.visibility,
        projectCanEdit: project.can_edit,
      }));
      publishWorkspaceNotice(
        project.github_url
          ? 'Saved the project GitHub link.'
          : 'Removed the project GitHub link.',
        'success',
      );
    } catch (error: any) {
      if (error?.response?.status === 401) {
        onLogout();
        onOpenAuth();
        publishWorkspaceNotice('Your session expired. Please sign in again.', 'error');
      } else {
        publishWorkspaceNotice(
          error?.response?.data?.detail ?? 'Failed to save the project GitHub link.',
          'error',
        );
      }
    } finally {
      setIsSavingProjectLink(false);
    }
  };

  const handleOpenRepository = () => {
    if (!activeProjectGithubUrl || typeof window === 'undefined') {
      return;
    }

    window.open(activeProjectGithubUrl, '_blank', 'noopener,noreferrer');
  };

  const lineCount = Math.max(currentCode.split('\n').length, 1);
  const webSocketUrl = buildWebSocketUrl(activeProjectRoot);
  const workspaceModules = workspaceInfo?.importable_modules ?? [];
  const attachedPdfPreviewUrl = pendingPdfPreviewUrl;
  const attachedPdfDownloadUrl = pendingPdfPreviewUrl;
  const visiblePdfName = pendingPdfFile?.name ?? null;
  const isProjectMode = Boolean(activeProjectSlug);
  const savedPdfPreviewUrl =
    !pendingPdfFile && activeProofWorkspaceId && attachedPdfFilename
      ? getProofWorkspacePdfUrl(activeProofWorkspaceId)
      : null;
  const savedPdfDownloadUrl =
    !pendingPdfFile && activeProofWorkspaceId && attachedPdfFilename
      ? getProofWorkspacePdfUrl(activeProofWorkspaceId, true)
      : null;
  const sourceLinkedPdfVisible =
    !pendingPdfFile &&
    !savedPdfPreviewUrl &&
    Boolean(linkedPdfFilename && linkedPdfPreviewUrl && linkedPdfDownloadUrl);
  const isWorkspaceBusy = isUploadingToDatabase || Boolean(activeBuildJobId);
  const canEditProject = Boolean(activeProjectSlug && activeProjectCanEdit);
  const saveActionLabel = 'Save to Verified DB';
  const saveActionBusyLabel =
    activeBuildJobId && !isUploadingToDatabase
      ? activeBuildJobStatus === 'running'
        ? 'Building...'
        : 'Queued...'
      : 'Saving...';

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
          <VerifiedModulePreviewCard
            detail={previewModuleDetail}
            error={previewModuleError}
            isLoading={Boolean(previewModulePath && openingProjectModulePath === previewModulePath)}
            modulePath={previewModulePath}
            onRemix={handleRemixPreviewModule}
            onClose={() => {
              setPreviewModuleDetail(null);
              setPreviewModuleError('');
              setPreviewModulePath(null);
            }}
          />
          {isAuxiliaryUiVisible && (
            <div className="playground-shell-header">
              <div>
                <div className="formal-editor-title">{currentTitle}</div>
                <div className="formal-editor-subtitle">
                  {isProjectMode
                    ? canEditProject
                      ? 'Using your Lean project context'
                      : 'Using a public Lean project context'
                    : documentSource === 'workspace'
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
                <span>{displayedWorkspaceTarget.path}</span>
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

          {isAuxiliaryUiVisible &&
            !pendingPdfFile &&
            attachedPdfFilename &&
            savedPdfPreviewUrl &&
            savedPdfDownloadUrl && (
              <div className="playground-pdf-banner">
                <div className="playground-pdf-banner-info">
                  <div className="playground-pdf-banner-label">
                    <FileText size={16} />
                    <span>{attachedPdfFilename}</span>
                  </div>
                  <span className="proof-badge">Saved in Verified DB</span>
                </div>
                <div className="playground-pdf-banner-actions">
                  <a
                    className="button-secondary"
                    href={savedPdfPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} />
                    Open PDF
                  </a>
                  <a
                    className="button-secondary"
                    href={savedPdfDownloadUrl}
                    download={attachedPdfFilename}
                  >
                    <Download size={16} />
                    Download
                  </a>
              </div>
            </div>
          )}

          {isAuxiliaryUiVisible &&
            sourceLinkedPdfVisible &&
            linkedPdfFilename &&
            linkedPdfPreviewUrl &&
            linkedPdfDownloadUrl && (
              <div className="playground-pdf-banner is-linked">
                <div className="playground-pdf-banner-info">
                  <div className="playground-pdf-banner-label">
                    <FileText size={16} />
                    <span>{linkedPdfFilename}</span>
                  </div>
                  <span className="proof-badge">Linked from Source</span>
                </div>
                <div className="playground-pdf-banner-actions">
                  <a
                    className="button-secondary"
                    href={linkedPdfPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} />
                    Open PDF
                  </a>
                  <a
                    className="button-secondary"
                    href={linkedPdfDownloadUrl}
                    download={linkedPdfFilename}
                  >
                    <Download size={16} />
                    Download
                  </a>
                </div>
              </div>
            )}

          <div
            className={`playground-columns ${!isAuxiliaryUiVisible ? 'is-compact' : ''} ${isProjectMode ? 'has-project-explorer' : ''}`}
          >
            {isProjectMode && (
              <aside className="playground-module-panel">
                <div className="playground-module-panel-header">
                  <div className="proof-section-heading">
                    <FileText size={16} color="var(--secondary-accent)" />
                    <span>Project Modules</span>
                  </div>
                  <div className="proof-helper-text">
                    Browse the verified Lean modules inside the selected project.
                  </div>
                  <label className="playground-module-search-field">
                    <span>Search modules</span>
                    <input
                      className="input-field"
                      value={projectModuleQuery}
                      onChange={(event) => setProjectModuleQuery(event.target.value)}
                      placeholder="Filter by title, path, or module"
                    />
                  </label>
                </div>
                <div className="playground-module-list">
                  {isLoadingProjectModules ? (
                    <div className="theorem-empty-state">
                      <LoaderCircle size={18} className="spin" />
                      Loading modules...
                    </div>
                  ) : projectModules.length === 0 ? (
                    <div className="theorem-empty-state">
                      No verified Lean modules were found in this project yet.
                    </div>
                  ) : filteredProjectModules.length === 0 ? (
                    <div className="theorem-empty-state">
                      No verified modules match the current search.
                    </div>
                  ) : (
                    filteredProjectModules.map((module) => {
                      const isActive = module.path === savedWorkspacePath;
                      const isOpening = module.path === openingProjectModulePath;
                      return (
                        <button
                          key={module.path}
                          type="button"
                          className={`playground-module-item ${isActive ? 'is-active' : ''}`}
                          onClick={() => void handleOpenProjectModule(module)}
                          disabled={isOpening}
                          style={{ paddingLeft: `${16 + module.depth * 14}px` }}
                        >
                          <div className="playground-module-item-title-row">
                            <span className="playground-module-item-title">{module.title}</span>
                            {module.is_entry && <span className="proof-badge">entry</span>}
                            {isOpening && <LoaderCircle size={14} className="spin" />}
                          </div>
                          <div className="playground-module-item-meta">{module.path}</div>
                          <div className="playground-module-item-meta">{module.module_name}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>
            )}
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
                <div className="playground-sidebar-scroll">
                <div className="playground-sidebar-section">
                  <label className="playground-toolbar-group playground-title-field">
                    <span>Project</span>
                    <select
                      className="input-field"
                      value={projectSelectionValue}
                      onChange={handleProjectSelectionChange}
                      disabled={!currentUser || isLoadingProjects}
                    >
                      <option value="">
                        {currentUser
                          ? isLoadingProjects
                            ? 'Loading projects...'
                            : 'No project'
                          : 'Sign in to select a project'}
                      </option>
                      {selectableProjects.map((project) => (
                        <option
                          key={`${project.owner_slug}:${project.slug}`}
                          value={`${project.owner_slug}:${project.slug}`}
                        >
                          {project.title} ({project.visibility})
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="proof-infoview-detail">
                    Projects here are used as Lean import context and verified DB grouping only.
                  </div>
                </div>

                <div className="playground-sidebar-section">
                  <label className="playground-toolbar-group playground-title-field">
                    <span>{isProjectMode ? 'File' : 'Document'}</span>
                    <input
                      className="input-field playground-file-name-input"
                      value={currentTitle}
                      onChange={(event) => setCurrentTitle(event.target.value)}
                      onBlur={() => {
                        if (activeProjectSlug) {
                          commitProjectFileName();
                        }
                      }}
                      placeholder={isProjectMode ? 'Lean file name' : 'Lean document title'}
                      title={currentTitle}
                    />
                  </label>
                </div>

                <div className="playground-sidebar-section">
                  <div className="proof-infoview-card playground-save-card">
                    <div className="proof-infoview-label">Save</div>
                    <div className="proof-infoview-detail">
                      {isProjectMode
                        ? 'Projects group Lean files. Saving here publishes the current Lean code to the verified database under the active project.'
                        : 'Save the current Lean code to the verified database. If a PDF is attached, the verified detail view will show both side by side.'}
                    </div>
                    <div className="playground-toolbar-actions" style={{ marginTop: '12px' }}>
                      <button
                        type="button"
                        className="button-primary"
                        onClick={handleUploadToVerifiedDatabase}
                        disabled={isWorkspaceBusy}
                      >
                        {isWorkspaceBusy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <FileText size={16} />
                        )}
                        {isWorkspaceBusy ? saveActionBusyLabel : saveActionLabel}
                      </button>
                    </div>
                    {pendingPdfFile && (
                      <div className="proof-infoview-detail" style={{ marginTop: '4px' }}>
                        The attached PDF will be stored together with this Lean code in the verified
                        database.
                      </div>
                    )}
                  </div>
                </div>

                <div className="playground-toolbar-actions playground-sidebar-actions">
                  <button type="button" className="button-secondary" onClick={handleSelectCodeUpload}>
                    <FileUp size={16} />
                    Upload Code
                  </button>
                  <button type="button" className="button-secondary" onClick={handleSelectPdfUpload}>
                    <FileUp size={16} />
                    {pendingPdfFile ? 'Replace PDF' : 'Upload PDF'}
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
                  {isProjectMode && activeProjectGithubUrl && (
                    <button type="button" className="button-secondary" onClick={handleOpenRepository}>
                      <ExternalLink size={16} />
                      Open Link
                    </button>
                  )}
                </div>

                <div className="playground-note-list">
                  <div className="playground-sidebar-meta">
                    <span className="proof-badge">{editorStatus}</span>
                    <span className="proof-badge">{lineCount} lines</span>
                    <span className="proof-badge">{`L${cursorSnapshot.line}:C${cursorSnapshot.column}`}</span>
                    <span className="proof-badge">{displayedWorkspaceTarget.module}</span>
                    <span className="proof-badge">{webSocketUrl}</span>
                  </div>
                  <div className="proof-infoview-card">
                    <div className="proof-infoview-label">Workspace File</div>
                    <div className="proof-infoview-detail">
                      {displayedWorkspaceTarget.path}
                    </div>
                  </div>
                  {isProjectMode && (
                    <div className="proof-infoview-card">
                      <div className="proof-infoview-label">Project</div>
                      <div className="proof-infoview-detail">
                        {activeProjectTitle || activeProjectSlug}
                      </div>
                      <div className="proof-infoview-detail">
                        Owner `{activeProjectOwnerSlug}` · Visibility `{activeProjectVisibility}`
                      </div>
                      <div className="proof-infoview-detail">{activeProjectRoot}</div>
                      <div className="proof-infoview-detail">
                        Package `{activeProjectPackageName}` · Entry `{activeProjectEntryModuleName}`
                      </div>
                      {!canEditProject && (
                        <div className="proof-infoview-detail" style={{ marginTop: '8px', color: '#ffcf8b' }}>
                          This public project is open read-only. Save to `Verified DB` if you want to keep your own copy of the current code.
                        </div>
                      )}
                    </div>
                  )}
                  {isProjectMode && canEditProject && (
                    <div className="proof-infoview-card">
                      <div className="proof-infoview-label">GitHub Link</div>
                      <div className="proof-infoview-detail">
                        This project keeps its own repository link. Saving the link does not push code.
                      </div>
                      <label className="playground-toolbar-group playground-title-field" style={{ marginTop: '12px' }}>
                        <span>Repository URL</span>
                        <input
                          className="input-field"
                          value={projectGithubUrlDraft}
                          onChange={(event) => setProjectGithubUrlDraft(event.target.value)}
                          placeholder="https://github.com/owner/repository"
                          maxLength={1024}
                        />
                      </label>
                      <div className="playground-toolbar-actions" style={{ marginTop: '12px' }}>
                        <button
                          type="button"
                          className="button-primary"
                          onClick={handleSaveProjectLink}
                          disabled={isSavingProjectLink}
                        >
                          {isSavingProjectLink ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                          {isSavingProjectLink ? 'Saving Link...' : 'Save Link'}
                        </button>
                        {activeProjectGithubUrl && (
                          <button type="button" className="button-secondary" onClick={handleOpenRepository}>
                            <ExternalLink size={16} />
                            Open Link
                          </button>
                        )}
                      </div>
                    </div>
                  )}
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
                        This PDF is attached only in the playground right now. Use Save to Verified DB
                        to store it together with the current Lean code, then inspect both in split view
                        from the verified database.
                      </div>
                    </div>
                  )}
                  {!pendingPdfFile &&
                    attachedPdfFilename &&
                    savedPdfPreviewUrl &&
                    savedPdfDownloadUrl && (
                      <div className="proof-infoview-card playground-pdf-card">
                        <div className="proof-infoview-label">Saved PDF</div>
                        <div className="playground-pdf-actions">
                          <a
                            className="button-secondary"
                            href={savedPdfPreviewUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={16} />
                            Open PDF
                          </a>
                          <a
                            className="button-secondary"
                            href={savedPdfDownloadUrl}
                            download={attachedPdfFilename}
                          >
                            <Download size={16} />
                            Download PDF
                          </a>
                        </div>
                        <iframe
                          className="playground-pdf-frame"
                          src={savedPdfPreviewUrl}
                          title={`${currentTitle} PDF preview`}
                        />
                        <div className="proof-infoview-detail">
                          This PDF is already linked to the verified database entry for the current code.
                          Opening that entry will show the Lean code and PDF side by side.
                        </div>
                      </div>
                    )}
                  {sourceLinkedPdfVisible &&
                    linkedPdfFilename &&
                    linkedPdfPreviewUrl &&
                    linkedPdfDownloadUrl && (
                      <div className="proof-infoview-card playground-pdf-card">
                        <div className="proof-infoview-label">Source PDF</div>
                        <div className="playground-pdf-actions">
                          <a
                            className="button-secondary"
                            href={linkedPdfPreviewUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={16} />
                            Open PDF
                          </a>
                          <a
                            className="button-secondary"
                            href={linkedPdfDownloadUrl}
                            download={linkedPdfFilename}
                          >
                            <Download size={16} />
                            Download PDF
                          </a>
                        </div>
                        <iframe
                          className="playground-pdf-frame"
                          src={linkedPdfPreviewUrl}
                          title={`${currentTitle} source PDF preview`}
                        />
                        <div className="proof-infoview-detail">
                          This PDF is linked from the current source artifact and stays read-only in the playground.
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
                      {isProjectMode
                        ? 'Project files keep the `import <Package>.Main` convention and build inside the selected project root.'
                        : 'Save from the playground, then import any module below from the shared Lean workspace.'}
                    </div>
                    {isProjectMode ? (
                      <div className="playground-import-list">
                        {activeProjectEntryModuleName && (
                          <code>{`import ${activeProjectEntryModuleName}`}</code>
                        )}
                        {activeProjectPackageName && (
                          <code>{`import ${activeProjectPackageName}`}</code>
                        )}
                      </div>
                    ) : (
                      <div className="playground-import-list">
                        {workspaceModules.slice(0, 8).map((item) => (
                          <code key={item.path}>{`import ${item.module}`}</code>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="proof-infoview-card">
                    <div className="proof-infoview-label">Share</div>
                    <div className="proof-infoview-detail">
                      {isProjectMode
                        ? 'Copy a URL that reopens the selected project root and file.'
                        : 'Copy a URL snapshot of the current code, similar to the official Lean live editor.'}
                    </div>
                  </div>
                  <div className="proof-infoview-card">
                    <div className="proof-infoview-label">Container</div>
                    <div className="proof-infoview-detail">
                      The Lean server runs in the dedicated Docker service on port 8080.
                    </div>
                  </div>
                </div>
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
