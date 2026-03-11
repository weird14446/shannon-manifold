import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { RecoverableErrorBoundary } from './components/ErrorBoundary/RecoverableErrorBoundary';
import './index.css';

document.documentElement.classList.add('shannon-html');
document.body.classList.add('shannon-body');

const startupFallback = (
  <div className="app-startup-fallback">
    <div className="screen-fallback-card glass-panel">
      <div className="screen-fallback-title">Shannon Manifold could not start.</div>
      <p className="screen-fallback-copy">
        Refresh the page. If the issue persists, return to the Docker logs for the frontend
        service.
      </p>
    </div>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecoverableErrorBoundary fallback={startupFallback}>
      <App />
    </RecoverableErrorBoundary>
  </StrictMode>,
);
