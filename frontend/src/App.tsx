import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, LogOut, Microscope, RefreshCw, ShieldCheck, X } from 'lucide-react';
import './index.css';

import {
  type ChatCodeContextPayload,
  getCurrentUser,
  hasStoredToken,
  setAuthToken,
  type AuthResponse,
  type AuthUser,
  type ProjectOpenResponse,
} from './api';
import { AdminPage } from './components/Admin/AdminPage';
import { AuthPanel } from './components/Auth/AuthPanel';
import { Chatbot } from './components/Chatbot/Chatbot';
import { RecoverableErrorBoundary } from './components/ErrorBoundary/RecoverableErrorBoundary';
import { MyPage } from './components/MyPage/MyPage';
import { AgentGraph, type GraphProjectFilterOption } from './components/AgentGraph/AgentGraph';
import { ProjectPanel } from './components/ProjectPanel/ProjectPanel';
import { TheoremExplorer, type TheoremProjectFilterOption } from './components/TheoremList/TheoremExplorer';
import { VerifiedCodeViewer } from './components/TheoremList/VerifiedCodeViewer';

type AppView = 'dashboard' | 'projects' | 'playground' | 'code' | 'admin' | 'my';
const CHAT_POPOVER_MIN_WIDTH = 360;
const CHAT_POPOVER_MIN_HEIGHT = 420;

interface ChatPopoverSize {
  width: number;
  height: number;
}

interface DashboardProjectFilterOption {
  value: string;
  label: string;
}

