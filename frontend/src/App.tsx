import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Bot, LogOut, Microscope, RefreshCw, ShieldCheck, X } from 'lucide-react';
import './index.css';

import {
  type ChatCodeContextPayload,
  getCurrentUser,
  hasStoredToken,
  setAuthToken,
  type AuthResponse,
  type AuthUser,
} from './api';
import { AdminPage } from './components/Admin/AdminPage';
import { AuthPanel } from './components/Auth/AuthPanel';
import { Chatbot } from './components/Chatbot/Chatbot';
import { CommunityComposer } from './components/Community/CommunityComposer';
import { CommunityHome } from './components/Community/CommunityHome';
import { CommunityPostDetail } from './components/Community/CommunityPostDetail';
import { RecoverableErrorBoundary } from './components/ErrorBoundary/RecoverableErrorBoundary';
import { MyPage } from './components/MyPage/MyPage';
import { AgentGraph, type GraphProjectFilterOption } from './components/AgentGraph/AgentGraph';
import { ProjectPanel } from './components/ProjectPanel/ProjectPanel';
import { TheoremExplorer, type TheoremProjectFilterOption } from './components/TheoremList/TheoremExplorer';
import { VerifiedCodeViewer } from './components/TheoremList/VerifiedCodeViewer';
import { useI18n } from './i18n';

type AppView = 'dashboard' | 'community' | 'projects' | 'playground' | 'code' | 'admin' | 'my';
const CHAT_POPOVER_MIN_WIDTH = 360;
const CHAT_POPOVER_MIN_HEIGHT = 420;
const CHAT_POPOVER_DEFAULT_WIDTH = 420;
const CHAT_POPOVER_DEFAULT_HEIGHT = 620;
const CHAT_DOCK_MIN_WIDTH = 360;
const CHAT_DOCK_DEFAULT_WIDTH = 420;
const CHAT_DOCK_MAX_WIDTH = 560;
const CHAT_DOCK_MAX_VIEWPORT_RATIO = 0.42;
const CHAT_LAYOUT_BREAKPOINT = 1100;
const CHAT_LAYOUT_BUFFER = 72;
const CHAT_LAYOUT_MODE_STORAGE_KEY = 'shannon-manifold-chat-layout-mode';
const CHAT_DOCK_SIDE_STORAGE_KEY = 'shannon-manifold-chat-dock-side';
const CHAT_DOCK_WIDTH_STORAGE_KEY = 'shannon-manifold-chat-dock-width';
const CHAT_POPOVER_SIZE_STORAGE_KEY = 'shannon-manifold-chat-popover-size';

type ChatLayoutMode = 'floating' | 'docked';
type ChatDockSide = 'left' | 'right';

interface ChatPopoverSize {
  width: number;
  height: number;
}

interface DashboardProjectFilterOption {
  value: string;
  label: string;
}

interface CommunityRouteState {
  mode: 'home' | 'detail' | 'compose';
  postId: number | null;
}

interface PlaygroundSeed {
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

type PlaygroundSessionMetadata = Omit<PlaygroundSeed, 'code' | 'revision'>;

const getInitialView = (): AppView => {
  if (typeof window === 'undefined') {
    return 'dashboard';
  }

  const view = new URLSearchParams(window.location.search).get('view');
  if (
    view === 'community' ||
    view === 'projects' ||
    view === 'playground' ||
    view === 'code' ||
    view === 'admin' ||
    view === 'my'
  ) {
    return view;
  }

  if (new URLSearchParams(window.location.search).get('project')) {
    return 'playground';
  }

  return 'dashboard';
};

const getInitialDocumentId = (): number | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = new URLSearchParams(window.location.search).get('document');
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getInitialCommunityRoute = (): CommunityRouteState => {
  if (typeof window === 'undefined') {
    return { mode: 'home', postId: null };
  }

  const params = new URLSearchParams(window.location.search);
  const composeValue = params.get('communityCompose');
  if (composeValue) {
    if (composeValue === 'new') {
      return { mode: 'compose', postId: null };
    }
    const parsedComposeId = Number(composeValue);
    if (Number.isInteger(parsedComposeId) && parsedComposeId > 0) {
      return { mode: 'compose', postId: parsedComposeId };
    }
  }

  const detailValue = params.get('communityPost');
  if (detailValue) {
    const parsedDetailId = Number(detailValue);
    if (Number.isInteger(parsedDetailId) && parsedDetailId > 0) {
      return { mode: 'detail', postId: parsedDetailId };
    }
  }

  return { mode: 'home', postId: null };
};

const getInitialPlaygroundSeed = (): PlaygroundSeed | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const projectSlug = params.get('project')?.trim();
  if (!projectSlug) {
    return null;
  }

