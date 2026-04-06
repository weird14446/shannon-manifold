import { useEffect, useMemo, useState } from 'react';
import { BookOpenText, CheckCircle2, LoaderCircle, Lock, Sparkles } from 'lucide-react';

import { getTheorems, type AuthUser, type IndexedProofSummary } from '../../api';
import { useI18n } from '../../i18n';

export interface TheoremProjectFilterOption {
  value: string;
  label: string;
  count: number;
}

interface TheoremExplorerProps {
  currentUser: AuthUser | null;
  onOpenProof: (proofId: number) => void;
  projectFilter?: string;
  onProjectFilterChange?: (value: string) => void;
  onProjectOptionsChange?: (options: TheoremProjectFilterOption[]) => void;
  hideProjectFilter?: boolean;
}

export function TheoremExplorer({
  currentUser,
  onOpenProof,
  projectFilter,
  onProjectFilterChange,
  onProjectOptionsChange,
  hideProjectFilter = false,
}: TheoremExplorerProps) {
  const { t, formatDateTime } = useI18n();
  const [proofs, setProofs] = useState<IndexedProofSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [internalProjectFilter, setInternalProjectFilter] = useState<string>('all');
  const activeProjectFilter = projectFilter ?? internalProjectFilter;

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
          setError(loadError?.response?.data?.detail ?? t('Failed to load verified code.'));
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
  }, [currentUser?.id]);

  const projectOptions = useMemo(() => {
    const optionMap = new Map<string, TheoremProjectFilterOption>();
    for (const proof of proofs) {
      if (!proof.project_root) {
        continue;
      }
      const existing = optionMap.get(proof.project_root);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const ownerLabel = proof.project_owner_slug ? `${proof.project_owner_slug} / ` : '';
      optionMap.set(proof.project_root, {
        value: proof.project_root,
        label: `${ownerLabel}${proof.project_title ?? proof.project_slug ?? proof.project_root}`,
        count: 1,
      });
    }
    return [...optionMap.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [proofs]);

  useEffect(() => {
    onProjectOptionsChange?.(projectOptions);
  }, [onProjectOptionsChange, projectOptions]);

  useEffect(() => {
    if (projectFilter !== undefined) {
      return;
    }
    if (internalProjectFilter === 'all' || internalProjectFilter === 'shared') {
      return;
    }
    if (!projectOptions.some((option) => option.value === internalProjectFilter)) {
      setInternalProjectFilter('all');
    }
  }, [internalProjectFilter, projectFilter, projectOptions]);

  const filteredProofs = useMemo(() => {
    if (activeProjectFilter === 'shared') {
      return proofs.filter((proof) => !proof.project_root);
    }
    if (activeProjectFilter !== 'all') {
      return proofs.filter((proof) => proof.project_root === activeProjectFilter);
    }
    return proofs;
  }, [activeProjectFilter, proofs]);

  const handleProjectFilterChange = (value: string) => {
    if (projectFilter === undefined) {
      setInternalProjectFilter(value);
    }
    onProjectFilterChange?.(value);
  };

  return (
    <div className="theorem-explorer">
      <div className="theorem-explorer-header">
        <div>
          <h2>{t('Verified Database')}</h2>
          <p>{t('Open uploaded proofs and saved Lean playground modules in a dedicated code viewer.')}</p>
        </div>
        <div className="theorem-explorer-badge">
          <BookOpenText size={16} />
          {filteredProofs.length === proofs.length
            ? t('{count} items', { count: proofs.length })
            : t('{visible} / {total} items', {
                visible: filteredProofs.length,
                total: proofs.length,
              })}
        </div>
      </div>

      {!hideProjectFilter && (
        <div className="theorem-explorer-controls">
          <label className="theorem-filter-control">
            <span>{t('Project Filter')}</span>
            <select
              className="input-field theorem-filter-select"
              value={activeProjectFilter}
              onChange={(event) => handleProjectFilterChange(event.target.value)}
            >
              <option value="all">{t('All Verified Code')}</option>
              <option value="shared">{t('Shared / No Project')}</option>
              {projectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      {isLoading ? (
        <div className="theorem-empty-state">
          <LoaderCircle size={18} className="spin" />
          {t('Loading verified code...')}
        </div>
      ) : filteredProofs.length === 0 ? (
        <div className="theorem-empty-state">
          <Sparkles size={18} />
          {proofs.length === 0
            ? t('Save code from the Lean Playground to populate this database.')
            : t('No verified code matches the selected project filter.')}
        </div>
      ) : (
        <div className="theorem-card-list">
          {filteredProofs.map((proof) => (
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
                    {proof.project_module_name ?? proof.module_name ?? proof.path ?? t('Workspace module')}
                    {proof.project_root
                      ? ` · ${proof.project_owner_slug ? `${proof.project_owner_slug} / ` : ''}${proof.project_title ?? proof.project_slug ?? proof.project_root}`
                      : ''}
                  </div>
                </div>
                <div className="theorem-card-statuses">
                  <span className="proof-badge">{proof.proof_language}</span>
                  <span className="proof-badge">
                    {t('Cited by {count}', { count: proof.cited_by_count })}
                  </span>
                  {proof.project_root && <span className="proof-badge">{t('project')}</span>}
                  <span className={proof.can_edit ? 'proof-badge' : 'proof-readonly-pill'}>
                    {proof.can_edit && currentUser ? (
                      <>
                        <CheckCircle2 size={12} />
                        {t('Your code')}
                      </>
                    ) : (
                      <>
                        <Lock size={12} />
                        {t('Public')}
                      </>
                    )}
                  </span>
                </div>
              </div>

              <p className="theorem-card-statement">{proof.statement}</p>

              <div className="theorem-card-footer">
                <span className="theorem-card-source">
                  {proof.project_root
                    ? `${proof.source_kind.replace(/_/g, ' ')} · ${proof.project_slug ?? 'project'}`
                    : proof.source_kind.replace(/_/g, ' ')}
                </span>
                <span className="theorem-card-updated">
                  {formatDateTime(proof.updated_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
