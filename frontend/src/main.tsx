import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { RecoverableErrorBoundary } from './components/ErrorBoundary/RecoverableErrorBoundary';
import { I18nProvider, detectInitialLanguage, translateStatic } from './i18n';
import './index.css';

document.documentElement.classList.add('shannon-html');
document.body.classList.add('shannon-body');

const initialLanguage = detectInitialLanguage();

const startupFallback = (
  <div className="app-startup-fallback">
    <div className="screen-fallback-card glass-panel">
      <div className="screen-fallback-title">
        {translateStatic(initialLanguage, 'Shannon Manifold could not start.')}
      </div>
      <p className="screen-fallback-copy">
        {translateStatic(
          initialLanguage,
          'Refresh the page. If the issue persists, return to the Docker logs for the frontend service.',
        )}
      </p>
    </div>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <RecoverableErrorBoundary fallback={startupFallback}>
        <App />
      </RecoverableErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
