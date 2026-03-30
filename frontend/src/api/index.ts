import axios from 'axios';

export interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  is_admin: boolean;
  created_at: string;
}

export interface AdminStats {
  total_users: number;
  admin_users: number;
  total_projects: number;
  public_projects: number;
  private_projects: number;
  verified_documents: number;
  proof_workspaces: number;
  pdf_workspaces: number;
}

export interface AdminUserSummary {
  id: number;
  full_name: string;
  email: string;
  is_admin: boolean;
  created_at: string;
  project_count: number;
  verified_document_count: number;
  proof_workspace_count: number;
  pdf_workspace_count: number;
  can_toggle_admin: boolean;
}

export interface AdminProjectSummary {
  title: string;
  slug: string;
  owner_slug: string;
  project_root: string;
  package_name: string;
  entry_module_name: string;
  github_url: string | null;
  visibility: 'public' | 'private';
}

export interface AdminOverview {
  stats: AdminStats;
  users: AdminUserSummary[];
  projects: AdminProjectSummary[];
}

export interface AuthResponse {
  access_token: string;
  token_type: 'bearer';
  user: AuthUser;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {
  full_name: string;
}

export interface GoogleLoginPayload {
  credential: string;
}

export interface ProofAgentStep {
  agent_id: string;
  agent_name: string;
  stage: string;
  summary: string;
  output_preview: string;
  timestamp: string;
}

export interface ProofWorkspaceSummary {
  id: number;
  title: string;
  source_kind: string;
  source_filename: string | null;
  has_pdf?: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  build_job_id?: string | null;
  build_status?: string | null;
  build_error?: string | null;
}

export interface ProofWorkspace extends ProofWorkspaceSummary {
  pdf_filename?: string | null;
  source_text: string;
  extracted_text: string;
  lean4_code: string;
  rocq_code: string;
  agent_trace: ProofAgentStep[];
}

export interface ChatMessagePayload {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCodeContextPayload {
  title: string;
  content: string;
  language?: string;
  module_name?: string | null;
  path?: string | null;
  imports?: string[];
  cursor_line?: number | null;
  cursor_column?: number | null;
  cursor_line_text?: string | null;
  nearby_code?: string | null;
  proof_state?: string | null;
  active_goal?: string | null;
  proof_workspace_id?: number | null;
  attached_pdf_filename?: string | null;
}

export interface ChatReply {
  reply: string;
  provider: string;
  model: string;
  suggested_code?: string | null;
  suggested_language?: string | null;
}

export interface IndexedProofSummary {
  id: number;
  title: string;
  statement: string;
  proof_language: string;
  is_verified: boolean;
  can_edit: boolean;
  can_delete: boolean;
  source_kind: string;
  status: string;
  updated_at: string;
  path: string | null;
  module_name: string | null;
  proof_workspace_id: number | null;
  has_pdf: boolean;
  pdf_filename: string | null;
  project_root: string | null;
  project_slug: string | null;
  project_title: string | null;
  project_owner_slug: string | null;
  project_file_path: string | null;
  project_module_name: string | null;
  cited_by_count: number;
}

export interface IndexedProofDetail extends IndexedProofSummary {
  content: string;
}

export interface TheoremPdfMappingItem {
  symbol_name: string;
  declaration_kind: string;
  start_line: number;
  end_line: number;
  pdf_page: number | null;
  pdf_excerpt: string;
  confidence: number | null;
  reason: string | null;
}

export interface TheoremPdfMapping {
  generated_at: string | null;
  items: TheoremPdfMappingItem[];
}

export interface DiscussionComment {
  id: number;
  thread_id: number;
  author_id: number;
  author_name: string;
  parent_id: number | null;
  parent_author_name: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  can_delete: boolean;
}

export interface DiscussionThreadSummary {
  id: number;
  scope_type: 'theorem' | 'project';
  scope_key: string;
  anchor_type: 'general' | 'lean_decl' | 'pdf_page' | 'project_readme';
  anchor_key: string;
  anchor_json: Record<string, unknown>;
  anchor_label: string;
  status: 'open' | 'resolved';
  is_outdated: boolean;
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  latest_activity_at: string;
  comment_count: number;
  latest_comment_preview: string | null;
  can_resolve: boolean;
}

export interface DiscussionThreadDetail extends DiscussionThreadSummary {
  comments: DiscussionComment[];
}

export interface LeanWorkspaceModule {
  path: string;
  module: string;
}

export interface LeanWorkspaceInfo {
  workspace_dir: string;
  playground_file: string;
  playground_module: string;
  repository_subdir: string;
  repository_url: string | null;
  repository_branch: string;
  can_push: boolean;
  importable_modules: LeanWorkspaceModule[];
}

export interface LeanWorkspaceSyncResponse extends LeanWorkspaceInfo {
  saved_path: string;
  saved_module: string;
  pushed: boolean;
  proof_workspace_id: number | null;
  pdf_filename: string | null;
  build_job_id?: string | null;
  build_status?: string | null;
  build_error?: string | null;
  remote_content_url: string | null;
  remote_commit_url: string | null;
}

export interface VerifiedBuildJob {
  job_id: string;
  status: string;
  error: string | null;
  saved_path: string;
  saved_module: string;
  proof_workspace_id: number | null;
  pdf_filename: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSummary {
  title: string;
  slug: string;
  owner_slug: string;
  project_root: string;
  package_name: string;
  entry_file_path: string;
  entry_module_name: string;
  github_url: string | null;
  visibility: 'public' | 'private';
  can_edit: boolean;
  can_delete: boolean;
}

export interface ProjectOpenResponse extends ProjectSummary {
  workspace_title: string;
  workspace_file_path: string;
  workspace_module_name: string;
  content: string;
}

export interface ProjectParticipant {
  owner_slug: string;
  display_name: string;
  role: string;
}

export interface ProjectDetail extends ProjectSummary {
  readme_path: string;
  readme_content: string;
  participants: ProjectParticipant[];
}

export interface ProjectModule {
  document_id: number;
  path: string;
  module_name: string;
  title: string;
  depth: number;
  is_entry: boolean;
}

export interface RemixProvenancePayload {
  kind: 'theorem' | 'project_module';
  source_document_id: number;
  source_title: string;
  source_label: string;
  source_project_root?: string | null;
  source_project_slug?: string | null;
  source_owner_slug?: string | null;
  source_project_file_path?: string | null;
  source_project_module_name?: string | null;
  pdf_linked?: boolean;
}

export interface LeanImportGraphNode {
  id: string;
  document_id: number;
  label: string;
  module_name: string;
  path: string | null;
  title: string;
  imports: number;
  cited_by_count: number;
  source_kind: string;
  project_root: string | null;
  project_slug: string | null;
  project_title: string | null;
  owner_slug: string | null;
}

export interface LeanImportGraphLink {
  source: string;
  target: string;
  type: string;
}

export interface LeanImportGraph {
  nodes: LeanImportGraphNode[];
  links: LeanImportGraphLink[];
}

const TOKEN_STORAGE_KEY = 'shannon-manifold-token';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

let authToken =
  typeof window !== 'undefined'
    ? window.localStorage.getItem(TOKEN_STORAGE_KEY)
    : null;

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${authToken}`;
  }

  return config;
});

export const setAuthToken = (token: string | null) => {
  authToken = token;

  if (typeof window === 'undefined') {
    return;
  }

  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
};

export const hasStoredToken = () => Boolean(authToken);

export const chatWithOracle = async (
  message: string,
  history: ChatMessagePayload[],
  codeContext?: ChatCodeContextPayload | null,
  attachmentFile?: File | null,
) => {
  const payload = attachmentFile ? new FormData() : {
    message,
    history,
    code_context: codeContext ?? null,
  };

  if (payload instanceof FormData) {
    payload.append('message', message);
    payload.append('history', JSON.stringify(history));
    if (codeContext) {
      payload.append('code_context', JSON.stringify(codeContext));
    }
    if (attachmentFile) {
      payload.append('attachment_file', attachmentFile);
    }
  }

  const response = await api.post<ChatReply>('/chat/', payload);
  return response.data;
};

export const registerUser = async (payload: RegisterPayload) => {
  const response = await api.post<AuthResponse>('/auth/register', payload);
  return response.data;
};

export const loginUser = async (payload: LoginPayload) => {
  const response = await api.post<AuthResponse>('/auth/login', payload);
  return response.data;
};

export const loginWithGoogle = async (payload: GoogleLoginPayload) => {
  const response = await api.post<AuthResponse>('/auth/google', payload);
  return response.data;
};

export const getCurrentUser = async () => {
  const response = await api.get<AuthUser>('/auth/me');
  return response.data;
};

export const updateCurrentUser = async (payload: { full_name: string }) => {
  const response = await api.put<AuthUser>('/auth/me', payload);
  return response.data;
};

export const listProofWorkspaces = async () => {
  const response = await api.get<ProofWorkspaceSummary[]>('/proofs/');
  return response.data;
};

export const getProofWorkspace = async (workspaceId: number) => {
  const response = await api.get<ProofWorkspace>(`/proofs/${workspaceId}`);
  return response.data;
};

export const createManualProofWorkspace = async (payload: {
  title: string;
  source_text: string;
}) => {
  const response = await api.post<ProofWorkspace>('/proofs/manual', payload);
  return response.data;
};

export const uploadProofPdf = async (
  title: string,
  file: File,
  options?: {
    workspace_id?: number | null;
    lean4_code?: string | null;
    project_root?: string | null;
    project_file_path?: string | null;
    validation_project_root?: string | null;
    validation_project_file_path?: string | null;
    remix_provenance?: RemixProvenancePayload | null;
  },
) => {
  const formData = new FormData();
  formData.append('title', title);
  formData.append('file', file);
  if (options?.workspace_id != null) {
    formData.append('workspace_id', String(options.workspace_id));
  }
  if (options?.lean4_code) {
    formData.append('lean4_code', options.lean4_code);
  }
  if (options?.project_root) {
    formData.append('project_root', options.project_root);
  }
  if (options?.project_file_path) {
    formData.append('project_file_path', options.project_file_path);
  }
  if (options?.validation_project_root) {
    formData.append('validation_project_root', options.validation_project_root);
  }
  if (options?.validation_project_file_path) {
    formData.append('validation_project_file_path', options.validation_project_file_path);
  }
  if (options?.remix_provenance) {
    formData.append('remix_provenance', JSON.stringify(options.remix_provenance));
  }
  const response = await api.post<ProofWorkspace>('/proofs/upload-pdf', formData);
  return response.data;
};

export const updateProofWorkspace = async (
  workspaceId: number,
  payload: {
    title: string;
    source_text: string;
    extracted_text: string;
    lean4_code: string;
    rocq_code: string;
  },
) => {
  const response = await api.put<ProofWorkspace>(`/proofs/${workspaceId}`, payload);
  return response.data;
};

export const regenerateProofWorkspace = async (workspaceId: number) => {
  const response = await api.post<ProofWorkspace>(`/proofs/${workspaceId}/regenerate`);
  return response.data;
};

export const getTheorems = async () => {
  const response = await api.get<IndexedProofSummary[]>('/theorems/');
  return response.data;
};

export const findTheoremByProjectModule = async (
  projectRoot: string,
  projectFilePath: string,
) => {
  const response = await api.get<IndexedProofSummary>('/theorems/lookup/project-module', {
    params: {
      project_root: projectRoot,
      project_file_path: projectFilePath,
    },
  });
  return response.data;
};

export const getTheoremDetail = async (theoremId: number) => {
  const response = await api.get<IndexedProofDetail>(`/theorems/${theoremId}`);
  return response.data;
};

export const getTheoremPdfMapping = async (theoremId: number) => {
  const response = await api.get<TheoremPdfMapping>(`/theorems/${theoremId}/pdf-mapping`);
  return response.data;
};

export const getTheoremPdfUrl = (theoremId: number, download = false) =>
  `${API_BASE_URL}/theorems/${theoremId}/pdf${download ? '?download=true' : ''}`;

export const getProofWorkspacePdfUrl = (workspaceId: number, download = false) =>
  `${API_BASE_URL}/proofs/${workspaceId}/pdf${download ? '?download=true' : ''}`;

export const updateTheorem = async (
  theoremId: number,
  payload: {
    title: string;
    content: string;
  },
) => {
  const response = await api.put<IndexedProofDetail>(`/theorems/${theoremId}`, payload);
  return response.data;
};

export const deleteTheorem = async (theoremId: number) => {
  await api.delete(`/theorems/${theoremId}`);
};

export const listDiscussionThreads = async (params: {
  scope_type: 'theorem' | 'project';
  scope_key: string;
  anchor_type?: 'general' | 'lean_decl' | 'pdf_page' | 'project_readme';
}) => {
  const response = await api.get<DiscussionThreadSummary[]>('/discussions/', {
    params,
  });
  return response.data;
};

export const createDiscussionThread = async (payload: {
  scope_type: 'theorem' | 'project';
  scope_key: string;
  anchor_type: 'general' | 'lean_decl' | 'pdf_page' | 'project_readme';
  anchor_json?: Record<string, unknown>;
  body: string;
}) => {
  const response = await api.post<DiscussionThreadDetail>('/discussions/threads', payload);
  return response.data;
};

export const getDiscussionThread = async (threadId: number) => {
  const response = await api.get<DiscussionThreadDetail>(`/discussions/threads/${threadId}`);
  return response.data;
};

export const createDiscussionComment = async (
  threadId: number,
  payload: {
    body: string;
    parent_id?: number | null;
  },
) => {
  const response = await api.post<DiscussionThreadDetail>(
    `/discussions/threads/${threadId}/comments`,
    payload,
  );
  return response.data;
};

export const updateDiscussionThread = async (
  threadId: number,
  payload: {
    status: 'open' | 'resolved';
  },
) => {
  const response = await api.patch<DiscussionThreadDetail>(
    `/discussions/threads/${threadId}`,
    payload,
  );
  return response.data;
};

export const deleteDiscussionComment = async (commentId: number) => {
  await api.delete(`/discussions/comments/${commentId}`);
};

export const getLeanImportGraph = async () => {
  const response = await api.get<LeanImportGraph>('/lean-workspace/import-graph');
  return response.data;
};

export const getAdminOverview = async () => {
  const response = await api.get<AdminOverview>('/admin/overview');
  return response.data;
};

export const updateAdminUser = async (userId: number, payload: { is_admin: boolean }) => {
  const response = await api.put<AdminUserSummary>(`/admin/users/${userId}`, payload);
  return response.data;
};

export const deleteAdminUser = async (userId: number) => {
  await api.delete(`/admin/users/${userId}`);
};

export const getLeanWorkspaceInfo = async () => {
  const response = await api.get<LeanWorkspaceInfo>('/lean-workspace/');
  return response.data;
};

export const listProjects = async () => {
  const response = await api.get<ProjectSummary[]>('/projects/');
  return response.data;
};

export const createProject = async (payload: {
  title: string;
  slug?: string;
  github_url?: string | null;
  visibility?: 'public' | 'private';
}) => {
  const response = await api.post<ProjectOpenResponse>('/projects/', payload);
  return response.data;
};

export const updateProject = async (
  projectSlug: string,
  payload: {
    title?: string | null;
    github_url?: string | null;
    visibility?: 'public' | 'private';
    readme_content?: string | null;
  },
) => {
  const response = await api.put<ProjectDetail>(`/projects/${encodeURIComponent(projectSlug)}`, payload);
  return response.data;
};

export const deleteProject = async (projectSlug: string, ownerSlug?: string | null) => {
  await api.delete(`/projects/${encodeURIComponent(projectSlug)}`, {
    params: ownerSlug ? { owner_slug: ownerSlug } : undefined,
  });
};

export const openProject = async (
  projectSlug: string,
  filePath?: string | null,
  ownerSlug?: string | null,
) => {
  const response = await api.get<ProjectOpenResponse>(`/projects/${encodeURIComponent(projectSlug)}/open`, {
    params:
      filePath || ownerSlug
        ? {
            ...(filePath ? { file_path: filePath } : {}),
            ...(ownerSlug ? { owner_slug: ownerSlug } : {}),
          }
        : undefined,
  });
  return response.data;
};

export const getProjectDetail = async (
  projectSlug: string,
  ownerSlug?: string | null,
) => {
  const response = await api.get<ProjectDetail>(`/projects/${encodeURIComponent(projectSlug)}`, {
    params: ownerSlug ? { owner_slug: ownerSlug } : undefined,
  });
  return response.data;
};

export const listProjectModules = async (
  projectSlug: string,
  ownerSlug?: string | null,
) => {
  const response = await api.get<ProjectModule[]>(`/projects/${encodeURIComponent(projectSlug)}/modules`, {
    params: ownerSlug ? { owner_slug: ownerSlug } : undefined,
  });
  return response.data;
};

export const createProjectFile = async (
  projectSlug: string,
  payload: {
    path: string;
  },
) => {
  const response = await api.post<ProjectOpenResponse>(
    `/projects/${encodeURIComponent(projectSlug)}/files`,
    payload,
  );
  return response.data;
};

export const saveProjectFile = async (
  projectSlug: string,
  payload: {
    path: string;
    content: string;
  },
) => {
  const response = await api.put<ProjectOpenResponse>(
    `/projects/${encodeURIComponent(projectSlug)}/files`,
    payload,
  );
  return response.data;
};

export const syncLeanPlaygroundToWorkspace = async (payload: {
  code: string;
  title: string;
  proof_workspace_id?: number | null;
  project_root?: string | null;
  project_file_path?: string | null;
  validation_project_root?: string | null;
  validation_project_file_path?: string | null;
  remix_provenance?: RemixProvenancePayload | null;
}) => {
  const response = await api.post<LeanWorkspaceSyncResponse>(
    '/lean-workspace/sync-playground',
    payload,
  );
  return response.data;
};

export const getVerifiedBuildJob = async (jobId: string) => {
  const response = await api.get<VerifiedBuildJob>(`/lean-workspace/build-jobs/${encodeURIComponent(jobId)}`);
  return response.data;
};

export default api;