  const projectOwnerSlug = params.get('projectOwner')?.trim() || null;
  const projectFilePath = params.get('projectFile')?.trim() || null;
  return {
    code: '',
    revision: Date.now(),
    title: projectFilePath?.split('/').pop()?.replace(/\.lean$/i, '') || projectSlug,
    projectSlug,
    projectOwnerSlug,
    projectFilePath,
  };
};

const encodeLeanShareCode = (code: string) => {
  const bytes = new TextEncoder().encode(code);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window.btoa(binary);
};

const getInitialChatLayoutMode = (): ChatLayoutMode => {
  if (typeof window === 'undefined') {
    return 'floating';
  }

  const stored = window.localStorage.getItem(CHAT_LAYOUT_MODE_STORAGE_KEY);
  return stored === 'docked' ? 'docked' : 'floating';
};

const getInitialChatDockSide = (): ChatDockSide => {
  if (typeof window === 'undefined') {
    return 'right';
  }

  const stored = window.localStorage.getItem(CHAT_DOCK_SIDE_STORAGE_KEY);
  return stored === 'left' ? 'left' : 'right';
};

const clampChatDockWidth = (width: number, viewportWidth: number) => {
  const maxWidth = Math.max(
    CHAT_DOCK_MIN_WIDTH,
    Math.min(CHAT_DOCK_MAX_WIDTH, Math.floor(viewportWidth * CHAT_DOCK_MAX_VIEWPORT_RATIO)),
  );
  return Math.min(maxWidth, Math.max(CHAT_DOCK_MIN_WIDTH, width));
};

const getInitialChatDockWidth = () => {
  if (typeof window === 'undefined') {
    return CHAT_DOCK_DEFAULT_WIDTH;
  }

  const parsed = Number(window.localStorage.getItem(CHAT_DOCK_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(parsed)) {
    return CHAT_DOCK_DEFAULT_WIDTH;
  }
  return clampChatDockWidth(parsed, window.innerWidth);
};

const clampChatPopoverSize = (size: ChatPopoverSize) => {
  if (typeof window === 'undefined') {
    return size;
  }

  const maxWidth = Math.max(CHAT_POPOVER_MIN_WIDTH, window.innerWidth - 32);
  const maxHeight = Math.max(CHAT_POPOVER_MIN_HEIGHT, window.innerHeight - 128);
  return {
    width: Math.min(maxWidth, Math.max(CHAT_POPOVER_MIN_WIDTH, size.width)),
    height: Math.min(maxHeight, Math.max(CHAT_POPOVER_MIN_HEIGHT, size.height)),
  };
};

const getInitialChatPopoverSize = (): ChatPopoverSize | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(CHAT_POPOVER_SIZE_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ChatPopoverSize>;
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) {
      return null;
    }
    return clampChatPopoverSize({
      width: parsed.width as number,
      height: parsed.height as number,
    });
  } catch (_error) {
    return null;
  }
};

const getViewMinimumPrimaryWidth = (view: AppView) => {
  switch (view) {
    case 'playground':
      return 1100;
    case 'code':
      return 1080;
    case 'dashboard':
      return 980;
    case 'community':
      return 1020;
    case 'projects':
      return 940;
    case 'admin':
      return 1040;
    case 'my':
      return 980;
    default:
      return 960;
  }
};