interface PlaygroundSeed {
  code: string;
  revision: number;
  title: string;
  proofWorkspaceId?: number | null;
  pdfFilename?: string | null;
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

const getInitialView = (): AppView => {
  if (typeof window === 'undefined') {
    return 'dashboard';
  }

  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'projects' || view === 'playground' || view === 'code' || view === 'admin' || view === 'my') {
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

function App() {
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isBootstrappingSession, setIsBootstrappingSession] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>(() => getInitialView());
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(() =>
    getInitialDocumentId(),
  );
  const [playgroundSeed, setPlaygroundSeed] = useState<PlaygroundSeed | null>(() =>
    getInitialPlaygroundSeed(),
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
  const [chatPopoverSize, setChatPopoverSize] = useState<ChatPopoverSize | null>(null);
  const chatPopoverRef = useRef<HTMLDivElement>(null);
  const chatResizeStateRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
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

    window.history.replaceState({}, '', url);
  }, [currentView, playgroundSeed, selectedDocumentId]);

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
    }

    setCurrentView('playground');
  };

  const openVerifiedCode = (documentId: number) => {
    setSelectedDocumentId(documentId);
    setCurrentView('code');
  };

  const handleRetryPlayground = () => {
    setPlaygroundLoaderVersion((current) => current + 1);
    setCurrentView('playground');
  };

  const handleApplyChatSuggestedCode = (payload: { code: string; title: string }) => {
    openLeanPlayground({
      code: payload.code,
      title: payload.title,
    });
  };

  const handleOpenProject = (project: ProjectOpenResponse) => {
    openLeanPlayground({
      code: project.content,
      title: project.workspace_title,
      projectSlug: project.slug,
      projectOwnerSlug: project.owner_slug,
      projectTitle: project.title,
      projectRoot: project.project_root,
      packageName: project.package_name,
      projectGithubUrl: project.github_url,
      projectVisibility: project.visibility,
      projectCanEdit: project.can_edit,
      projectFilePath: project.workspace_file_path,
      projectModuleName: project.workspace_module_name,
      projectEntryFilePath: project.entry_file_path,
      projectEntryModuleName: project.entry_module_name,
    });
  };

  const handleChatResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
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

  const renderPlaygroundFallback = (errorMessage?: string | null) => (
    <div className="screen-fallback-card glass-panel">
      <div className="screen-fallback-title">Lean Playground is unavailable.</div>
      <p className="screen-fallback-copy">
        The main dashboard is still available. Reload the page or return to the dashboard while
        the Lean runtime initializes.
      </p>
      {errorMessage && <div className="auth-error">{errorMessage}</div>}
      <div className="screen-fallback-actions">
        <button type="button" className="button-secondary" onClick={() => setCurrentView('dashboard')}>
          Back to Dashboard
        </button>
        <button type="button" className="button-primary" onClick={handleRetryPlayground}>
          Retry Playground
        </button>
      </div>
    </div>
  );

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
              Admin
            </button>
          )}
          <button
            className={`nav-pill ${currentView === 'projects' ? 'is-active' : ''}`}
            onClick={() => setCurrentView('projects')}
          >
            Projects
          </button>
          <button
            className={`nav-pill ${currentView === 'playground' ? 'is-active' : ''}`}
            onClick={() => openLeanPlayground()}
          >
            Lean Playground
          </button>
          {currentView !== 'dashboard' && (
            <button className="button-secondary" onClick={() => setCurrentView('dashboard')}>
              <ArrowLeft size={16} />
              Main Page
            </button>
          )}
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
                    {currentUser.is_admin ? ' · Admin' : ''}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {currentUser.email}
                  </div>
                </div>
              </button>
              <button className="button-secondary" onClick={handleLogout}>
                <LogOut size={16} />
                Logout
              </button>
            </>
          ) : (
            <button className="button-secondary" onClick={() => setIsAuthOpen(true)}>
              {isBootstrappingSession ? 'Checking session...' : 'Login / Register'}
            </button>
          )}
        </div>
      </header>

      <main className="main-content" style={{ height: 'calc(100vh - 72px)' }}>
        {currentView === 'dashboard' ? (
          <section className="dashboard-screen">
            <div className="glass-panel dashboard-filter-bar">
              <div className="dashboard-filter-copy">
                <div className="dashboard-filter-title">Unified Project Filter</div>
                <div className="dashboard-filter-subtitle">
                  The selected project scope applies to both Verified Database and Lean Import Manifold.
                </div>
              </div>
              <label className="dashboard-filter-control">
                <span>Project Scope</span>
                <select
                  className="input-field dashboard-filter-select"
                  value={dashboardProjectFilter}
                  onChange={(event) => setDashboardProjectFilter(event.target.value)}
                >
                  <option value="all">All Projects</option>
                  <option value="shared">Shared / No Project</option>
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
                          Lean Import Manifold
                        </h2>
                        <p
                          style={{
                            color: 'rgba(255,255,255,0.7)',
                            fontSize: '0.9rem',
                            marginTop: '4px',
                            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                          }}
                        >
                          Visualized import relationships across verified user-uploaded Lean
                          modules. Refresh when you want a new snapshot.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="button-secondary"
                        style={{ pointerEvents: 'auto' }}
                        onClick={() => setGraphRefreshKey((current) => current + 1)}
                      >
                        <RefreshCw size={16} />
                        Refresh
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
        ) : currentView === 'projects' ? (
          <ProjectPanel
            variant="page"
            currentUser={currentUser}
            onOpenAuth={() => setIsAuthOpen(true)}
          />
        ) : currentView === 'my' ? (
          <MyPage
            currentUser={currentUser}
            onOpenAuth={() => setIsAuthOpen(true)}
            onOpenProof={openVerifiedCode}
            onOpenProject={handleOpenProject}
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
              onBack={() => setCurrentView('dashboard')}
              onOpenAuth={() => setIsAuthOpen(true)}
              onOpenPlayground={openLeanPlayground}
            />
          ) : (
            <section className="verified-code-screen glass-panel">
              <div className="theorem-empty-state">Select a verified code entry from the dashboard.</div>
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
                  onDocumentChange={setPlaygroundChatContext}
                  onAttachmentChange={setPlaygroundChatAttachment}
                />
              </Suspense>
            </RecoverableErrorBoundary>
          </section>
        )}
      </main>

      <div
        ref={chatPopoverRef}
        className={`chat-popover glass-panel ${isChatOpen ? 'is-open' : ''}`}
        style={
          chatPopoverSize
            ? {
                width: `${chatPopoverSize.width}px`,
                height: `${chatPopoverSize.height}px`,
              }
            : undefined
        }
      >
        <div
          className="chat-popover-resize-handle"
          onPointerDown={handleChatResizeStart}
          aria-hidden="true"
        />
        <div className="chat-popover-header">
          <div>
            <div className="chat-popover-title">Theorem Oracle</div>
            <div className="chat-popover-subtitle">
              {currentUser
                ? `Signed in as ${currentUser.full_name}`
                : 'Sign in to ask questions about Lean4, Rocq, and proofs.'}
            </div>
          </div>
          <button
            type="button"
            className="chat-popover-close"
            onClick={() => setIsChatOpen(false)}
            aria-label="Close chatbot"
          >
            <X size={18} />
          </button>
        </div>
        <div className="chat-popover-body">
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

      <button
        type="button"
        className={`chat-launcher ${isChatOpen ? 'is-open' : ''}`}
        onClick={() => setIsChatOpen((current) => !current)}
        aria-label={isChatOpen ? 'Close chatbot' : 'Open chatbot'}
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
