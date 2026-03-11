import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Bot,
  CircleAlert,
  Code2,
  FileText,
  RefreshCcw,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react';

import {
  createManualProofWorkspace,
  getProofWorkspace,
  listProofWorkspaces,
  regenerateProofWorkspace,
  updateProofWorkspace,
  uploadProofPdf,
  type AuthUser,
  type ProofWorkspace as ProofWorkspaceRecord,
  type ProofWorkspaceSummary,
} from '../../api';
import { FormalCodeEditor } from './FormalCodeEditor';

const EDITOR_TABS = [
  { id: 'source_text', label: 'Source Text' },
  { id: 'extracted_text', label: 'Extracted Text' },
  { id: 'lean4_code', label: 'Lean4' },
  { id: 'rocq_code', label: 'Rocq' },
] as const;

type EditorTab = (typeof EDITOR_TABS)[number]['id'];

interface ProofWorkspaceProps {
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  onOpenLeanPlayground: (seed: { code: string; title: string }) => void;
  uploadRequestToken: number;
}

const EMPTY_DRAFT = {
  title: '',
  sourceText: '',
};

export function ProofWorkspace({
  currentUser,
  onOpenAuth,
  onLogout,
  onOpenLeanPlayground,
  uploadRequestToken,
}: ProofWorkspaceProps) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [workspaces, setWorkspaces] = useState<ProofWorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<ProofWorkspaceRecord | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('source_text');
  const [error, setError] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!currentUser) {
      setDraft(EMPTY_DRAFT);
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      setSelectedWorkspace(null);
      setError('');
      return;
    }

    void loadWorkspaces();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || uploadRequestToken === 0) {
      return;
    }

    fileInputRef.current?.click();
  }, [currentUser, uploadRequestToken]);

  const summarizeWorkspace = (
    workspace: ProofWorkspaceRecord,
  ): ProofWorkspaceSummary => ({
    id: workspace.id,
    title: workspace.title,
    source_kind: workspace.source_kind,
    source_filename: workspace.source_filename,
    status: workspace.status,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
  });

  const upsertWorkspace = (workspace: ProofWorkspaceRecord) => {
    setSelectedWorkspaceId(workspace.id);
    setSelectedWorkspace(workspace);
    setWorkspaces((current) => [
      summarizeWorkspace(workspace),
      ...current.filter((item) => item.id !== workspace.id),
    ]);
  };

  const getErrorMessage = (error: any, fallback: string) => {
    if (error?.response?.status === 401) {
      onLogout();
      onOpenAuth();
      return 'Your session expired. Please sign in again.';
    }

    return error?.response?.data?.detail ?? fallback;
  };

  const loadWorkspaces = async (focusWorkspaceId?: number) => {
    setIsLoadingList(true);
    setError('');

    try {
      const summaries = await listProofWorkspaces();
      setWorkspaces(summaries);

      const nextWorkspaceId =
        focusWorkspaceId ??
        (selectedWorkspaceId &&
        summaries.some((workspace) => workspace.id === selectedWorkspaceId)
          ? selectedWorkspaceId
          : summaries[0]?.id ?? null);

      if (nextWorkspaceId) {
        setSelectedWorkspaceId(nextWorkspaceId);
        setIsLoadingWorkspace(true);
        try {
          const workspace = await getProofWorkspace(nextWorkspaceId);
          setSelectedWorkspace(workspace);
        } finally {
          setIsLoadingWorkspace(false);
        }
      } else {
        setSelectedWorkspaceId(null);
        setSelectedWorkspace(null);
      }
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to load proof workspaces.'));
    } finally {
      setIsLoadingList(false);
    }
  };

  const handleSelectWorkspace = async (workspaceId: number) => {
    setSelectedWorkspaceId(workspaceId);
    setIsLoadingWorkspace(true);
    setError('');

    try {
      const workspace = await getProofWorkspace(workspaceId);
      setSelectedWorkspace(workspace);
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to load the selected proof workspace.'));
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  const handleCreateFromText = async () => {
    if (!draft.sourceText.trim()) {
      setError('Enter proof text before generating formalizations.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const workspace = await createManualProofWorkspace({
        title: draft.title.trim() || 'Untitled proof draft',
        source_text: draft.sourceText,
      });
      upsertWorkspace(workspace);
      setActiveTab('source_text');
      setDraft(EMPTY_DRAFT);
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to generate a proof workspace.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChoosePdf = () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    fileInputRef.current?.click();
  };

  const handleUploadPdf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const defaultTitle = file.name.replace(/\.pdf$/i, '') || 'Uploaded proof';
      const workspace = await uploadProofPdf(draft.title.trim() || defaultTitle, file);
      upsertWorkspace(workspace);
      setActiveTab('extracted_text');
      setDraft(EMPTY_DRAFT);
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to upload and convert the PDF.'));
    } finally {
      event.target.value = '';
      setIsSubmitting(false);
    }
  };

  const handleSaveWorkspace = async () => {
    if (!selectedWorkspace) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const workspace = await updateProofWorkspace(selectedWorkspace.id, {
        title: selectedWorkspace.title,
        source_text: selectedWorkspace.source_text,
        extracted_text: selectedWorkspace.extracted_text,
        lean4_code: selectedWorkspace.lean4_code,
        rocq_code: selectedWorkspace.rocq_code,
      });
      upsertWorkspace(workspace);
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to save proof edits.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerateWorkspace = async () => {
    if (!selectedWorkspace) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const workspace = await regenerateProofWorkspace(selectedWorkspace.id);
      upsertWorkspace(workspace);
      setActiveTab('lean4_code');
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to regenerate Lean4 and Rocq drafts.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditorChange = (value: string) => {
    setSelectedWorkspace((current) =>
      current
        ? {
            ...current,
            [activeTab]: value,
          }
        : current,
    );
  };

  const activeEditorLanguage =
    activeTab === 'lean4_code'
      ? 'lean4'
      : activeTab === 'rocq_code'
        ? 'rocq'
        : 'prooftext';

  const activeEditorTitle =
    activeTab === 'lean4_code'
      ? 'Lean4 Draft'
      : activeTab === 'rocq_code'
        ? 'Rocq Draft'
        : activeTab === 'extracted_text'
          ? 'Normalized Proof Text'
          : 'Source Proof Text';

  const buildInfoViewItems = () => {
    if (!selectedWorkspace) {
      return [];
    }

    const activeValue = selectedWorkspace[activeTab];
    const items = [
      {
        label: 'Workspace',
        detail: selectedWorkspace.title,
      },
      {
        label: 'Mode',
        detail:
          activeTab === 'lean4_code'
            ? 'Lean4 extension-style drafting'
            : activeTab === 'rocq_code'
              ? 'Rocq proof authoring'
              : 'Proof text normalization',
      },
      {
        label: 'Status',
        detail: selectedWorkspace.status,
      },
      {
        label: 'Lines',
        detail: String(Math.max(activeValue.split('\n').length, 1)),
      },
    ];

    if (activeTab === 'lean4_code' && activeValue.includes(': True')) {
      items.push({
        label: 'Diagnostic',
        detail: 'Replace the placeholder proposition `True` with the actual theorem statement.',
      });
    }

    if (activeTab === 'lean4_code' && activeValue.includes('trivial')) {
      items.push({
        label: 'Goal',
        detail: 'The current Lean4 draft still closes with `trivial`; replace it with the real tactic script.',
      });
    }

    if (activeTab === 'rocq_code' && activeValue.includes('exact I.')) {
      items.push({
        label: 'Diagnostic',
        detail: 'The Rocq draft still uses the generated placeholder proof `exact I.`.',
      });
    }

    if (activeTab === 'extracted_text' && selectedWorkspace.source_kind === 'pdf') {
      items.push({
        label: 'Extractor',
        detail: selectedWorkspace.source_filename
          ? `Parsed from ${selectedWorkspace.source_filename}`
          : 'Parsed from uploaded PDF',
      });
    }

    return items;
  };

  const infoViewItems = buildInfoViewItems();

  const renderWorkspaceEditor = () => {
    if (isLoadingWorkspace) {
      return <div className="proof-empty">Loading proof workspace...</div>;
    }

    if (!selectedWorkspace) {
      return (
        <div className="proof-empty">
          Create a text draft or upload a PDF to start the PDF {'->'} Text pipeline, then derive Lean4 and Rocq directly from the normalized text.
        </div>
      );
    }

    return (
      <>
        <div className="proof-editor-toolbar">
          <div style={{ flex: 1 }}>
            <input
              className="input-field"
              value={selectedWorkspace.title}
              onChange={(event) =>
                setSelectedWorkspace((current) =>
                  current
                    ? { ...current, title: event.target.value }
                    : current,
                )
              }
              placeholder="Workspace title"
            />
          </div>
          <span className="proof-badge">{selectedWorkspace.source_kind}</span>
          <span className="proof-badge">{selectedWorkspace.status}</span>
          <button
            type="button"
            className="button-secondary"
            onClick={handleRegenerateWorkspace}
            disabled={isSubmitting}
          >
            <RefreshCcw size={16} />
            Regenerate
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              onOpenLeanPlayground({
                code: selectedWorkspace.lean4_code,
                title: `${selectedWorkspace.title} · Lean4`,
              })
            }
            disabled={isSubmitting}
          >
            <Sparkles size={16} />
            Open in Lean Playground
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={handleSaveWorkspace}
            disabled={isSubmitting}
          >
            <Save size={16} />
            Save
          </button>
        </div>

        <div className="proof-tabs">
          {EDITOR_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'is-active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="proof-editor-layout">
          <div className="proof-editor-pane">
            <FormalCodeEditor
              language={activeEditorLanguage}
              title={activeEditorTitle}
              value={selectedWorkspace[activeTab]}
              onChange={handleEditorChange}
            />
          </div>

          <aside className="proof-infoview">
            <div className="proof-section-heading" style={{ marginBottom: '8px' }}>
              <CircleAlert size={16} color="var(--secondary-accent)" />
              <span>Infoview</span>
            </div>
            <div className="proof-infoview-items">
              {infoViewItems.map((item) => (
                <div key={`${item.label}-${item.detail}`} className="proof-infoview-card">
                  <div className="proof-infoview-label">{item.label}</div>
                  <div className="proof-infoview-detail">{item.detail}</div>
                </div>
              ))}
            </div>

            <div className="agent-feed">
              <div className="proof-section-heading" style={{ marginBottom: '8px' }}>
                <Bot size={16} color="var(--secondary-accent)" />
                <span>Multi-Agent Trace</span>
              </div>
              {selectedWorkspace.agent_trace.map((step, index) => (
                <div key={`${step.agent_id}-${step.timestamp}-${index}`} className="agent-step">
                  <div className="agent-step-header">
                    <strong>{step.agent_name}</strong>
                    <span>{step.stage}</span>
                  </div>
                  <p>{step.summary}</p>
                  <pre>{step.output_preview}</pre>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </>
    );
  };

  if (!currentUser) {
    return (
      <div className="proof-empty">
        <p style={{ marginBottom: '12px' }}>
          Sign in to upload a proof PDF, extract text, and generate Lean4 and Rocq drafts.
        </p>
        <button type="button" className="button-primary" onClick={onOpenAuth}>
          Open Login
        </button>
      </div>
    );
  }

  return (
    <div className="proof-workspace-shell">
      <div className="proof-sidebar-column">
        <div className="proof-card">
          <div className="proof-section-heading">
            <FileText size={16} color="var(--secondary-accent)" />
            <span>Proof Editor Input</span>
          </div>

          <input
            className="input-field"
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="Optional title for the new workspace"
          />
          <textarea
            className="proof-textarea proof-textarea-compact"
            value={draft.sourceText}
            onChange={(event) =>
              setDraft((current) => ({ ...current, sourceText: event.target.value }))
            }
            placeholder="Paste a theorem statement, informal proof, or proof sketch."
            spellCheck={false}
          />

          <div className="proof-action-row">
            <button
              type="button"
              className="button-primary"
              onClick={handleCreateFromText}
              disabled={isSubmitting}
            >
              <Code2 size={16} />
              Generate from Text
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={handleChoosePdf}
              disabled={isSubmitting}
            >
              <Upload size={16} />
              Upload PDF
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={handleUploadPdf}
            />
          </div>

          <p className="proof-helper-text">
            PDF uploads first become normalized text. Lean4 and Rocq drafts are then generated separately from that text.
          </p>
        </div>

        <div className="proof-card proof-list-card">
          <div className="proof-section-heading">
            <Upload size={16} color="var(--secondary-accent)" />
            <span>Your Workspaces</span>
          </div>

          {isLoadingList ? (
            <div className="proof-empty">Loading workspaces...</div>
          ) : workspaces.length === 0 ? (
            <div className="proof-empty">No uploaded proofs yet.</div>
          ) : (
            <div className="proof-list">
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  className={`proof-list-item ${
                    selectedWorkspaceId === workspace.id ? 'is-active' : ''
                  }`}
                  onClick={() => handleSelectWorkspace(workspace.id)}
                >
                  <div className="proof-list-item-title">{workspace.title}</div>
                  <div className="proof-list-item-meta">
                    <span>{workspace.source_kind}</span>
                    <span>{new Date(workspace.updated_at).toLocaleString()}</span>
                  </div>
                  {workspace.source_filename && (
                    <div className="proof-list-item-file">{workspace.source_filename}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="proof-main-panel">
        <div className="proof-section-heading">
          <Bot size={16} color="var(--secondary-accent)" />
          <span>Formalization Workspace</span>
        </div>
        {error && <div className="auth-error">{error}</div>}
        {renderWorkspaceEditor()}
      </div>
    </div>
  );
}
