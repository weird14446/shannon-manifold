import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole, UserRound, X } from 'lucide-react';

import { loginUser, registerUser, type AuthResponse } from '../../api';

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

export function AuthPanel({
  isOpen,
  onClose,
  onAuthenticated,
}: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [form, setForm] = useState(INITIAL_FORM);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setMode('login');
    setForm(INITIAL_FORM);
    setError('');
    setIsSubmitting(false);
  }, [isOpen]);

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
