import { useEffect, useState } from 'react';
import { BookOpenText, CheckCircle2, LoaderCircle, Lock, Sparkles } from 'lucide-react';

import { getTheorems, type AuthUser, type IndexedProofSummary } from '../../api';

interface TheoremExplorerProps {
  currentUser: AuthUser | null;
  onOpenProof: (proofId: number) => void;
}

export function TheoremExplorer({ currentUser, onOpenProof }: TheoremExplorerProps) {
  const [proofs, setProofs] = useState<IndexedProofSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    const loadProofs = async () => {
      setIsLoading(true);
      setError('');

      try {
        const items = await getTheorems();
        if (isMounted) {
          setProofs(items);
        }
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.response?.data?.detail ?? 'Failed to load verified code.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadProofs();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="theorem-explorer">
      <div className="theorem-explorer-header">
        <div>
          <h2>Verified Database</h2>
          <p>
            Open uploaded proofs and saved Lean playground modules in a dedicated code viewer.
          </p>
        </div>
        <div className="theorem-explorer-badge">
          <BookOpenText size={16} />
          {proofs.length} items
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {isLoading ? (
        <div className="theorem-empty-state">
          <LoaderCircle size={18} className="spin" />
          Loading verified code...
        </div>
      ) : proofs.length === 0 ? (
        <div className="theorem-empty-state">
          <Sparkles size={18} />
          Upload a proof or save from the Lean Playground to populate this database.
        </div>
      ) : (
        <div className="theorem-card-list">
          {proofs.map((proof) => (
            <button
              key={proof.id}
              type="button"
              className="theorem-card-button"
              onClick={() => onOpenProof(proof.id)}
            >
              <div className="theorem-card-head">
                <div className="theorem-card-title-group">
                  <div className="theorem-card-title">{proof.title}</div>
                  <div className="theorem-card-meta">
                    {proof.module_name ?? proof.path ?? 'Workspace module'}
                  </div>
                </div>
                <div className="theorem-card-statuses">
                  <span className="proof-badge">{proof.proof_language}</span>
                  <span className={proof.can_edit ? 'proof-badge' : 'proof-readonly-pill'}>
                    {proof.can_edit && currentUser ? (
                      <>
                        <CheckCircle2 size={12} />
                        Your code
                      </>
                    ) : (
                      <>
                        <Lock size={12} />
                        Public
                      </>
                    )}
                  </span>
                </div>
              </div>

              <p className="theorem-card-statement">{proof.statement}</p>

              <div className="theorem-card-footer">
                <span className="theorem-card-source">{proof.source_kind.replace(/_/g, ' ')}</span>
                <span className="theorem-card-updated">
                  {new Date(proof.updated_at).toLocaleString()}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
