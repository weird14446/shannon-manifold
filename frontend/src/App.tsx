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
} from './api';
import { AuthPanel } from './components/Auth/AuthPanel';
import { Chatbot } from './components/Chatbot/Chatbot';
import { RecoverableErrorBoundary } from './components/ErrorBoundary/RecoverableErrorBoundary';
import { AgentGraph } from './components/AgentGraph/AgentGraph';
import { TheoremExplorer } from './components/TheoremList/TheoremExplorer';
import { VerifiedCodeViewer } from './components/TheoremList/VerifiedCodeViewer';

type AppView = 'dashboard' | 'playground' | 'code';
const CHAT_POPOVER_MIN_WIDTH = 360;
const CHAT_POPOVER_MIN_HEIGHT = 420;

interface ChatPopoverSize {
  width: number;
  height: number;
}

interface PlaygroundSeed {
  code: string;
  revision: number;
  title: string;
  proofWorkspaceId?: number | null;
  pdfFilename?: string | null;
}

const getInitialView = (): AppView => {
  if (typeof window === 'undefined') {
    return 'dashboard';
  }

  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'playground' || view === 'code') {
    return view;
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
  const [playgroundSeed, setPlaygroundSeed] = useState<PlaygroundSeed | null>(null);
  const [playgroundLoaderVersion, setPlaygroundLoaderVersion] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
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

    if (currentView === 'playground' && playgroundSeed?.code) {
      url.searchParams.set('leanCode', encodeLeanShareCode(playgroundSeed.code));
      url.searchParams.set('leanTitle', playgroundSeed.title);
    } else {
      url.searchParams.delete('leanCode');
      url.searchParams.delete('leanTitle');
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
  };

  const openLeanPlayground = (seed?: {
    code: string;
    title: string;
    proofWorkspaceId?: number | null;
    pdfFilename?: string | null;
  }) => {
    if (seed?.code) {
      setPlaygroundSeed({
        code: seed.code,
        revision: Date.now(),
        title: seed.title,
        proofWorkspaceId: seed.proofWorkspaceId ?? null,
        pdfFilename: seed.pdfFilename ?? null,
      });
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

  const handlePlaygroundPushSuccess = () => {
    setCurrentView('dashboard');
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
          <button
            className={`nav-pill ${currentView === 'playground' ? 'is-active' : ''}`}
            onClick={() => openLeanPlayground()}
          >
            Lean Playground
          </button>
          {(currentView === 'playground' || currentView === 'code') && (
            <button className="button-secondary" onClick={() => setCurrentView('dashboard')}>
              <ArrowLeft size={16} />
              Main Page
            </button>
          )}
          {currentUser ? (
            <>
              <div className="user-chip">
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
              </div>
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
          <section className="dashboard-columns">
            <aside className="glass-panel dashboard-database-panel">
              <TheoremExplorer
                currentUser={currentUser}
                onOpenProof={openVerifiedCode}
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
                />
              </div>
            </section>
          </section>
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
                  onPushSuccess={handlePlaygroundPushSuccess}
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
