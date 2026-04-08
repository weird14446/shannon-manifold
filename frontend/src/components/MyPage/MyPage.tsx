import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenText,
  FileText,
  FolderKanban,
  Globe,
  LoaderCircle,
  Lock,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';

import {
  getTheorems,
  listProjects,
  listProofWorkspaces,
  updateCurrentUser,
  type AuthUser,
  type IndexedProofSummary,
  type ProjectSummary,
  type ProofWorkspaceSummary,
} from '../../api';
import { useI18n } from '../../i18n';

interface MyPageProps {
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onOpenProof: (proofId: number) => void;
  onOpenProject: (ownerSlug: string, projectSlug: string) => void;
  onUserUpdated: (user: AuthUser) => void;
}

interface MyStats {
  projectCount: number;
  publicProjectCount: number;
  privateProjectCount: number;
  verifiedCodeCount: number;
  proofWorkspaceCount: number;
  pdfWorkspaceCount: number;
  hIndex: number;
  gIndex: number;
}

const normalizeCitationCounts = (proofs: IndexedProofSummary[]) =>
  proofs
    .map((proof) => Math.max(0, proof.cited_by_count ?? 0))
    .sort((left, right) => right - left);

const computeHIndex = (proofs: IndexedProofSummary[]) => {
  const citationCounts = normalizeCitationCounts(proofs);
  let hIndex = 0;

  for (let index = 0; index < citationCounts.length; index += 1) {
    const rank = index + 1;
    if (citationCounts[index] >= rank) {
      hIndex = rank;
    } else {
      break;
    }
  }

  return hIndex;
};

const computeGIndex = (proofs: IndexedProofSummary[]) => {
  const citationCounts = normalizeCitationCounts(proofs);
  let gIndex = 0;
  let runningCitationSum = 0;

  for (let index = 0; index < citationCounts.length; index += 1) {
    runningCitationSum += citationCounts[index];
    const rank = index + 1;
    if (runningCitationSum >= rank * rank) {
      gIndex = rank;
    }
  }

  return gIndex;
};