function App() {
  const { language, setLanguage, t } = useI18n();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isBootstrappingSession, setIsBootstrappingSession] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>(() => getInitialView());
  const [communityRoute, setCommunityRoute] = useState<CommunityRouteState>(() =>
    getInitialCommunityRoute(),
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(() =>
    getInitialDocumentId(),
  );
  const [codeBackView, setCodeBackView] = useState<AppView>('dashboard');
  const [playgroundSeed, setPlaygroundSeed] = useState<PlaygroundSeed | null>(() =>
    getInitialPlaygroundSeed(),
  );
  const [projectPanelSelectedKey, setProjectPanelSelectedKey] = useState<string | null>(null);
  const [playgroundSessionMetadata, setPlaygroundSessionMetadata] = useState<PlaygroundSessionMetadata | null>(
    null,
  );
  const [playgroundLoaderVersion, setPlaygroundLoaderVersion] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [dashboardProjectFilter, setDashboardProjectFilter] = useState('all');
  const [theoremProjectOptions, setTheoremProjectOptions] = useState<TheoremProjectFilterOption[]>([]);
  const [graphProjectOptions, setGraphProjectOptions] = useState<GraphProjectFilterOption[]>([]);
  const [playgroundChatContext, setPlaygroundChatContext] = useState<ChatCodeContextPayload | null>(
    null,
  );
  const [playgroundChatAttachment, setPlaygroundChatAttachment] = useState<File | null>(null);
  const [chatLayoutMode, setChatLayoutMode] = useState<ChatLayoutMode>(() =>
    getInitialChatLayoutMode(),
  );
  const [chatDockSide, setChatDockSide] = useState<ChatDockSide>(() => getInitialChatDockSide());
  const [chatDockWidth, setChatDockWidth] = useState(() => getInitialChatDockWidth());
  const [chatPopoverSize, setChatPopoverSize] = useState<ChatPopoverSize | null>(() =>
    getInitialChatPopoverSize(),
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  const chatPopoverRef = useRef<HTMLDivElement>(null);
  const chatResizeStateRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const chatDockResizeStateRef = useRef<{
    startX: number;
    startWidth: number;
    dockSide: ChatDockSide;
  } | null>(null);

  const LazyLeanPlayground = useMemo(
    () =>
      lazy(async () => {
        const module = await import('./components/LeanPlayground/LeanPlayground');
        return {
          default: module.LeanPlayground,
        };
      }),
    [playgroundLoaderVersion],
  );

  const dashboardProjectOptions = useMemo<DashboardProjectFilterOption[]>(() => {
    const optionMap = new Map<string, DashboardProjectFilterOption>();
    for (const option of [...theoremProjectOptions, ...graphProjectOptions]) {
      if (!optionMap.has(option.value)) {
        optionMap.set(option.value, {
          value: option.value,
          label: option.label,
        });
      }
    }
    return [...optionMap.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [graphProjectOptions, theoremProjectOptions]);

  useEffect(() => {
    if (dashboardProjectFilter === 'all' || dashboardProjectFilter === 'shared') {
      return;
    }
    if (!dashboardProjectOptions.some((option) => option.value === dashboardProjectFilter)) {
      setDashboardProjectFilter('all');
    }
  }, [dashboardProjectFilter, dashboardProjectOptions]);

  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      if (!hasStoredToken()) {
        if (isMounted) {
          setIsBootstrappingSession(false);
        }
        return;
      }

      try {
        const user = await getCurrentUser();
        if (isMounted) {
          setCurrentUser(user);
        }
      } catch (error) {
        console.error('Session restore failed:', error);
        setAuthToken(null);
      } finally {
        if (isMounted) {
          setIsBootstrappingSession(false);
        }
      }
    };

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('view', currentView);

    if (currentView === 'playground' && playgroundSeed?.projectSlug) {
      url.searchParams.set('project', playgroundSeed.projectSlug);
      if (playgroundSeed.projectOwnerSlug) {
        url.searchParams.set('projectOwner', playgroundSeed.projectOwnerSlug);
      } else {
        url.searchParams.delete('projectOwner');
      }
      if (playgroundSeed.projectFilePath) {
        url.searchParams.set('projectFile', playgroundSeed.projectFilePath);
      } else {
        url.searchParams.delete('projectFile');
      }
      url.searchParams.delete('leanCode');
      url.searchParams.delete('leanTitle');
    } else if (currentView === 'playground' && playgroundSeed?.code) {
      url.searchParams.set('leanCode', encodeLeanShareCode(playgroundSeed.code));
      url.searchParams.set('leanTitle', playgroundSeed.title);
      url.searchParams.delete('project');
      url.searchParams.delete('projectOwner');
      url.searchParams.delete('projectFile');
    } else {
      url.searchParams.delete('leanCode');
      url.searchParams.delete('leanTitle');
      url.searchParams.delete('project');
      url.searchParams.delete('projectOwner');
      url.searchParams.delete('projectFile');
    }

    if (currentView === 'code' && selectedDocumentId) {
      url.searchParams.set('document', String(selectedDocumentId));
    } else {
      url.searchParams.delete('document');
    }

    if (currentView === 'community') {
      if (communityRoute.mode === 'detail' && communityRoute.postId) {
        url.searchParams.set('communityPost', String(communityRoute.postId));
        url.searchParams.delete('communityCompose');
      } else if (communityRoute.mode === 'compose') {
        url.searchParams.set('communityCompose', communityRoute.postId ? String(communityRoute.postId) : 'new');
        url.searchParams.delete('communityPost');
      } else {
        url.searchParams.delete('communityPost');
        url.searchParams.delete('communityCompose');
      }
    } else {
      url.searchParams.delete('communityPost');
      url.searchParams.delete('communityCompose');
    }

    window.history.replaceState({}, '', url);
  }, [communityRoute, currentView, playgroundSeed, selectedDocumentId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CHAT_LAYOUT_MODE_STORAGE_KEY, chatLayoutMode);
  }, [chatLayoutMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CHAT_DOCK_SIDE_STORAGE_KEY, chatDockSide);
  }, [chatDockSide]);

  useEffect(() => {
    const nextWidth = clampChatDockWidth(chatDockWidth, viewportWidth);
    if (nextWidth !== chatDockWidth) {
      setChatDockWidth(nextWidth);
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CHAT_DOCK_WIDTH_STORAGE_KEY, String(nextWidth));
  }, [chatDockWidth, viewportWidth]);

  useEffect(() => {
    if (!chatPopoverSize) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(CHAT_POPOVER_SIZE_STORAGE_KEY);
      }
      return;
    }

    const nextSize = clampChatPopoverSize(chatPopoverSize);
    if (
      nextSize.width !== chatPopoverSize.width ||
      nextSize.height !== chatPopoverSize.height
    ) {
      setChatPopoverSize(nextSize);
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CHAT_POPOVER_SIZE_STORAGE_KEY, JSON.stringify(nextSize));
  }, [chatPopoverSize]);

  const effectiveChatDockWidth = useMemo(
    () => clampChatDockWidth(chatDockWidth, viewportWidth),
    [chatDockWidth, viewportWidth],
  );

  const isChatForcedFloating =
    chatLayoutMode === 'docked' &&
    (viewportWidth <= CHAT_LAYOUT_BREAKPOINT ||
      viewportWidth <
        getViewMinimumPrimaryWidth(currentView) + effectiveChatDockWidth + CHAT_LAYOUT_BUFFER);

  const isChatDockActive = chatLayoutMode === 'docked' && !isChatForcedFloating;
  const isChatFloatingActive = !isChatDockActive;

  const handleAuthenticated = (payload: AuthResponse) => {
    setAuthToken(payload.access_token);
    setCurrentUser(payload.user);
    setIsAuthOpen(false);
    setIsBootstrappingSession(false);
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    if (currentView === 'admin' || currentView === 'my') {
      setCurrentView('dashboard');
    }
  };

  const handleUserUpdated = (user: AuthUser) => {
    setCurrentUser(user);
    if (currentView === 'admin' && !user.is_admin) {
      setCurrentView('my');
    }
  };

  const openLeanPlayground = (seed?: {
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
  }) => {
    if (seed?.code || seed?.projectSlug) {
      setPlaygroundSeed({
        code: seed.code ?? '',
        revision: Date.now(),
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
      });
      setPlaygroundSessionMetadata({
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
      });
    } else {
      setPlaygroundSeed(null);
      setPlaygroundSessionMetadata(null);
    }

    setCurrentView('playground');
  };

  const openVerifiedCode = (documentId: number) => {
    setCodeBackView(currentView);
    setSelectedDocumentId(documentId);
    setCurrentView('code');
  };

  const openCommunityHome = () => {
    setCommunityRoute({ mode: 'home', postId: null });
    setCurrentView('community');
  };

  const openCommunityPost = (postId: number) => {
    setCommunityRoute({ mode: 'detail', postId });
    setCurrentView('community');
  };

  const openCommunityComposer = (postId?: number | null) => {
    setCommunityRoute({ mode: 'compose', postId: postId ?? null });
    setCurrentView('community');
  };

  const openProjectDetail = (ownerSlug: string, projectSlug: string) => {
    setProjectPanelSelectedKey(`${ownerSlug}:${projectSlug}`);
    setCurrentView('projects');
  };

  const handleRetryPlayground = () => {
    setPlaygroundLoaderVersion((current) => current + 1);
    setCurrentView('playground');
  };

  const handleApplyChatSuggestedCode = (payload: { code: string; title: string }) => {
    if (currentView === 'playground' && (playgroundSessionMetadata || playgroundSeed)) {
      const metadata = playgroundSessionMetadata ?? playgroundSeed;
      if (!metadata) {
        return;
      }
      openLeanPlayground({
        code: payload.code,
        title: payload.title,
        proofWorkspaceId: metadata.proofWorkspaceId ?? null,
        pdfFilename: metadata.pdfFilename ?? null,
        linkedPdfFilename: metadata.linkedPdfFilename ?? null,
        linkedPdfPreviewUrl: metadata.linkedPdfPreviewUrl ?? null,
        linkedPdfDownloadUrl: metadata.linkedPdfDownloadUrl ?? null,
        projectSlug: metadata.projectSlug ?? null,
        projectOwnerSlug: metadata.projectOwnerSlug ?? null,
        projectTitle: metadata.projectTitle ?? null,
        projectRoot: metadata.projectRoot ?? null,
        packageName: metadata.packageName ?? null,
        projectGithubUrl: metadata.projectGithubUrl ?? null,
        projectVisibility: metadata.projectVisibility ?? null,
        projectCanEdit: metadata.projectCanEdit ?? null,
        projectFilePath: metadata.projectFilePath ?? null,
        projectModuleName: metadata.projectModuleName ?? null,
        projectEntryFilePath: metadata.projectEntryFilePath ?? null,
        projectEntryModuleName: metadata.projectEntryModuleName ?? null,
      });
      return;
    }

    openLeanPlayground({
      code: payload.code,
      title: payload.title,
    });
  };

  const handleChatLayoutModeChange = (nextMode: ChatLayoutMode, nextSide?: ChatDockSide) => {
    setChatLayoutMode(nextMode);
    if (nextSide) {
      setChatDockSide(nextSide);
    }
    setIsChatOpen(true);
  };

  const handleChatPopoverResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    const popover = chatPopoverRef.current;
    if (!popover) {
      return;
    }

    const rect = popover.getBoundingClientRect();
    chatResizeStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = chatResizeStateRef.current;
      if (!state) {
        return;
      }

      const maxWidth = Math.max(CHAT_POPOVER_MIN_WIDTH, window.innerWidth - 32);
      const maxHeight = Math.max(CHAT_POPOVER_MIN_HEIGHT, window.innerHeight - 128);
      const nextWidth = Math.min(
        maxWidth,
        Math.max(CHAT_POPOVER_MIN_WIDTH, state.startWidth - (moveEvent.clientX - state.startX)),
      );
      const nextHeight = Math.min(
        maxHeight,
        Math.max(CHAT_POPOVER_MIN_HEIGHT, state.startHeight - (moveEvent.clientY - state.startY)),
      );

      setChatPopoverSize({
        width: nextWidth,
        height: nextHeight,
      });
    };

    const handlePointerUp = () => {
      chatResizeStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleChatDockResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = chatPopoverRef.current;
    if (!panel) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    chatDockResizeStateRef.current = {
      startX: event.clientX,
      startWidth: rect.width,
      dockSide: chatDockSide,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = chatDockResizeStateRef.current;
      if (!state) {
        return;
      }

      const deltaX = moveEvent.clientX - state.startX;
      const nextWidth =
        state.dockSide === 'right'
          ? state.startWidth - deltaX
          : state.startWidth + deltaX;

      setChatDockWidth(clampChatDockWidth(nextWidth, window.innerWidth));
    };

    const handlePointerUp = () => {
      chatDockResizeStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const renderPlaygroundFallback = (errorMessage?: string | null) => (
    <div className="screen-fallback-card glass-panel">
      <div className="screen-fallback-title">{t('Lean Playground is unavailable.')}</div>
      <p className="screen-fallback-copy">
        {t(
          'The main dashboard is still available. Reload the page or return to the dashboard while the Lean runtime initializes.',
        )}
      </p>
      {errorMessage && <div className="auth-error">{errorMessage}</div>}
      <div className="screen-fallback-actions">
        <button type="button" className="button-secondary" onClick={() => setCurrentView('dashboard')}>
          {t('Back to Dashboard')}
        </button>
        <button type="button" className="button-primary" onClick={handleRetryPlayground}>
          {t('Retry Playground')}
        </button>
      </div>
    </div>
  );

  const chatPanelClassName = [
    'chat-panel-shell',
    'glass-panel',
    isChatOpen ? 'is-open' : '',
    isChatDockActive ? 'is-docked' : 'is-floating',
    chatDockSide === 'left' ? 'is-dock-left' : 'is-dock-right',
    isChatForcedFloating ? 'is-forced-floating' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const chatPanelStyle = isChatDockActive
    ? ({
        '--chat-dock-width': `${effectiveChatDockWidth}px`,
      } as CSSProperties)
    : ({
        '--chat-floating-width': `${chatPopoverSize?.width ?? CHAT_POPOVER_DEFAULT_WIDTH}px`,
        '--chat-floating-height': `${chatPopoverSize?.height ?? CHAT_POPOVER_DEFAULT_HEIGHT}px`,
      } as CSSProperties);

  const chatLauncherStyle =
    isChatOpen && isChatDockActive && chatDockSide === 'right'
      ? ({
          right: `${effectiveChatDockWidth + 32}px`,
        } as CSSProperties)
      : undefined;

  return (
    <div className="layout">
      <header className="header" style={{ height: '72px' }}>
        <button
          type="button"
          onClick={() => setCurrentView('dashboard')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          <Microscope className="text-accent" size={32} color="var(--accent-color)" />
          <h1>Shannon Manifold</h1>
        </button>
        <div className="header-actions">
          {currentUser?.is_admin && (
            <button
              className={`nav-pill ${currentView === 'admin' ? 'is-active' : ''}`}
              onClick={() => setCurrentView('admin')}
            >
              {t('Admin')}
            </button>
          )}
          <button
            className={`nav-pill ${currentView === 'community' ? 'is-active' : ''}`}
            onClick={openCommunityHome}
          >
            {t('Community')}
          </button>
          <button
            className={`nav-pill ${currentView === 'projects' ? 'is-active' : ''}`}
            onClick={() => {
              setProjectPanelSelectedKey(null);
              setCurrentView('projects');
            }}
          >
            {t('Projects')}
          </button>
          <button
            className={`nav-pill ${currentView === 'playground' ? 'is-active' : ''}`}
            onClick={() => openLeanPlayground()}
          >
            {t('Lean Playground')}
          </button>
          {currentView !== 'dashboard' && (
            <button className="button-secondary" onClick={() => setCurrentView('dashboard')}>
              <ArrowLeft size={16} />
              {t('Main Page')}
            </button>
          )}
          <div className="language-switcher" role="group" aria-label="Language setting">
            <button
              type="button"
              className={`language-pill ${language === 'en' ? 'is-active' : ''}`}
              onClick={() => setLanguage('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={`language-pill ${language === 'ko' ? 'is-active' : ''}`}
              onClick={() => setLanguage('ko')}
            >
              한국어
            </button>
          </div>
          {currentUser ? (
            <>
              <button
                type="button"
                className={`user-chip user-chip-button ${currentView === 'my' ? 'is-active' : ''}`}
                onClick={() => setCurrentView('my')}
              >
                <ShieldCheck size={16} color="var(--secondary-accent)" />
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {currentUser.full_name}
                    {currentUser.is_admin ? ` · ${t('Admin')}` : ''}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {currentUser.email}
                  </div>
                </div>
              </button>
              <button className="button-secondary" onClick={handleLogout}>
                <LogOut size={16} />
                {t('Logout')}
              </button>
            </>
          ) : (
            <button className="button-secondary" onClick={() => setIsAuthOpen(true)}>
              {isBootstrappingSession ? t('Checking session...') : t('Login / Register')}
            </button>
          )}
        </div>
      </header>

      <main
        className={`main-content ${isChatDockActive && isChatOpen ? 'has-chat-dock' : ''} ${
          isChatDockActive && isChatOpen && chatDockSide === 'left' ? 'is-chat-dock-left' : ''
        } ${isChatDockActive && isChatOpen && chatDockSide === 'right' ? 'is-chat-dock-right' : ''}`}
        style={{ height: 'calc(100vh - 72px)' }}
      >
        <div className="app-primary-pane">
          {currentView === 'dashboard' ? (
            <section className="dashboard-screen">
              <div className="glass-panel dashboard-filter-bar">
                <div className="dashboard-filter-copy">
                  <div className="dashboard-filter-title">{t('Unified Project Filter')}</div>
                  <div className="dashboard-filter-subtitle">
                    {t(
                      'The selected project scope applies to both Verified Database and Lean Import Manifold.',
                    )}
                  </div>
                </div>
                <label className="dashboard-filter-control">
                  <span>{t('Project Scope')}</span>
                  <select
                    className="input-field dashboard-filter-select"
                    value={dashboardProjectFilter}
                    onChange={(event) => setDashboardProjectFilter(event.target.value)}
                  >
                    <option value="all">{t('All Projects')}</option>
                    <option value="shared">{t('Shared / No Project')}</option>
                    {dashboardProjectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <section className="dashboard-columns">
                <aside className="glass-panel dashboard-database-panel">
                  <TheoremExplorer
                    currentUser={currentUser}
                    onOpenProof={openVerifiedCode}
                    projectFilter={dashboardProjectFilter}
                    onProjectFilterChange={setDashboardProjectFilter}
                    onProjectOptionsChange={setTheoremProjectOptions}
                    hideProjectFilter
                  />
                </aside>

                <section className="dashboard-main-panel">
                  <div
                    className="glass-panel"
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        zIndex: 10,
                        padding: '20px',
                        pointerEvents: 'none',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '16px',
                          width: '100%',
                        }}
                      >
                        <div>
                          <h2 style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
                            {t('Lean Import Manifold')}
                          </h2>
                          <p
                            style={{
                              color: 'rgba(255,255,255,0.7)',
                              fontSize: '0.9rem',
                              marginTop: '4px',
                              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                            }}
                          >
                            {t(
                              'Visualized import relationships across verified user-uploaded Lean modules. Refresh when you want a new snapshot.',
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="button-secondary"
                          style={{ pointerEvents: 'auto' }}
                          onClick={() => setGraphRefreshKey((current) => current + 1)}
                        >
                          <RefreshCw size={16} />
                          {t('Refresh')}
                        </button>
                      </div>
                    </div>
                    <AgentGraph
                      refreshKey={graphRefreshKey}
                      onOpenProof={openVerifiedCode}
                      projectFilter={dashboardProjectFilter}
                      onProjectFilterChange={setDashboardProjectFilter}
                      onProjectOptionsChange={setGraphProjectOptions}
                      hideProjectFilter
                    />
                  </div>
                </section>
              </section>
            </section>
          ) : currentView === 'community' ? (
            communityRoute.mode === 'compose' ? (
              <CommunityComposer
                currentUser={currentUser}
                onOpenAuth={() => setIsAuthOpen(true)}
                postId={communityRoute.postId}
                onCancel={openCommunityHome}
                onSaved={openCommunityPost}
              />
            ) : communityRoute.mode === 'detail' && communityRoute.postId ? (
              <CommunityPostDetail
                postId={communityRoute.postId}
                currentUser={currentUser}
                onOpenAuth={() => setIsAuthOpen(true)}
                onBack={openCommunityHome}
                onOpenProof={openVerifiedCode}
                onOpenProject={openProjectDetail}
                onEditPost={openCommunityComposer}
                onDeleted={openCommunityHome}
              />
            ) : (
              <CommunityHome
                currentUser={currentUser}
                onOpenAuth={() => setIsAuthOpen(true)}
                onOpenPost={openCommunityPost}
                onCompose={() => {
                  if (!currentUser) {
                    setIsAuthOpen(true);
                    return;
                  }
                  openCommunityComposer();
                }}
              />
            )
          ) : currentView === 'projects' ? (
            <ProjectPanel
              variant="page"
              currentUser={currentUser}
              onOpenAuth={() => setIsAuthOpen(true)}
              initialSelectedProjectKey={projectPanelSelectedKey}
            />
          ) : currentView === 'my' ? (
            <MyPage
              currentUser={currentUser}
              onOpenAuth={() => setIsAuthOpen(true)}
              onOpenProof={openVerifiedCode}
              onOpenProject={openProjectDetail}
              onUserUpdated={handleUserUpdated}
            />
          ) : currentView === 'admin' ? (
            <AdminPage
              currentUser={currentUser}
              onOpenAuth={() => setIsAuthOpen(true)}
              onUserUpdated={handleUserUpdated}
            />
          ) : currentView === 'code' ? (
            selectedDocumentId ? (
              <VerifiedCodeViewer
                currentUser={currentUser}
                documentId={selectedDocumentId}
                onBack={() => setCurrentView(codeBackView)}
                onOpenAuth={() => setIsAuthOpen(true)}
                onOpenPlayground={openLeanPlayground}
              />
            ) : (
              <section className="verified-code-screen glass-panel">
                <div className="theorem-empty-state">
                  {t('Select a verified code entry from the dashboard.')}
                </div>
              </section>
            )
          ) : (
            <section className="playground-screen">
              <RecoverableErrorBoundary
                fallback={renderPlaygroundFallback}
                resetKey={`playground-${playgroundLoaderVersion}-${playgroundSeed?.revision ?? 0}`}
              >
                <Suspense fallback={renderPlaygroundFallback()}>
                  <LazyLeanPlayground
                    seed={playgroundSeed}
                    currentUser={currentUser}
                    onOpenAuth={() => setIsAuthOpen(true)}
                    onLogout={handleLogout}
                    onSessionMetadataChange={setPlaygroundSessionMetadata}
                    onDocumentChange={setPlaygroundChatContext}
                    onAttachmentChange={setPlaygroundChatAttachment}
                  />
                </Suspense>
              </RecoverableErrorBoundary>
            </section>
          )}
        </div>

        <div ref={chatPopoverRef} className={chatPanelClassName} style={chatPanelStyle}>
          {isChatFloatingActive ? (
            <div
              className="chat-panel-resize-handle is-floating"
              onPointerDown={handleChatPopoverResizeStart}
              aria-hidden="true"
            />
          ) : (
            <div
              className={`chat-panel-resize-handle is-docked ${chatDockSide === 'left' ? 'is-right-edge' : 'is-left-edge'}`}
              onPointerDown={handleChatDockResizeStart}
              aria-hidden="true"
            />
          )}
          <div className="chat-panel-header">
            <div className="chat-panel-title-block">
              <div className="chat-panel-title-row">
                <div className="chat-panel-title">{t('Theorem Oracle')}</div>
                <span className="chat-panel-mode-badge">
                  {t(isChatFloatingActive ? 'Floating' : 'Docked')}
                </span>
              </div>
              <div className="chat-panel-subtitle">
                {currentUser
                  ? t('Signed in as {name}', { name: currentUser.full_name })
                  : t('Sign in to ask questions about Lean4, Rocq, and proofs.')}
              </div>
            </div>
            <div className="chat-panel-header-actions">
              <div className="chat-layout-toggle" role="group" aria-label={t('Theorem Oracle')}>
                <button
                  type="button"
                  className={`chat-layout-toggle-button ${chatLayoutMode === 'floating' ? 'is-active' : ''}`}
                  onClick={() => handleChatLayoutModeChange('floating')}
                  aria-label={t('Switch to floating chat')}
                >
                  {t('Floating')}
                </button>
                <button
                  type="button"
                  className={`chat-layout-toggle-button ${chatLayoutMode === 'docked' && chatDockSide === 'left' ? 'is-active' : ''}`}
                  onClick={() => handleChatLayoutModeChange('docked', 'left')}
                  aria-label={t('Dock left')}
                >
                  {t('Dock left')}
                </button>
                <button
                  type="button"
                  className={`chat-layout-toggle-button ${chatLayoutMode === 'docked' && chatDockSide === 'right' ? 'is-active' : ''}`}
                  onClick={() => handleChatLayoutModeChange('docked', 'right')}
                  aria-label={t('Dock right')}
                >
                  {t('Dock right')}
                </button>
              </div>
              <button
                type="button"
                className="chat-panel-close"
                onClick={() => setIsChatOpen(false)}
                aria-label={t('Close chatbot')}
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="chat-panel-body">
            <Chatbot
              currentUser={currentUser}
              onOpenAuth={() => setIsAuthOpen(true)}
              onLogout={handleLogout}
              codeContext={currentView === 'playground' ? playgroundChatContext : null}
              defaultAttachmentFile={
                currentView === 'playground' ? playgroundChatAttachment : null
              }
              onApplySuggestedCode={handleApplyChatSuggestedCode}
            />
          </div>
        </div>
      </main>

      <button
        type="button"
        className={`chat-launcher ${isChatOpen ? 'is-open' : ''}`}
        onClick={() => setIsChatOpen((current) => !current)}
        style={chatLauncherStyle}
        aria-label={isChatOpen ? t('Close chatbot') : t('Open chatbot')}
      >
        {isChatOpen ? <X size={22} /> : <Bot size={22} />}
      </button>

      <AuthPanel
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  );
}

export default App;
