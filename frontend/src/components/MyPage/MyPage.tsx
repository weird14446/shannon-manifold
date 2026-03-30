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
  openProject,
  updateCurrentUser,
  type AuthUser,
  type IndexedProofSummary,
  type ProjectOpenResponse,
  type ProjectSummary,
  type ProofWorkspaceSummary,
} from '../../api';

interface MyPageProps {
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onOpenProof: (proofId: number) => void;
  onOpenProject: (project: ProjectOpenResponse) => void;
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [proofs, setProofs] = useState<IndexedProofSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<ProofWorkspaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileName, setProfileName] = useState(currentUser?.full_name ?? '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isOpeningProjectRoot, setIsOpeningProjectRoot] = useState<string | null>(null);

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
          setError(loadError?.response?.data?.detail ?? 'Failed to load your account page.');
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
      setError(saveError?.response?.data?.detail ?? 'Failed to update your profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleOpenProject = async (project: ProjectSummary) => {
    setIsOpeningProjectRoot(project.project_root);
    setError('');
    try {
      const opened = await openProject(project.slug, null, project.owner_slug);
      onOpenProject(opened);
    } catch (openError: any) {
      setError(openError?.response?.data?.detail ?? 'Failed to open the selected project.');
    } finally {
      setIsOpeningProjectRoot(null);
    }
  };

  if (!currentUser) {
    return (
      <section className="account-screen glass-panel">
        <div className="account-page-header">
          <div>
            <div className="account-page-kicker">MY PAGE</div>
            <h2>Member profile</h2>
            <p>Sign in to view your projects, verified code, and proof workspaces in one place.</p>
          </div>
        </div>
        <div className="theorem-empty-state">
          <Sparkles size={18} />
          Login is required to open your account page.
        </div>
        <div className="account-page-actions">
          <button type="button" className="button-primary" onClick={onOpenAuth}>
            Sign In
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="account-screen">
      <div className="glass-panel account-page-header">
        <div>
          <div className="account-page-kicker">MY PAGE</div>
          <h2>{currentUser.full_name}</h2>
          <p>Review your account profile, personal project space, and verified Lean assets.</p>
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
              <h3>Profile</h3>
              <p>Update the name shown across the workspace and theorem database.</p>
            </div>
          </div>

          <label className="account-form-field">
            <span>Display name</span>
            <input
              className="input-field"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="Your full name"
              disabled={isSavingProfile}
            />
          </label>

          <div className="account-profile-meta">
            <div className="account-inline-chip">
              <ShieldCheck size={14} />
              {currentUser.is_admin ? 'Administrator' : 'Member'}
            </div>
            <div className="account-inline-chip">
              <Globe size={14} />
              {currentUser.email}
            </div>
            <div className="account-inline-chip">
              <FileText size={14} />
              Joined {new Date(currentUser.created_at).toLocaleString()}
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
              Save Profile
            </button>
          </div>
        </section>

        <section className="glass-panel account-stats-panel">
          <div className="account-panel-header">
            <div className="account-panel-icon">
              <FolderKanban size={18} />
            </div>
            <div>
              <h3>Workspace Stats</h3>
              <p>Your current footprint and import-based impact across projects and verified Lean code.</p>
            </div>
          </div>

          {isLoading ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={18} className="spin" />
              Loading account stats...
            </div>
          ) : (
            <div className="account-stat-grid">
              <div className="account-stat-card">
                <span>Projects</span>
                <strong>{stats.projectCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>Public Projects</span>
                <strong>{stats.publicProjectCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>Private Projects</span>
                <strong>{stats.privateProjectCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>Verified Code</span>
                <strong>{stats.verifiedCodeCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>h-index</span>
                <strong>{stats.hIndex}</strong>
              </div>
              <div className="account-stat-card">
                <span>g-index</span>
                <strong>{stats.gIndex}</strong>
              </div>
              <div className="account-stat-card">
                <span>Proof Workspaces</span>
                <strong>{stats.proofWorkspaceCount}</strong>
              </div>
              <div className="account-stat-card">
                <span>PDF Workspaces</span>
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
              <h3>Your Projects</h3>
              <p>Only projects you own appear here, including private workspaces.</p>
            </div>
          </div>

          {isLoading ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={18} className="spin" />
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="theorem-empty-state">
              <Lock size={18} />
              You have not created any projects yet.
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
                      <span className="proof-badge">{project.visibility}</span>
                      <span className="proof-badge">{project.package_name}</span>
                    </div>
                  </div>
                  <div className="account-list-copy">Entry module: {project.entry_module_name}</div>
                  <div className="account-page-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void handleOpenProject(project)}
                      disabled={isOpeningProjectRoot === project.project_root}
                    >
                      {isOpeningProjectRoot === project.project_root ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <FolderKanban size={16} />
                      )}
                      Open Project
                    </button>
                    {project.github_url && (
                      <a className="button-secondary" href={project.github_url} target="_blank" rel="noreferrer">
                        GitHub Link
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
              <h3>Your Verified Code</h3>
              <p>Recent Lean entries you can still edit from the verified database.</p>
            </div>
          </div>

          {isLoading ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={18} className="spin" />
              Loading verified code...
            </div>
          ) : proofs.length === 0 ? (
            <div className="theorem-empty-state">
              <Sparkles size={18} />
              Save a Lean file into the verified database to populate this section.
            </div>
          ) : (
            <div className="account-card-list">
              {proofs.slice(0, 8).map((proof) => (
                <div key={proof.id} className="account-list-card">
                  <div className="account-list-head">
                    <div>
                      <div className="account-list-title">{proof.title}</div>
                      <div className="account-list-meta">
                        {proof.module_name ?? proof.path ?? 'Workspace module'}
                      </div>
                    </div>
                    <div className="account-badge-row">
                      <span className="proof-badge">{proof.proof_language}</span>
                      {proof.project_root && <span className="proof-badge">project</span>}
                    </div>
                  </div>
                  <div className="account-list-copy">{proof.statement}</div>
                  <div className="account-page-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => onOpenProof(proof.id)}
                    >
                      Open Detail
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
            <h3>Your Proof Workspaces</h3>
            <p>Drafts and PDF-backed proof workspaces tied to your account.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="theorem-empty-state">
            <LoaderCircle size={18} className="spin" />
            Loading proof workspaces...
          </div>
        ) : workspaces.length === 0 ? (
          <div className="theorem-empty-state">
            <Sparkles size={18} />
            No proof workspaces found yet.
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
                    <span className="proof-badge">{workspace.status}</span>
                    {workspace.has_pdf && <span className="proof-badge">pdf</span>}
                  </div>
                </div>
                <div className="account-list-copy">
                  Updated {new Date(workspace.updated_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
