import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole, UserRound, X } from 'lucide-react';

import { loginUser, loginWithGoogle, registerUser, type AuthResponse } from '../../api';

type AuthMode = 'login' | 'register';

interface AuthPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (payload: AuthResponse) => void;
}

const INITIAL_FORM = {
  full_name: '',
  email: '',
  password: '',
};

const GOOGLE_SCRIPT_ID = 'google-identity-services';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: Record<string, string | number | boolean>,
  ) => void;
  cancel: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleIdentityApi;
      };
    };
  }
}

const loadGoogleIdentityScript = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existingScript = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(script);
  });

export function AuthPanel({
  isOpen,
  onClose,
  onAuthenticated,
}: AuthPanelProps) {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<AuthMode>('login');
  const [form, setForm] = useState(INITIAL_FORM);
  const [error, setError] = useState('');
  const [googleError, setGoogleError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setMode('login');
    setForm(INITIAL_FORM);
    setError('');
    setGoogleError('');
    setIsSubmitting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !googleClientId || !googleButtonRef.current) {
      return;
    }

    let isActive = true;

    const renderGoogleButton = async () => {
      try {
        await loadGoogleIdentityScript();
        if (!isActive || !window.google?.accounts?.id || !googleButtonRef.current) {
          return;
        }

        const handleGoogleCredential = async (response: GoogleCredentialResponse) => {
          if (!response.credential) {
            setGoogleError('Google did not return a usable credential.');
            return;
          }

          setError('');
          setGoogleError('');
          setIsSubmitting(true);

          try {
            const payload = await loginWithGoogle({ credential: response.credential });
            if (isActive) {
              onAuthenticated(payload);
            }
          } catch (googleLoginError: any) {
            if (isActive) {
              setGoogleError(
                googleLoginError?.response?.data?.detail ?? 'Google login failed.',
              );
            }
          } finally {
            if (isActive) {
              setIsSubmitting(false);
            }
          }
        };

        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleGoogleCredential,
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: Math.max(320, Math.floor(googleButtonRef.current.clientWidth || 360)),
        });
      } catch (scriptError) {
        if (isActive) {
          setGoogleError('Failed to initialize Google login.');
        }
      }
    };

    void renderGoogleButton();

    return () => {
      isActive = false;
      window.google?.accounts?.id.cancel();
    };
  }, [googleClientId, isOpen, onAuthenticated]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const payload =
        mode === 'login'
          ? await loginUser({
              email: form.email,
              password: form.password,
            })
          : await registerUser({
              full_name: form.full_name,
              email: form.email,
              password: form.password,
            });

      onAuthenticated(payload);
    } catch (error: any) {
      setError(error?.response?.data?.detail ?? 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-backdrop" role="presentation">
      <div className="auth-card glass-panel">
        <button className="auth-close" type="button" onClick={onClose} aria-label="Close authentication panel">
          <X size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div className="user-chip" style={{ padding: '12px', borderRadius: '14px' }}>
            <LockKeyhole size={18} color="var(--secondary-accent)" />
          </div>
          <div>
            <h2>Member Access</h2>
            <p className="auth-helper">
              Create an account or sign in to use the theorem oracle against the shared MySQL-backed member database.
            </p>
          </div>
        </div>

        <div className="auth-toggle">
          <button
            type="button"
            className={mode === 'login' ? 'is-active' : ''}
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'is-active' : ''}
            onClick={() => setMode('register')}
          >
            Sign Up
          </button>
        </div>

        {googleClientId && (
          <div className="auth-google-section">
            <div ref={googleButtonRef} className="auth-google-button" />
            <div className="auth-divider">
              <span>or continue with email</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-input-grid">
          {mode === 'register' && (
            <label>
              <span className="auth-field-label">Full name</span>
              <input
                className="input-field"
                value={form.full_name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, full_name: event.target.value }))
                }
                placeholder="Ada Lovelace"
                minLength={2}
                maxLength={255}
                required
              />
            </label>
          )}

          <label>
            <span className="auth-field-label">Email</span>
            <input
              className="input-field"
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="researcher@example.com"
              required
            />
          </label>

          <label>
            <span className="auth-field-label">Password</span>
            <input
              className="input-field"
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="At least 8 characters"
              minLength={8}
              maxLength={128}
              required
            />
          </label>

          {googleError && <div className="auth-error">{googleError}</div>}
          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="button-primary" disabled={isSubmitting}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <UserRound size={16} />
              {isSubmitting
                ? 'Working...'
                : mode === 'login'
                  ? 'Login'
                  : 'Create account'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
