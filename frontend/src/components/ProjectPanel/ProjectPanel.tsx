import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import {
  createProject,
  deleteProject,
  getProjectDetail,
  listProjects,
  updateProject,
  type AuthUser,
  type ProjectDetail,
  type ProjectSummary,
} from '../../api';
import { DiscussionPanel, type DiscussionAnchorSelection } from '../Discussion/DiscussionPanel';

interface ProjectPanelProps {
  isOpen?: boolean;
  variant?: 'modal' | 'page';
  currentUser: AuthUser | null;
  onClose?: () => void;
  onOpenAuth: () => void;
  initialSelectedProjectKey?: string | null;
}

export function ProjectPanel({
  isOpen,
  variant = 'modal',
  currentUser,
  onClose,
  onOpenAuth,
  initialSelectedProjectKey = null,
}: ProjectPanelProps) {
  const isVisible = variant === 'page' ? true : Boolean(isOpen);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const [selectedProjectDetail, setSelectedProjectDetail] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [readmeContent, setReadmeContent] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [editingProjectSlug, setEditingProjectSlug] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [discussionTab, setDiscussionTab] = useState<'general' | 'readme'>('general');
  const [error, setError] = useState('');

  const selectedProjectSummary = useMemo(
    () =>
      projects.find(
        (project) => `${project.owner_slug}:${project.slug}` === selectedProjectKey,
      ) ?? null,
    [projects, selectedProjectKey],
  );

  useEffect(() => {
    if (isVisible) {
      return;
    }

    setTitle('');
    setGithubUrl('');
    setReadmeContent('');
    setVisibility('private');
    setEditingProjectSlug(null);
    setSelectedProjectKey(null);
    setSelectedProjectDetail(null);
    setError('');
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }
    setSelectedProjectKey(initialSelectedProjectKey ?? null);
  }, [initialSelectedProjectKey, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let isMounted = true;

    const loadProjects = async () => {
      setIsLoading(true);
      setError('');

      try {
        const items = await listProjects();
        if (!isMounted) {
          return;
        }
        setProjects(items);
        setSelectedProjectKey((current) =>
          current && items.some((project) => `${project.owner_slug}:${project.slug}` === current)
            ? current
            : null,
        );
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.response?.data?.detail ?? 'Failed to load projects.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadProjects();

    return () => {
      isMounted = false;
    };
  }, [currentUser, isVisible]);

  useEffect(() => {
    if (!selectedProjectSummary) {
      setSelectedProjectDetail(null);
      return;
    }

    let isMounted = true;

    const loadProjectDetail = async () => {
      setIsDetailLoading(true);
      setError('');
      try {
        const detail = await getProjectDetail(
          selectedProjectSummary.slug,
          selectedProjectSummary.owner_slug,
        );
        if (isMounted) {
          setSelectedProjectDetail(detail);
        }
      } catch (detailError: any) {
        if (isMounted) {
          setError(detailError?.response?.data?.detail ?? 'Failed to load the project detail.');
        }
      } finally {
        if (isMounted) {
          setIsDetailLoading(false);
        }
      }
    };

    void loadProjectDetail();

    return () => {
      isMounted = false;
    };
  }, [selectedProjectSummary]);

  useEffect(() => {
    setDiscussionTab('general');
  }, [selectedProjectKey]);

  if (!isVisible) {
    return null;
  }

  const projectScopeKey = selectedProjectDetail
    ? `project:${selectedProjectDetail.project_root}`
    : '';
  const readmeAnchor = selectedProjectDetail
    ? ({
        anchor_type: 'project_readme',
        label: selectedProjectDetail.readme_path,
        anchor_json: {
          project_root: selectedProjectDetail.project_root,
          readme_path: selectedProjectDetail.readme_path,
        },
      } satisfies DiscussionAnchorSelection)
    : null;

  const resetEditor = () => {
    setEditingProjectSlug(null);
    setTitle('');
    setGithubUrl('');
    setReadmeContent('');
    setVisibility('private');
  };

  const handleCreateProject = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('Project title is required.');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const project = await createProject({
        title: nextTitle,
        github_url: githubUrl.trim() || null,
        visibility,
      });
      const nextSummary: ProjectSummary = {
        title: project.title,
        slug: project.slug,
        owner_slug: project.owner_slug,
        project_root: project.project_root,
        package_name: project.package_name,
        entry_file_path: project.entry_file_path,
        entry_module_name: project.entry_module_name,
        github_url: project.github_url,
        visibility: project.visibility,
        can_edit: project.can_edit,
        can_delete: project.can_delete,
      };
      setProjects((current) => [
        nextSummary,
        ...current.filter(
          (item) => `${item.owner_slug}:${item.slug}` !== `${project.owner_slug}:${project.slug}`,
        ),
      ]);
      setSelectedProjectKey(`${project.owner_slug}:${project.slug}`);
      resetEditor();
    } catch (createError: any) {
      setError(createError?.response?.data?.detail ?? 'Failed to create the project.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEditProject = (project: ProjectDetail) => {
    setEditingProjectSlug(project.slug);
    setTitle(project.title);
    setGithubUrl(project.github_url ?? '');
    setReadmeContent(project.readme_content);
    setVisibility(project.visibility);
    setError('');
  };

  const handleCancelEdit = () => {
    resetEditor();
    setError('');
  };

  const handleUpdateSelectedProject = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!editingProjectSlug) {
      return;
    }

    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('Project title is required.');
      return;
    }

    setIsUpdating(true);
    setError('');

    try {
      const updatedProject = await updateProject(editingProjectSlug, {
        title: nextTitle,
        github_url: githubUrl.trim() || null,
        visibility,
        readme_content: readmeContent,
      });
      setProjects((current) =>
        current.map((project) =>
          `${project.owner_slug}:${project.slug}` ===
          `${updatedProject.owner_slug}:${updatedProject.slug}`
            ? updatedProject
            : project,
        ),
      );
      if (
        selectedProjectDetail &&
        selectedProjectDetail.slug === updatedProject.slug &&
        selectedProjectDetail.owner_slug === updatedProject.owner_slug
      ) {
        setSelectedProjectDetail(updatedProject);
      }
      handleCancelEdit();
    } catch (updateError: any) {
      setError(updateError?.response?.data?.detail ?? 'Failed to update the project.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteSelectedProject = async (project: ProjectDetail) => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!project.can_delete) {
      setError('You do not have permission to delete this project.');
      return;
    }
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete project "${project.title}"? This removes the project workspace files.`)
    ) {
      return;
    }

    setIsDeletingProject(true);
    setError('');
    try {
      await deleteProject(project.slug, project.owner_slug);
      setProjects((current) =>
        current.filter(
          (candidate) =>
            `${candidate.owner_slug}:${candidate.slug}` !== `${project.owner_slug}:${project.slug}`,
        ),
      );
      setSelectedProjectKey(null);
      setSelectedProjectDetail(null);
      resetEditor();
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail ?? 'Failed to delete the project.');
    } finally {
      setIsDeletingProject(false);
    }
  };

  const detailContent = selectedProjectSummary ? (
    isDetailLoading || !selectedProjectDetail ? (
      <div className="theorem-empty-state">
        <LoaderCircle size={18} className="spin" />
        Loading project detail...
      </div>
    ) : (
      <div className="project-detail-shell">
        <div className="project-detail-header">
          <div>
            <div className="account-page-kicker">PROJECT DETAIL</div>
            <h2>{selectedProjectDetail.title}</h2>
            <p className="auth-helper">Review the project participants and README.</p>
          </div>
          <div className="project-detail-actions">
            <button type="button" className="button-secondary" onClick={() => setSelectedProjectKey(null)}>
              <ArrowLeft size={16} />
              Back to Projects
            </button>
            {selectedProjectDetail.can_edit && (
              <button
                type="button"
                className="button-secondary"
                onClick={() => handleStartEditProject(selectedProjectDetail)}
              >
                <Pencil size={16} />
                Edit Project
              </button>
            )}
            {selectedProjectDetail.can_delete && (
              <button
                type="button"
                className="button-danger"
                onClick={() => void handleDeleteSelectedProject(selectedProjectDetail)}
                disabled={isDeletingProject}
              >
                {isDeletingProject ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                Delete Project
              </button>
            )}
            {selectedProjectDetail.github_url && (
              <button
                type="button"
                className="button-secondary"
                onClick={() => window.open(selectedProjectDetail.github_url!, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink size={16} />
                Open GitHub
              </button>
            )}
          </div>
        </div>

        <div className="verified-code-meta" style={{ marginTop: '4px' }}>
          <span className="proof-badge">{selectedProjectDetail.package_name}</span>
          <span className="proof-badge">{selectedProjectDetail.visibility}</span>
          <span className="proof-badge">{selectedProjectDetail.owner_slug}</span>
          <span className="proof-badge">{selectedProjectDetail.entry_module_name}</span>
        </div>

        {editingProjectSlug === selectedProjectDetail.slug && selectedProjectDetail.can_edit && (
          <div className="glass-panel project-editor-panel">
            <div className="auth-input-grid">
              <label>
                <span className="auth-field-label">Project title</span>
                <input
                  className="input-field"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Project title"
                  maxLength={255}
                />
              </label>
              <label>
                <span className="auth-field-label">GitHub link</span>
                <input
                  className="input-field"
                  value={githubUrl}
                  onChange={(event) => setGithubUrl(event.target.value)}
                  placeholder="https://github.com/owner/repository"
                  maxLength={1024}
                />
              </label>
              <label>
                <span className="auth-field-label">Visibility</span>
                <select
                  className="input-field"
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value as 'public' | 'private')}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </label>
            </div>
            <label className="project-readme-field">
              <span className="auth-field-label">README.md</span>
              <textarea
                className="proof-textarea project-readme-textarea"
                value={readmeContent}
                onChange={(event) => setReadmeContent(event.target.value)}
                placeholder="# Project Title"
              />
            </label>
            <div className="account-page-actions">
              <button
                type="button"
                className="button-primary"
                onClick={() => void handleUpdateSelectedProject()}
                disabled={isUpdating}
              >
                {isUpdating ? <LoaderCircle size={16} className="spin" /> : <Pencil size={16} />}
                Save Changes
              </button>
              <button type="button" className="button-secondary" onClick={handleCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="project-detail-grid">
          <section className="glass-panel project-detail-panel">
            <div className="project-detail-panel-header">
              <div className="account-panel-icon">
                <Users size={18} />
              </div>
              <div>
                <h3>Participants</h3>
                <p>Current project members tracked by the project manifest.</p>
              </div>
            </div>
            <div className="account-card-list">
              {selectedProjectDetail.participants.map((participant) => (
                <div
                  key={`${participant.owner_slug}:${participant.role}`}
                  className="account-list-card"
                >
                  <div className="account-list-head">
                    <div>
                      <div className="account-list-title">{participant.display_name}</div>
                      <div className="account-list-meta">{participant.owner_slug}</div>
                    </div>
                    <div className="account-badge-row">
                      <span className="proof-badge">{participant.role}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel project-detail-panel project-readme-panel">
            <div className="project-detail-panel-header">
              <div className="account-panel-icon">
                <FileText size={18} />
              </div>
              <div>
                <h3>{selectedProjectDetail.readme_path}</h3>
                <p>Project overview and usage notes saved in the project root.</p>
              </div>
            </div>
            <div className="project-readme-content project-readme-markdown">
              <ReactMarkdown>{selectedProjectDetail.readme_content}</ReactMarkdown>
            </div>
          </section>
        </div>

        <section className="glass-panel project-discussion-section">
          <div className="project-detail-panel-header">
            <div className="account-panel-icon">
              <FileText size={18} />
            </div>
            <div>
              <h3>Discussions</h3>
              <p>Keep project decisions attached to the project itself instead of a separate board.</p>
            </div>
          </div>
          <div className="discussion-tab-bar">
            <button
              type="button"
              className={`discussion-tab ${discussionTab === 'general' ? 'is-active' : ''}`}
              onClick={() => setDiscussionTab('general')}
            >
              General
            </button>
            <button
              type="button"
              className={`discussion-tab ${discussionTab === 'readme' ? 'is-active' : ''}`}
              onClick={() => setDiscussionTab('readme')}
            >
              README
            </button>
          </div>
          {discussionTab === 'general' ? (
            <DiscussionPanel
              title="Project Discussion"
              currentUser={currentUser}
              onOpenAuth={onOpenAuth}
              scopeType="project"
              scopeKey={projectScopeKey}
              anchorType="general"
              emptyMessage="No project-wide discussion has started yet."
            />
          ) : (
            <DiscussionPanel
              title="README Discussion"
              currentUser={currentUser}
              onOpenAuth={onOpenAuth}
              scopeType="project"
              scopeKey={projectScopeKey}
              anchorType="project_readme"
              currentAnchor={readmeAnchor}
              emptyMessage="No README discussion threads exist for this project yet."
            />
          )}
        </section>
      </div>
    )
  ) : (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <div className="user-chip" style={{ padding: '12px', borderRadius: '14px' }}>
          <FolderOpen size={18} color="var(--secondary-accent)" />
        </div>
        <div>
          <h2>Projects</h2>
          <p className="auth-helper">
            {currentUser
              ? 'Click a project card to open its detail page with participants and README.'
              : 'Browse public projects without signing in. Sign in only if you want to create or manage projects.'}
          </p>
        </div>
      </div>

      {currentUser ? (
        <div className="auth-input-grid" style={{ marginBottom: '16px' }}>
          <label>
            <span className="auth-field-label">Project title</span>
            <input
              className="input-field"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Test"
              maxLength={255}
            />
          </label>
          <label>
            <span className="auth-field-label">GitHub link</span>
            <input
              className="input-field"
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              maxLength={1024}
            />
          </label>
          <label>
            <span className="auth-field-label">Visibility</span>
            <select
              className="input-field"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as 'public' | 'private')}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </label>
          <button
            type="button"
            className="button-primary"
            onClick={() => void handleCreateProject()}
            disabled={isCreating}
          >
            {isCreating ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
            Create Project
          </button>
        </div>
      ) : (
        <div className="project-public-banner" style={{ marginBottom: '16px' }}>
          <div className="auth-helper">
            Public projects are visible below even while signed out. Private projects remain hidden until you sign in.
          </div>
          <button type="button" className="button-secondary" onClick={onOpenAuth}>
            Login / Register
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="theorem-empty-state">
          <LoaderCircle size={18} className="spin" />
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="theorem-empty-state">
          {currentUser
            ? 'Create a project to scaffold Package/Main.lean and README.md.'
            : 'No public projects are available yet.'}
        </div>
      ) : (
        <div className="theorem-card-list">
          {projects.map((project) => (
            <button
              key={`${project.owner_slug}:${project.slug}`}
              type="button"
              className="theorem-card-button"
              onClick={() => setSelectedProjectKey(`${project.owner_slug}:${project.slug}`)}
            >
              <div className="theorem-card-head">
                <div className="theorem-card-title-group">
                  <div className="theorem-card-title">{project.title}</div>
                  <div className="theorem-card-meta">{project.project_root}</div>
                </div>
                <div className="theorem-card-statuses">
                  <span className="proof-badge">{project.package_name}</span>
                  <span className="proof-badge">{project.visibility}</span>
                  {project.can_edit ? (
                    <span className="proof-badge">yours</span>
                  ) : (
                    <span className="proof-badge">{project.owner_slug}</span>
                  )}
                </div>
              </div>
              <p className="theorem-card-statement">
                Entry module: {project.entry_module_name}
              </p>
              {project.github_url && (
                <p className="theorem-card-statement" style={{ marginTop: '8px' }}>
                  GitHub: {project.github_url}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );

  const content = (
    <>
      {variant === 'modal' && onClose ? (
        <button className="auth-close" type="button" onClick={onClose} aria-label="Close project panel">
          <X size={18} />
        </button>
      ) : null}

      {error && <div className="auth-error">{error}</div>}
      {detailContent}
    </>
  );

  if (variant === 'page') {
    return (
      <section className="verified-code-screen">
        <div
          className="glass-panel"
          style={{
            width: 'min(1180px, 100%)',
            margin: '0 auto',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            minHeight: 0,
            flex: 1,
            overflow: 'auto',
          }}
        >
          {content}
        </div>
      </section>
    );
  }

  return (
    <div className="auth-backdrop" role="presentation">
      <div className="auth-card glass-panel">
        {content}
      </div>
    </div>
  );
}
