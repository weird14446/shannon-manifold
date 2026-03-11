import axios from 'axios';

export interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  created_at: string;
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
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProofWorkspace extends ProofWorkspaceSummary {
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
  source_kind: string;
  status: string;
  updated_at: string;
  path: string | null;
  module_name: string | null;
}

export interface IndexedProofDetail extends IndexedProofSummary {
  content: string;
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
  remote_content_url: string | null;
  remote_commit_url: string | null;
}

export interface LeanImportGraphNode {
  id: string;
  label: string;
  module_name: string;
  path: string | null;
  title: string;
  imports: number;
  source_kind: string;
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
) => {
  const response = await api.post<ChatReply>('/chat/', {
    message,
    history,
    code_context: codeContext ?? null,
  });
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

export const getCurrentUser = async () => {
  const response = await api.get<AuthUser>('/auth/me');
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

export const uploadProofPdf = async (title: string, file: File) => {
  const formData = new FormData();
  formData.append('title', title);
  formData.append('file', file);
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

export const getTheoremDetail = async (theoremId: number) => {
  const response = await api.get<IndexedProofDetail>(`/theorems/${theoremId}`);
  return response.data;
};

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

export const getLeanImportGraph = async () => {
  const response = await api.get<LeanImportGraph>('/lean-workspace/import-graph');
  return response.data;
};

export const getLeanWorkspaceInfo = async () => {
  const response = await api.get<LeanWorkspaceInfo>('/lean-workspace/');
  return response.data;
};

export const syncLeanPlaygroundToWorkspace = async (payload: {
  code: string;
  title: string;
}) => {
  const response = await api.post<LeanWorkspaceSyncResponse>(
    '/lean-workspace/sync-playground',
    payload,
  );
  return response.data;
};

export const pushLeanPlaygroundToGithub = async (payload: {
  code: string;
  title: string;
  commit_message?: string;
}) => {
  const response = await api.post<LeanWorkspaceSyncResponse>(
    '/lean-workspace/push-playground',
    payload,
  );
  return response.data;
};

export default api;
