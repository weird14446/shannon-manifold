import { useEffect, useMemo, useState } from 'react';
import {
  FolderKanban,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';

import {
  deleteAdminUser,
  deleteProject,
  deleteTheorem,
  getAdminOverview,
  getTheorems,
  type IndexedProofSummary,
  updateAdminUser,
  type AdminOverview,
  type AdminProjectSummary,
  type AdminUserSummary,
  type AuthUser,
} from '../../api';

interface AdminPageProps {
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onUserUpdated: (user: AuthUser) => void;
}

const ADMIN_STAT_LABELS: Array<{ key: keyof AdminOverview['stats']; label: string }> = [
  { key: 'total_users', label: 'Users' },
  { key: 'admin_users', label: 'Admins' },
  { key: 'total_projects', label: 'Projects' },
  { key: 'public_projects', label: 'Public Projects' },
  { key: 'private_projects', label: 'Private Projects' },
  { key: 'verified_documents', label: 'Verified Code' },
  { key: 'proof_workspaces', label: 'Proof Workspaces' },
  { key: 'pdf_workspaces', label: 'PDF Workspaces' },
];

export function AdminPage({ currentUser, onOpenAuth, onUserUpdated }: AdminPageProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [verifiedDocuments, setVerifiedDocuments] = useState<IndexedProofSummary[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [error, setError] = useState('');
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [deletingProjectKey, setDeletingProjectKey] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<number | null>(null);

  const loadAdminData = async () => {
    return Promise.all([getAdminOverview(), getTheorems()] as const);
  };

  useEffect(() => {
    if (!currentUser?.is_admin) {
      setOverview(null);
      setVerifiedDocuments([]);
      setIsLoading(false);
      setIsLoadingDocuments(false);
      setError('');
      return;
    }

    let isMounted = true;

    const loadOverview = async () => {
      setIsLoading(true);
      setIsLoadingDocuments(true);
      setError('');
      try {
        const [payload, documents] = await loadAdminData();
        if (isMounted) {
          setOverview(payload);
          setVerifiedDocuments(documents);
        }
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.response?.data?.detail ?? 'Failed to load admin overview.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsLoadingDocuments(false);
        }
      }
    };

    void loadOverview();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.id, currentUser?.is_admin]);

  const adminUsers = useMemo(
    () => overview?.users.filter((user) => user.is_admin) ?? [],
    [overview?.users],
  );

  const handleToggleAdmin = async (user: AdminUserSummary) => {
    setSavingUserId(user.id);
    setError('');
    try {
      const updated = await updateAdminUser(user.id, { is_admin: !user.is_admin });
      setOverview((current) => {
        if (!current) {
          return current;
        }
        const nextUsers = current.users.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        );
        return {
          ...current,
          users: nextUsers,
          stats: {
            ...current.stats,
            admin_users: nextUsers.filter((candidate) => candidate.is_admin).length,
          },
        };
      });
      if (currentUser && currentUser.id === updated.id) {
        onUserUpdated({
          ...currentUser,
          is_admin: updated.is_admin,
        });
      }
    } catch (updateError: any) {
      setError(updateError?.response?.data?.detail ?? 'Failed to update administrator role.');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleDeleteUser = async (user: AdminUserSummary) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Delete user "${user.full_name}"? Their projects, workspaces, and verified code will be removed.`,
      )
    ) {
      return;
    }

    setDeletingUserId(user.id);
    setError('');
    try {
      await deleteAdminUser(user.id);
      const [nextOverview, nextDocuments] = await loadAdminData();
      setOverview(nextOverview);
      setVerifiedDocuments(nextDocuments);
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail ?? 'Failed to delete the user.');
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleDeleteProject = async (project: AdminProjectSummary) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Delete project "${project.title}"? Its project workspace files will be removed.`,
      )
    ) {
      return;
    }

    setDeletingProjectKey(`${project.owner_slug}:${project.slug}`);
    setError('');
    try {
      await deleteProject(project.slug, project.owner_slug);
      const [nextOverview, nextDocuments] = await loadAdminData();
      setOverview(nextOverview);
      setVerifiedDocuments(nextDocuments);
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail ?? 'Failed to delete the project.');
    } finally {
      setDeletingProjectKey(null);
    }
  };

  const handleDeleteDocument = async (document: IndexedProofSummary) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete verified code "${document.title}"?`)
    ) {
      return;
    }

    setDeletingDocumentId(document.id);
    setError('');
    try {
      await deleteTheorem(document.id);
      const [nextOverview, nextDocuments] = await loadAdminData();
      setOverview(nextOverview);
      setVerifiedDocuments(nextDocuments);
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail ?? 'Failed to delete the verified code entry.');
    } finally {
      setDeletingDocumentId(null);
    }
  };

  if (!currentUser) {
    return (
      <section className="account-screen glass-panel">
        <div className="account-page-header">
          <div>
            <div className="account-page-kicker">ADMIN PAGE</div>
            <h2>Platform administration</h2>
            <p>Administrator tools are only available to signed-in admin accounts.</p>
          </div>
        </div>
        <div className="theorem-empty-state">
          <Sparkles size={18} />
          Login is required to access administrator controls.
        </div>
        <div className="account-page-actions">
          <button type="button" className="button-primary" onClick={onOpenAuth}>
            Sign In
          </button>
        </div>
      </section>
    );
  }

  if (!currentUser.is_admin) {
    return (
      <section className="account-screen glass-panel">
        <div className="account-page-header">
          <div>
            <div className="account-page-kicker">ADMIN PAGE</div>
            <h2>Restricted access</h2>
            <p>This page is limited to administrator accounts configured for the platform.</p>
          </div>
        </div>
        <div className="theorem-empty-state">
          <ShieldCheck size={18} />
          Your current account does not have administrator privileges.
        </div>
      </section>
    );
  }

  return (
    <section className="account-screen">
      <div className="glass-panel account-page-header">
        <div>
          <div className="account-page-kicker">ADMIN PAGE</div>
          <h2>Platform Administration</h2>
          <p>Monitor platform usage, inspect project visibility, and manage administrator roles.</p>
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <section className="glass-panel account-stats-panel">
        <div className="account-panel-header">
          <div className="account-panel-icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <h3>Platform Stats</h3>
            <p>Current counts across users, projects, verified documents, and proof workspaces.</p>
          </div>
        </div>

        {isLoading || !overview ? (
          <div className="theorem-empty-state">
            <LoaderCircle size={18} className="spin" />
            Loading platform stats...
          </div>
        ) : (
          <div className="account-stat-grid">
            {ADMIN_STAT_LABELS.map(({ key, label }) => (
              <div key={key} className="account-stat-card">
                <span>{label}</span>
                <strong>{overview.stats[key]}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="account-page-grid">
        <section className="glass-panel account-list-panel account-user-directory-panel">
          <div className="account-panel-header">
            <div className="account-panel-icon">
              <Users size={18} />
            </div>
            <div>
              <h3>User Directory</h3>
              <p>{adminUsers.length} administrators currently active across the platform.</p>
            </div>
          </div>

          {isLoading || !overview ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={18} className="spin" />
              Loading users...
            </div>
          ) : (
            <div className="account-user-directory-scroller">
              <div className="account-card-list account-user-directory-list">
                {overview.users.map((user) => (
                  <div key={user.id} className="account-list-card">
                    <div className="account-list-head">
                      <div>
                        <div className="account-list-title">{user.full_name}</div>
                        <div className="account-list-meta">
                          {user.email} · Joined {new Date(user.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <span className={user.is_admin ? 'proof-badge' : 'proof-readonly-pill'}>
                        {user.is_admin ? 'admin' : 'member'}
                      </span>
                    </div>

                    <div className="account-user-directory-counts">
                      <div className="account-user-directory-count">
                        <span>Projects</span>
                        <strong>{user.project_count}</strong>
                      </div>
                      <div className="account-user-directory-count">
                        <span>Verified</span>
                        <strong>{user.verified_document_count}</strong>
                      </div>
                      <div className="account-user-directory-count">
                        <span>Workspaces</span>
                        <strong>{user.proof_workspace_count}</strong>
                      </div>
                    </div>

                    <div className="account-user-directory-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={
                          savingUserId === user.id ||
                          (!user.can_toggle_admin && user.is_admin)
                        }
                        onClick={() => void handleToggleAdmin(user)}
                      >
                        {savingUserId === user.id ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <UserCog size={16} />
                        )}
                        {user.is_admin ? 'Revoke Admin' : 'Grant Admin'}
                      </button>
                      <button
                        type="button"
                        className="button-danger"
                        disabled={deletingUserId === user.id || currentUser.id === user.id}
                        onClick={() => void handleDeleteUser(user)}
                      >
                        {deletingUserId === user.id ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                        Delete User
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="glass-panel account-list-panel">
          <div className="account-panel-header">
            <div className="account-panel-icon">
              <FolderKanban size={18} />
            </div>
            <div>
              <h3>Project Catalog</h3>
              <p>All project manifests currently registered in the shared Lean workspace.</p>
            </div>
          </div>

          {isLoading || !overview ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={18} className="spin" />
              Loading projects...
            </div>
          ) : overview.projects.length === 0 ? (
            <div className="theorem-empty-state">
              <Sparkles size={18} />
              No projects have been created yet.
            </div>
          ) : (
            <div className="account-card-list">
              {overview.projects.map((project: AdminProjectSummary) => (
                <div key={project.project_root} className="account-list-card">
                  <div className="account-list-head">
                    <div>
                      <div className="account-list-title">{project.title}</div>
                      <div className="account-list-meta">
                        {project.owner_slug} · {project.project_root}
                      </div>
                    </div>
                    <div className="account-badge-row">
                      <span className="proof-badge">{project.visibility}</span>
                      <span className="proof-badge">{project.package_name}</span>
                    </div>
                  </div>
	                  <div className="account-list-copy">Entry module: {project.entry_module_name}</div>
	                  <div className="account-page-actions">
	                    {project.github_url && (
	                      <a
	                        className="button-secondary"
	                        href={project.github_url}
	                        target="_blank"
	                        rel="noreferrer"
	                      >
	                        Open GitHub Link
	                      </a>
	                    )}
	                    <button
	                      type="button"
	                      className="button-danger"
	                      disabled={deletingProjectKey === `${project.owner_slug}:${project.slug}`}
	                      onClick={() => void handleDeleteProject(project)}
	                    >
	                      {deletingProjectKey === `${project.owner_slug}:${project.slug}` ? (
	                        <LoaderCircle size={16} className="spin" />
	                      ) : (
	                        <Trash2 size={16} />
	                      )}
	                      Delete Project
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
	            <ShieldCheck size={18} />
	          </div>
	          <div>
	            <h3>Verified Code</h3>
	            <p>Administrators can remove verified code entries directly from here.</p>
	          </div>
	        </div>

	        {isLoadingDocuments ? (
	          <div className="theorem-empty-state">
	            <LoaderCircle size={18} className="spin" />
	            Loading verified code...
	          </div>
	        ) : verifiedDocuments.length === 0 ? (
	          <div className="theorem-empty-state">
	            <Sparkles size={18} />
	            No verified code entries are available.
	          </div>
	        ) : (
	          <div className="account-card-list">
	            {verifiedDocuments.map((document) => (
	              <div key={document.id} className="account-list-card">
	                <div className="account-list-head">
	                  <div>
	                    <div className="account-list-title">{document.title}</div>
	                    <div className="account-list-meta">
	                      {document.path || document.module_name || 'Verified code entry'}
	                    </div>
	                  </div>
	                  <div className="account-badge-row">
	                    <span className="proof-badge">{document.source_kind}</span>
	                    <span className="proof-badge">{document.proof_language}</span>
	                    {document.has_pdf && <span className="proof-badge">pdf</span>}
	                  </div>
	                </div>
	                <div className="account-list-copy">{document.statement}</div>
	                <div className="account-page-actions">
	                  <button
	                    type="button"
	                    className="button-danger"
	                    disabled={deletingDocumentId === document.id}
	                    onClick={() => void handleDeleteDocument(document)}
	                  >
	                    {deletingDocumentId === document.id ? (
	                      <LoaderCircle size={16} className="spin" />
	                    ) : (
	                      <Trash2 size={16} />
	                    )}
	                    Delete Verified Code
	                  </button>
	                </div>
	              </div>
	            ))}
	          </div>
	        )}
	      </section>
	    </section>
	  );
	}
