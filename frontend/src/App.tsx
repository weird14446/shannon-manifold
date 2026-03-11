import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, Bot, FileUp, LogOut, Microscope, ShieldCheck, X } from 'lucide-react';
import './index.css';

import {
  getCurrentUser,
  hasStoredToken,
  setAuthToken,
  uploadProofPdf,
  type AuthResponse,
  type AuthUser,
} from './api';
import { AuthPanel } from './components/Auth/AuthPanel';
import { Chatbot } from './components/Chatbot/Chatbot';
import { RecoverableErrorBoundary } from './components/ErrorBoundary/RecoverableErrorBoundary';
import { AgentGraph } from './components/AgentGraph/AgentGraph';
import { TheoremExplorer } from './components/TheoremList/TheoremExplorer';

type AppView = 'dashboard' | 'playground';

interface PlaygroundSeed {
  code: string;
  revision: number;
  title: string;
}

const getInitialView = (): AppView => {
  if (typeof window === 'undefined') {
    return 'dashboard';
  }

  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'playground') {
    return view;
  }

  return 'dashboard';
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
  const [playgroundSeed, setPlaygroundSeed] = useState<PlaygroundSeed | null>(null);
  const [playgroundLoaderVersion, setPlaygroundLoaderVersion] = useState(0);
  const [shouldOpenUploadAfterAuth, setShouldOpenUploadAfterAuth] = useState(false);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const proofUploadInputRef = useRef<HTMLInputElement>(null);

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
    if (!currentUser || !shouldOpenUploadAfterAuth) {
      return;
    }

    proofUploadInputRef.current?.click();
    setShouldOpenUploadAfterAuth(false);
  }, [currentUser, shouldOpenUploadAfterAuth]);

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

    window.history.replaceState({}, '', url);
  }, [currentView, playgroundSeed]);

  const handleAuthenticated = (payload: AuthResponse) => {
    setAuthToken(payload.access_token);
    setCurrentUser(payload.user);
    setIsAuthOpen(false);
    setIsBootstrappingSession(false);
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    setShouldOpenUploadAfterAuth(false);
  };

  const openLeanPlayground = (seed?: { code: string; title: string }) => {
    if (seed?.code) {
      setPlaygroundSeed({
        code: seed.code,
        revision: Date.now(),
        title: seed.title,
      });
    }

    setCurrentView('playground');
  };

  const handleProofUploadRequest = () => {
    setUploadError('');

    if (!currentUser) {
      setShouldOpenUploadAfterAuth(true);
      setIsAuthOpen(true);
      return;
    }

    proofUploadInputRef.current?.click();
  };

  const handleProofUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadError('');
    setIsUploadingProof(true);

    try {
      const title = file.name.replace(/\.pdf$/i, '') || 'Uploaded proof';
      const workspace = await uploadProofPdf(title, file);
      setPlaygroundSeed({
        code: workspace.lean4_code,
        revision: Date.now(),
        title: `${workspace.title} · Lean4`,
      });
      setCurrentView('playground');
    } catch (error: any) {
      if (error?.response?.status === 401) {
        handleLogout();
        setShouldOpenUploadAfterAuth(true);
        setIsAuthOpen(true);
        setUploadError('Your session expired. Please sign in again.');
      } else {
        setUploadError(error?.response?.data?.detail ?? 'Failed to upload and convert the PDF.');
      }
    } finally {
      event.target.value = '';
      setIsUploadingProof(false);
    }
  };

  const handleRetryPlayground = () => {
    setPlaygroundLoaderVersion((current) => current + 1);
    setCurrentView('playground');
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
      <input
        ref={proofUploadInputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={handleProofUpload}
      />

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
          {currentView === 'playground' && (
            <button className="button-secondary" onClick={() => setCurrentView('dashboard')}>
              <ArrowLeft size={16} />
              Main Page
            </button>
          )}
          <button
            className="button-primary"
            onClick={handleProofUploadRequest}
            disabled={isUploadingProof}
          >
            <FileUp size={16} />
            {isUploadingProof ? 'Uploading PDF...' : 'Upload Proof'}
          </button>
          {currentUser ? (
            <>
              <div className="user-chip">
                <ShieldCheck size={16} color="var(--secondary-accent)" />
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {currentUser.full_name}
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
              <TheoremExplorer />
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
                  <h2 style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
                    Multi-Agent Research Manifold
                  </h2>
                  <p
                    style={{
                      color: 'rgba(255,255,255,0.7)',
                      fontSize: '0.9rem',
                      marginTop: '4px',
                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                    }}
                  >
                    Live interactions between AI researchers
                  </p>
                </div>
                <AgentGraph />
              </div>

              {uploadError && <div className="auth-error">{uploadError}</div>}
            </section>
          </section>
        ) : (
          <section className="playground-screen">
            {uploadError && <div className="auth-error">{uploadError}</div>}
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
                />
              </Suspense>
            </RecoverableErrorBoundary>
          </section>
        )}
      </main>

      <div className={`chat-popover glass-panel ${isChatOpen ? 'is-open' : ''}`}>
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
        onClose={() => {
          setIsAuthOpen(false);
          setShouldOpenUploadAfterAuth(false);
        }}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  );
}

export default App;
