import { Microscope } from 'lucide-react';
import './index.css';

import { Chatbot } from './components/Chatbot/Chatbot';
import { AgentGraph } from './components/AgentGraph/AgentGraph';
import { TheoremExplorer } from './components/TheoremList/TheoremExplorer';

function App() {
  return (
    <div className="layout">
      <header className="header" style={{height: '72px'}}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Microscope className="text-accent" size={32} color="var(--accent-color)" />
          <h1>Shannon Manifold</h1>
        </div>
        <div>
          <button className="button-primary">Connect Wallet / Login</button>
        </div>
      </header>
      
      <main className="main-content" style={{height: 'calc(100vh - 72px)'}}>
        <aside className="sidebar glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '20px', borderBottom: 'var(--glass-border)', flexShrink: 0 }}>
            <h2>Theorem Oracle</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '8px' }}>
              Ask questions about verified proofs.
            </p>
          </div>
          <div style={{ flex: 1, overflowY: 'hidden', padding: '20px' }}>
            <Chatbot />
          </div>
        </aside>

        <section className="view-section">
          <div className="glass-panel" style={{ flex: 2, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 10, padding: '20px', pointerEvents: 'none' }}>
              <h2 style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Multi-Agent Research Manifold</h2>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', marginTop: '4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>Live interactions between AI researchers</p>
            </div>
            <AgentGraph />
          </div>

          <div className="glass-panel" style={{ flex: 1, padding: '20px', overflowY: 'hidden' }}>
            <TheoremExplorer />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