export function MyPage({
  currentUser,
  onOpenAuth,
  onOpenProof,
  onOpenProject,
  onUserUpdated,
}: MyPageProps) {
  const { t, formatDateTime } = useI18n();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [proofs, setProofs] = useState<IndexedProofSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<ProofWorkspaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileName, setProfileName] = useState(currentUser?.full_name ?? '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    setProfileName(currentUser?.full_name ?? '');
  }, [currentUser?.full_name]);

  useEffect(() => {
    if (!currentUser) {
      setProjects([]);
      setProofs([]);
      setWorkspaces([]);
      setIsLoading(false);
      setError('');
      return;
    }

    let isMounted = true;

    const loadMyPage = async () => {
      setIsLoading(true);
      setError('');

      try {
        const [projectItems, proofItems, workspaceItems] = await Promise.all([
          listProjects(),
          getTheorems(),
          listProofWorkspaces(),
        ]);
        if (!isMounted) {
          return;
        }
        const ownerSlug = `user${currentUser.id}`;
        setProjects(projectItems.filter((project) => project.owner_slug === ownerSlug));
        setProofs(proofItems.filter((proof) => proof.can_edit));
        setWorkspaces(workspaceItems);
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.response?.data?.detail ?? t('Failed to load your account page.'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadMyPage();

    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  const stats = useMemo<MyStats>(
    () => ({
      projectCount: projects.length,
      publicProjectCount: projects.filter((project) => project.visibility === 'public').length,
      privateProjectCount: projects.filter((project) => project.visibility === 'private').length,
      verifiedCodeCount: proofs.length,
      proofWorkspaceCount: workspaces.length,
      pdfWorkspaceCount: workspaces.filter((workspace) => workspace.has_pdf).length,
      hIndex: computeHIndex(proofs),
      gIndex: computeGIndex(proofs),
    }),
    [projects, proofs, workspaces],
  );

  const handleSaveProfile = async () => {
    if (!currentUser) {
      return;
    }

    setIsSavingProfile(true);
    setError('');
    try {
      const updated = await updateCurrentUser({ full_name: profileName });
      onUserUpdated(updated);
    } catch (saveError: any) {
      setError(saveError?.response?.data?.detail ?? t('Failed to update your profile.'));
    } finally {
      setIsSavingProfile(false);
    }
  };

  if (!currentUser) {
    return (
      <section className="account-screen glass-panel">
        <div className="account-page-header">
          <div>
            <div className="account-page-kicker">{t('MY PAGE')}</div>
            <h2>{t('Member profile')}</h2>
            <p>
              {t(
                'Sign in to view your projects, verified code, and proof workspaces in one place.',
              )}
            </p>
          </div>
        </div>
        <div className="theorem-empty-state">
          <Sparkles size={18} />
          {t('Login is required to open your account page.')}
        </div>
        <div className="account-page-actions">
          <button type="button" className="button-primary" onClick={onOpenAuth}>
            {t('Sign In')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="account-screen">
      <div className="glass-panel account-page-header">
        <div>
          <div className="account-page-kicker">{t('MY PAGE')}</div>
          <h2>{currentUser.full_name}</h2>
          <p>{t('Review your account profile, personal project space, and verified Lean assets.')}</p>
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="account-page-grid">
        <section className="glass-panel account-profile-panel">
          <div className="account-panel-header">
            <div className="account-panel-icon">
              <UserRound size={18} />
            </div>
            <div>
              <h3>{t('Profile')}</h3>
              <p>{t('Update the name shown across the workspace and theorem database.')}</p>
            </div>
          </div>

          <label className="account-form-field">
            <span>{t('Display name')}</span>
            <input
              className="input-field"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder={t('Your full name')}
              disabled={isSavingProfile}
            />
          </label>

          <div className="account-profile-meta">
            <div className="account-inline-chip">
              <ShieldCheck size={14} />
              {currentUser.is_admin ? t('Administrator') : t('Member')}
            </div>
            <div className="account-inline-chip">
              <Globe size={14} />
              {currentUser.email}
            </div>
            <div className="account-inline-chip">
              <FileText size={14} />
              {t('Joined {timestamp}', { timestamp: formatDateTime(currentUser.created_at) })}
            </div>
          </div>

          <div className="account-page-actions">
            <button
              type="button"
              className="button-primary"
              onClick={handleSaveProfile}
              disabled={isSavingProfile || profileName.trim().length < 2}
            >
              {isSavingProfile ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
              {t('Save Profile')}
            </button>
          </div>
        </section>

        <section className="glass-panel account-stats-panel">
          <div className="account-panel-header">
            <div className="account-panel-icon">
              <FolderKanban size={18} />
            </div>
            <div>
              <h3>{t('Workspace Stats')}</h3>
              <p>{t('Your current footprint and import-based impact across projects and verified Lean code.')}</p>
            </div>
          </div>

          {isLoading ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={18} className="spin" />
              {t('Loading account stats...')}
            </div>
          ) : (
            <div className="account-stat-grid">
              <div className="account-stat-card">
                <span>{t('Projects')}</span>
                <strong>{stats.projectCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>{t('Public Projects')}</span>
                <strong>{stats.publicProjectCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>{t('Private Projects')}</span>
                <strong>{stats.privateProjectCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>{t('Verified Code')}</span>
                <strong>{stats.verifiedCodeCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>{t('h-index')}</span>
                <strong>{stats.hIndex}</strong>
              </div>
              <div className="account-stat-card">
                <span>{t('g-index')}</span>
                <strong>{stats.gIndex}</strong>
              </div>
              <div className="account-stat-card">
                <span>{t('Proof Workspaces')}</span>
                <strong>{stats.proofWorkspaceCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>{t('PDF Workspaces')}</span>
                <strong>{stats.pdfWorkspaceCount}</strong>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="account-page-grid">
        <section className="glass-panel account-list-panel">
          <div className="account-panel-header">
            <div className="account-panel-icon">
              <FolderKanban size={18} />
            </div>
            <div>
              <h3>{t('Your Projects')}</h3>
              <p>{t('Only projects you own appear here, including private workspaces.')}</p>
            </div>
          </div>

          {isLoading ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={18} className="spin" />
              {t('Loading projects...')}
            </div>
          ) : projects.length === 0 ? (
            <div className="theorem-empty-state">
              <Lock size={18} />
              {t('You have not created any projects yet.')}
            </div>
          ) : (
            <div className="account-card-list">
              {projects.map((project) => (
                <div key={project.project_root} className="account-list-card">
                  <div className="account-list-head">
                    <div>
                      <div className="account-list-title">{project.title}</div>
                      <div className="account-list-meta">{project.project_root}</div>
                    </div>
                    <div className="account-badge-row">
                      <span className="proof-badge">{t(project.visibility === 'public' ? 'Public' : 'Private')}</span>
                      <span className="proof-badge">{project.package_name}</span>
                    </div>
                  </div>
                  <div className="account-list-copy">{t('Entry module: {name}', { name: project.entry_module_name })}</div>
                  <div className="account-page-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => onOpenProject(project.owner_slug, project.slug)}
                    >
                      <FolderKanban size={16} />
                      {t('Open Project')}
                    </button>
                    {project.github_url && (
                      <a className="button-secondary" href={project.github_url} target="_blank" rel="noreferrer">
                        {t('GitHub Link')}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="glass-panel account-list-panel">
          <div className="account-panel-header">
            <div className="account-panel-icon">
              <BookOpenText size={18} />
            </div>
            <div>
              <h3>{t('Your Verified Code')}</h3>
              <p>{t('Recent Lean entries you can still edit from the verified database.')}</p>
            </div>
          </div>

          {isLoading ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={18} className="spin" />
              {t('Loading verified code...')}
            </div>
          ) : proofs.length === 0 ? (
            <div className="theorem-empty-state">
              <Sparkles size={18} />
              {t('Save a Lean file into the verified database to populate this section.')}
            </div>
          ) : (
            <div className="account-card-list">
              {proofs.slice(0, 8).map((proof) => (
                <div key={proof.id} className="account-list-card">
                  <div className="account-list-head">
                    <div>
                      <div className="account-list-title">{proof.title}</div>
                      <div className="account-list-meta">
                        {proof.module_name ?? proof.path ?? t('Workspace module')}
                      </div>
                    </div>
                    <div className="account-badge-row">
                      <span className="proof-badge">{proof.proof_language}</span>
                      {proof.project_root && <span className="proof-badge">{t('project')}</span>}
                    </div>
                  </div>
                  <div className="account-list-copy">{proof.statement}</div>
                  <div className="account-page-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => onOpenProof(proof.id)}
                    >
                      {t('Open Detail')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="glass-panel account-list-panel">
        <div className="account-panel-header">
          <div className="account-panel-icon">
            <FileText size={18} />
          </div>
          <div>
            <h3>{t('Your Proof Workspaces')}</h3>
            <p>{t('Drafts and PDF-backed proof workspaces tied to your account.')}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="theorem-empty-state">
            <LoaderCircle size={18} className="spin" />
            {t('Loading proof workspaces...')}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="theorem-empty-state">
            <Sparkles size={18} />
            {t('No proof workspaces found yet.')}
          </div>
        ) : (
          <div className="account-card-list">
            {workspaces.slice(0, 8).map((workspace) => (
              <div key={workspace.id} className="account-list-card">
                <div className="account-list-head">
                  <div>
                    <div className="account-list-title">{workspace.title}</div>
                    <div className="account-list-meta">
                      {workspace.source_filename ?? workspace.source_kind}
                    </div>
                  </div>
                  <div className="account-badge-row">
                    <span className="proof-badge">{t(workspace.status)}</span>
                    {workspace.has_pdf && <span className="proof-badge">{t('pdf')}</span>}
                  </div>
                </div>
                <div className="account-list-copy">
                  {t('Updated {timestamp}', { timestamp: formatDateTime(workspace.updated_at) })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
