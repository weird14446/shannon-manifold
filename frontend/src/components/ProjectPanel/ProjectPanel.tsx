import { useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle, Plus, X } from 'lucide-react';

import {
  createProject,
  listProjects,
  openProject,
  type AuthUser,
  type ProjectOpenResponse,
  type ProjectSummary,
} from '../../api';

interface ProjectPanelProps {
  isOpen: boolean;
  currentUser: AuthUser | null;
  onClose: () => void;
  onOpenAuth: () => void;
  onOpenProject: (project: ProjectOpenResponse) => void;
}

export function ProjectPanel({
  isOpen,
  currentUser,
  onClose,
  onOpenAuth,
  onOpenProject,
}: ProjectPanelProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !currentUser) {
      return;
    }

    let isMounted = true;

    const loadProjects = async () => {
      setIsLoading(true);
      setError('');

      try {
        const items = await listProjects();
        if (isMounted) {
          setProjects(items);
        }
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
  }, [currentUser, isOpen]);

  if (!isOpen) {
    return null;
  }

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
      const project = await createProject({ title: nextTitle });
      setProjects((current) => [
        {
          title: project.title,
          slug: project.slug,
          owner_slug: project.owner_slug,
          project_root: project.project_root,
          package_name: project.package_name,
          entry_file_path: project.entry_file_path,
          entry_module_name: project.entry_module_name,
        },
        ...current.filter((item) => item.slug !== project.slug),
      ]);
      setTitle('');
      onOpenProject(project);
      onClose();
    } catch (createError: any) {
      setError(createError?.response?.data?.detail ?? 'Failed to create the project.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenProject = async (project: ProjectSummary) => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const openedProject = await openProject(project.slug, project.entry_file_path);
      onOpenProject(openedProject);
      onClose();
    } catch (openError: any) {
      setError(openError?.response?.data?.detail ?? 'Failed to open the project.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-backdrop" role="presentation">
      <div className="auth-card glass-panel">
        <button className="auth-close" type="button" onClick={onClose} aria-label="Close project panel">
          <X size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div className="user-chip" style={{ padding: '12px', borderRadius: '14px' }}>
            <FolderOpen size={18} color="var(--secondary-accent)" />
          </div>
          <div>
            <h2>Projects</h2>
            <p className="auth-helper">
              Create a Lean project scaffold or reopen an existing project entry module.
            </p>
          </div>
        </div>

        {!currentUser ? (
          <div className="auth-input-grid">
            <div className="auth-helper">Sign in to create or open project workspaces.</div>
            <button type="button" className="button-primary" onClick={onOpenAuth}>
              Open Authentication
            </button>
          </div>
        ) : (
          <>
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
              <button
                type="button"
                className="button-primary"
                onClick={handleCreateProject}
                disabled={isCreating}
              >
                <Plus size={16} />
                {isCreating ? 'Creating...' : 'Create Project'}
              </button>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '360px', overflowY: 'auto' }}>
              {isLoading ? (
                <div className="theorem-empty-state">
                  <LoaderCircle size={18} className="spin" />
                  Loading projects...
                </div>
              ) : projects.length === 0 ? (
                <div className="theorem-empty-state">
                  Create a project to scaffold `Package/Main.lean` and start editing.
                </div>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.slug}
                    type="button"
                    className="theorem-card-button"
                    onClick={() => void handleOpenProject(project)}
                  >
                    <div className="theorem-card-head">
                      <div className="theorem-card-title-group">
                        <div className="theorem-card-title">{project.title}</div>
                        <div className="theorem-card-meta">{project.project_root}</div>
                      </div>
                      <div className="theorem-card-statuses">
                        <span className="proof-badge">{project.package_name}</span>
                      </div>
                    </div>
                    <p className="theorem-card-statement">
                      Entry module: {project.entry_module_name}
                    </p>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
