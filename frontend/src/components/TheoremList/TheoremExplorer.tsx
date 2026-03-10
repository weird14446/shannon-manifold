import { useState, useEffect } from 'react';
import { getTheorems } from '../../api';
import { BookOpen, CheckCircle } from 'lucide-react';

interface Theorem {
  id: number;
  title: string;
  statement: string;
  proof_language: string;
  is_verified: boolean;
}

export function TheoremExplorer() {
  const [theorems, setTheorems] = useState<Theorem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTheorems = async () => {
      try {
        const data = await getTheorems();
        setTheorems(data);
      } catch (e) {
        console.error('Failed to fetch theorems', e);
      } finally {
        setLoading(false);
      }
    };
    fetchTheorems();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      <div style={{ paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen color="var(--accent-color)" /> Verified Database
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
          Browse rigorously verified theorems from Rocq, Lean4, and more.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '8px' }}>
        {loading ? (
          <div className="animate-fade-in" style={{ color: 'var(--text-secondary)' }}>Loading theorems...</div>
        ) : (
          theorems.map((t) => (
            <div key={t.id} className="glass-panel animate-fade-in" style={{ padding: '16px', cursor: 'pointer', transition: 'all 0.2s', border: '1px solid transparent' }} 
                 onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                 onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>{t.title}</h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', padding: '4px 8px', borderRadius: '12px', background: 'rgba(123, 97, 255, 0.2)', color: '#b9aaff' }}>{t.proof_language}</span>
                    {t.is_verified && <CheckCircle size={16} color="#00d4ff" />}
                </div>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t.statement}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
