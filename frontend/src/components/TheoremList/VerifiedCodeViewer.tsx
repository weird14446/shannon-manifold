import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  LoaderCircle,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';

import {
  deleteTheorem,
  type DiscussionThreadSummary,
  getTheoremDetail,
  getTheoremPdfMapping,
  getTheoremPdfUrl,
  type AuthUser,
  type IndexedProofDetail,
  type TheoremPdfMappingItem,
  updateTheorem,
} from '../../api';
import { useI18n } from '../../i18n';
import { DiscussionPanel, type DiscussionAnchorSelection } from '../Discussion/DiscussionPanel';
import {
  buildLeanDeclarationKey,
  LeanCodeHighlighter,
  type LeanDeclarationAnchor,
} from './LeanCodeHighlighter';

interface VerifiedCodeViewerProps {
  currentUser: AuthUser | null;
  documentId: number;
  onBack: () => void;
  onOpenAuth: () => void;
  onOpenPlayground: (seed: {
    code: string;
    title: string;
    proofWorkspaceId?: number | null;
    pdfFilename?: string | null;
    linkedPdfFilename?: string | null;
    linkedPdfPreviewUrl?: string | null;
    linkedPdfDownloadUrl?: string | null;
    projectSlug?: string | null;
    projectOwnerSlug?: string | null;
    projectTitle?: string | null;
    projectRoot?: string | null;
    packageName?: string | null;
    projectGithubUrl?: string | null;
    projectVisibility?: 'public' | 'private' | null;
    projectCanEdit?: boolean | null;
    projectFilePath?: string | null;
    projectModuleName?: string | null;
    projectEntryFilePath?: string | null;
    projectEntryModuleName?: string | null;
  }) => void;
}

export function VerifiedCodeViewer({
  currentUser,
  documentId,
  onBack,
  onOpenAuth,
  onOpenPlayground,
}: VerifiedCodeViewerProps) {
  const { t, formatDateTime } = useI18n();
  const [detail, setDetail] = useState<IndexedProofDetail | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [mappingItems, setMappingItems] = useState<TheoremPdfMappingItem[]>([]);
  const [hoveredMappingItem, setHoveredMappingItem] = useState<TheoremPdfMappingItem | null>(null);
  const [selectedPdfDiscussionItem, setSelectedPdfDiscussionItem] = useState<TheoremPdfMappingItem | null>(null);
  const [isLoadingMapping, setIsLoadingMapping] = useState(false);
  const [mappingError, setMappingError] = useState('');
  const [isDiscussionOpen, setIsDiscussionOpen] = useState(true);
  const [discussionTab, setDiscussionTab] = useState<'general' | 'code' | 'pdf'>('general');
  const [selectedDeclaration, setSelectedDeclaration] = useState<LeanDeclarationAnchor | null>(null);
  const [codeDiscussionThreads, setCodeDiscussionThreads] = useState<DiscussionThreadSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    const loadDetail = async () => {
      setIsLoading(true);
      setError('');
      setIsEditing(false);

      try {
        const response = await getTheoremDetail(documentId);
        if (isMounted) {
          setDetail(response);
          setDraftTitle(response.title);
          setDraftContent(response.content);
        }
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.response?.data?.detail ?? t('Failed to load the selected code entry.'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [documentId]);

  useEffect(() => {
    setDiscussionTab('general');
    setSelectedDeclaration(null);
    setSelectedPdfDiscussionItem(null);
    setCodeDiscussionThreads([]);
  }, [detail?.id]);

  const updatedAtLabel = useMemo(() => {
    if (!detail) {
      return '';
    }
    return formatDateTime(detail.updated_at);
  }, [detail, formatDateTime]);

  const handleOpenPlayground = () => {
    if (!detail) {
      return;
    }

    onOpenPlayground({
      code: detail.content,
      title: detail.title,
    });
  };

  const handleSave = async () => {
    if (!detail) {
      return;
    }

    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const updated = await updateTheorem(detail.id, {
        title: draftTitle.trim() || detail.title,
        content: draftContent,
      });
      setDetail(updated);
      setDraftTitle(updated.title);
      setDraftContent(updated.content);
      setIsEditing(false);
    } catch (saveError: any) {
      setError(saveError?.response?.data?.detail ?? t('Failed to save the code entry.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!detail) {
      return;
    }

    if (!currentUser) {
      onOpenAuth();
      return;
    }

    const confirmed = window.confirm(
      t('Delete "{title}" from the verified database?', { title: detail.title }),
    );
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setError('');

    try {
      await deleteTheorem(detail.id);
      onBack();
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail ?? t('Failed to delete the code entry.'));
    } finally {
      setIsDeleting(false);
    }
  };

  const pdfPreviewUrl = detail?.has_pdf ? getTheoremPdfUrl(detail.id) : null;
  const pdfDownloadUrl = detail?.has_pdf ? getTheoremPdfUrl(detail.id, true) : null;
  const hasPdfPreview = Boolean(detail?.has_pdf && pdfPreviewUrl && pdfDownloadUrl);

  useEffect(() => {
    let isMounted = true;

    if (!detail?.has_pdf) {
      setMappingItems([]);
      setHoveredMappingItem(null);
      setSelectedPdfDiscussionItem(null);
      setMappingError('');
      setIsLoadingMapping(false);
      return;
    }

    const loadMapping = async () => {
      setIsLoadingMapping(true);
      setMappingError('');
      try {
        const response = await getTheoremPdfMapping(detail.id);
        if (isMounted) {
          setMappingItems(response.items);
        }
      } catch (loadError: any) {
        if (isMounted) {
          setMappingItems([]);
          setMappingError(
            loadError?.response?.data?.detail ??
              t('Failed to load the PDF mapping for this code entry.'),
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingMapping(false);
        }
      }
    };

    void loadMapping();

    return () => {
      isMounted = false;
    };
  }, [detail?.has_pdf, detail?.id]);

  useEffect(() => {
    if (!hasPdfPreview && discussionTab === 'pdf') {
      setDiscussionTab('general');
    }
  }, [discussionTab, hasPdfPreview]);

  const selectedDeclarationKey = selectedDeclaration
    ? buildLeanDeclarationKey(selectedDeclaration.symbol_name, selectedDeclaration.start_line)
    : null;

  const codeDiscussionCounts = useMemo(() => {
    return codeDiscussionThreads.reduce<Record<string, number>>((accumulator, thread) => {
      const symbolName = String(thread.anchor_json.symbol_name ?? '');
      const startLine = Number(thread.anchor_json.start_line ?? 0);
      if (!symbolName || startLine <= 0) {
        return accumulator;
      }
      const key = buildLeanDeclarationKey(symbolName, startLine);
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
  }, [codeDiscussionThreads]);

  const theoremScopeKey = detail ? `theorem:${detail.id}` : '';
  const activePdfDiscussionItem = selectedPdfDiscussionItem ?? hoveredMappingItem;

  const codeAnchor = useMemo<DiscussionAnchorSelection | null>(() => {
    if (!detail || !selectedDeclaration) {
      return null;
    }
    return {
      anchor_type: 'lean_decl',
      label: `${selectedDeclaration.declaration_kind} ${selectedDeclaration.symbol_name}`,
      anchor_json: {
        document_id: detail.id,
        symbol_name: selectedDeclaration.symbol_name,
        declaration_kind: selectedDeclaration.declaration_kind,
        start_line: selectedDeclaration.start_line,
        end_line: selectedDeclaration.end_line,
      },
    };
  }, [detail, selectedDeclaration]);

  const pdfAnchor = useMemo<DiscussionAnchorSelection | null>(() => {
    if (!detail || !activePdfDiscussionItem || !activePdfDiscussionItem.pdf_page) {
      return null;
    }
    return {
      anchor_type: 'pdf_page',
      label: `Page ${activePdfDiscussionItem.pdf_page}${activePdfDiscussionItem.symbol_name ? ` · ${activePdfDiscussionItem.symbol_name}` : ''}`,
      anchor_json: {
        document_id: detail.id,
        pdf_page: activePdfDiscussionItem.pdf_page,
        pdf_excerpt: activePdfDiscussionItem.pdf_excerpt,
        symbol_name: activePdfDiscussionItem.symbol_name,
        declaration_kind: activePdfDiscussionItem.declaration_kind,
        start_line: activePdfDiscussionItem.start_line,
        end_line: activePdfDiscussionItem.end_line,
      },
    };
  }, [activePdfDiscussionItem, detail]);

  if (isLoading) {
    return (
      <section className="verified-code-screen glass-panel">
        <div className="theorem-empty-state">
          <LoaderCircle size={18} className="spin" />
          {t('Loading verified code...')}
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="verified-code-screen glass-panel">
        <div className="verified-code-header">
          <button type="button" className="button-secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            {t('Back to Database')}
          </button>
        </div>
        <div className="theorem-empty-state">
          {error || t('The requested code entry was not found.')}
        </div>
      </section>
    );
  }

  return (
    <section className="verified-code-screen glass-panel">
      <div className="verified-code-header">
        <div className="verified-code-heading">
          <div className="verified-code-kicker">
            <FileCode2 size={16} />
            {t('Verified Code Viewer')}
          </div>
          <h2>{detail.title}</h2>
          <p>
            {detail.path ?? detail.module_name ?? 'Workspace module'} · {updatedAtLabel}
          </p>
        </div>

        <div className="verified-code-actions">
          <button type="button" className="button-secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            {t('Back to Database')}
          </button>
          <button type="button" className="button-secondary" onClick={handleOpenPlayground}>
            <ExternalLink size={16} />
            {t('Remix to Playground')}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setIsDiscussionOpen((current) => !current)}
          >
            {isDiscussionOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            {isDiscussionOpen ? t('Hide Discussion') : t('Show Discussion')}
          </button>
          {detail.can_edit && (
            <>
              {isEditing ? (
                <button
                  type="button"
                  className="button-primary"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  <Save size={16} />
                  {isSaving ? t('Saving...') : t('Save Changes')}
                </button>
              ) : (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil size={16} />
                  {t('Edit')}
                </button>
              )}
            </>
          )}
          {detail.can_delete && (
            <>
              <button
                type="button"
                className="button-danger"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 size={16} />
                {isDeleting ? t('Deleting...') : t('Delete')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="verified-code-meta">
        <span className="proof-badge">{detail.proof_language}</span>
        <span className="proof-badge">
          {t('Cited by {count}', { count: detail.cited_by_count })}
        </span>
        <span className="proof-badge">{detail.status}</span>
        <span className="proof-badge">{detail.source_kind.replace(/_/g, ' ')}</span>
        <span className={detail.can_edit ? 'proof-badge' : 'proof-readonly-pill'}>
          {detail.can_edit ? (
            <>
              <Check size={12} />
              {t('Editable by you')}
            </>
          ) : (
            t('Read-only public code')
          )}
        </span>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {!detail.can_edit && (
        <div className="proof-readonly-note">
          {t(
            'This page is public, so anyone can inspect the code. Editing stays restricted to the owner, while deletion is available to the owner or an administrator.',
          )}
        </div>
      )}

      <div className={`verified-code-shell ${isDiscussionOpen ? 'has-discussion' : ''}`}>
        <div className="verified-code-content">
          <div className={`verified-code-layout ${hasPdfPreview ? 'has-pdf' : ''}`}>
            <div className="verified-code-panel">
              <div className="verified-code-kicker">
                <FileCode2 size={16} />
                {t('Lean Source')}
              </div>
              <div className="verified-code-scroll-shell">
                {isEditing ? (
                  <div className="verified-code-editor">
                    <label className="verified-code-field">
                      <span>{t('Title')}</span>
                      <input
                        className="input-field"
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        placeholder={t('Lean module title')}
                      />
                    </label>
                    <label className="verified-code-field verified-code-field-grow">
                      <span>{t('Lean Source')}</span>
                      <textarea
                        className="proof-textarea verified-code-textarea"
                        value={draftContent}
                        onChange={(event) => setDraftContent(event.target.value)}
                        spellCheck={false}
                      />
                    </label>
                  </div>
                ) : (
                  <LeanCodeHighlighter
                    code={detail.content}
                    mappingItems={mappingItems}
                    activeSymbolName={hoveredMappingItem?.symbol_name ?? selectedPdfDiscussionItem?.symbol_name ?? null}
                    onDeclarationHover={setHoveredMappingItem}
                    onDeclarationSelect={(declaration) => {
                      setSelectedDeclaration(declaration);
                      setDiscussionTab('code');
                      setIsDiscussionOpen(true);
                    }}
                    selectedDeclarationKey={selectedDeclarationKey}
                    declarationDiscussionCounts={codeDiscussionCounts}
                  />
                )}
              </div>
            </div>

            {hasPdfPreview && pdfPreviewUrl && pdfDownloadUrl && (
              <div className="verified-pdf-panel">
                <div className="verified-pdf-header">
                  <div>
                    <div className="verified-code-kicker">
                      <FileText size={16} />
                      {t('Source PDF')}
                    </div>
                    <p className="verified-pdf-copy">
                      {detail.pdf_filename ?? t('Original uploaded PDF')}
                    </p>
                  </div>
                  <div className="verified-code-actions">
                    <a
                      className="button-secondary"
                      href={pdfPreviewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={16} />
                      {t('Open PDF')}
                    </a>
                    <a className="button-secondary" href={pdfDownloadUrl}>
                      <Download size={16} />
                      {t('Download PDF')}
                    </a>
                  </div>
                </div>
                <div className="verified-pdf-mapping-card">
                  <div className="verified-pdf-mapping-kicker">{t('Lean ↔ PDF Mapping')}</div>
                  {isLoadingMapping ? (
                    <div className="verified-pdf-mapping-copy">
                      <LoaderCircle size={15} className="spin" />
                      {t('Generating PDF excerpts for the Lean declarations...')}
                    </div>
                  ) : mappingError ? (
                    <div className="verified-pdf-mapping-copy">{mappingError}</div>
                  ) : hoveredMappingItem ? (
                    <>
                      <div className="verified-pdf-mapping-header">
                        <strong>
                          {hoveredMappingItem.declaration_kind} {hoveredMappingItem.symbol_name}
                        </strong>
                        {hoveredMappingItem.pdf_page ? (
                          <span className="proof-badge">Page {hoveredMappingItem.pdf_page}</span>
                        ) : null}
                      </div>
                      <p className="verified-pdf-mapping-excerpt">{hoveredMappingItem.pdf_excerpt}</p>
                      {hoveredMappingItem.reason ? (
                        <p className="verified-pdf-mapping-reason">{hoveredMappingItem.reason}</p>
                      ) : null}
                      <div className="discussion-composer-actions">
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => {
                            setSelectedPdfDiscussionItem(hoveredMappingItem);
                            setDiscussionTab('pdf');
                            setIsDiscussionOpen(true);
                          }}
                        >
                          <MessageSquare size={16} />
                          {t('Discuss This Mapping')}
                        </button>
                      </div>
                    </>
                  ) : selectedPdfDiscussionItem ? (
                    <>
                      <div className="verified-pdf-mapping-header">
                        <strong>
                          {selectedPdfDiscussionItem.declaration_kind} {selectedPdfDiscussionItem.symbol_name}
                        </strong>
                        {selectedPdfDiscussionItem.pdf_page ? (
                          <span className="proof-badge">Page {selectedPdfDiscussionItem.pdf_page}</span>
                        ) : null}
                      </div>
                      <p className="verified-pdf-mapping-excerpt">
                        {selectedPdfDiscussionItem.pdf_excerpt}
                      </p>
                    </>
                  ) : mappingItems.length > 0 ? (
                    <div className="verified-pdf-mapping-copy">
                      {t(
                        'Hover a mapped Lean declaration to preview the corresponding PDF excerpt here.',
                      )}
                    </div>
                  ) : (
                    <div className="verified-pdf-mapping-copy">
                      {t('No PDF mapping could be generated for the current Lean declarations yet.')}
                    </div>
                  )}
                </div>
                <iframe
                  className="verified-pdf-frame"
                  src={pdfPreviewUrl}
                  title={`${detail.title} PDF preview`}
                />
              </div>
            )}
          </div>
        </div>

        {isDiscussionOpen ? (
          <aside className="verified-discussion-drawer">
            <div className="discussion-tab-bar">
              <button
                type="button"
                className={`discussion-tab ${discussionTab === 'general' ? 'is-active' : ''}`}
                onClick={() => setDiscussionTab('general')}
              >
                {t('General')}
              </button>
              <button
                type="button"
                className={`discussion-tab ${discussionTab === 'code' ? 'is-active' : ''}`}
                onClick={() => setDiscussionTab('code')}
              >
                {t('Code')}
              </button>
              {hasPdfPreview ? (
                <button
                  type="button"
                  className={`discussion-tab ${discussionTab === 'pdf' ? 'is-active' : ''}`}
                  onClick={() => setDiscussionTab('pdf')}
                >
                  {t('PDF')}
                </button>
              ) : null}
            </div>

            {discussionTab === 'general' ? (
              <DiscussionPanel
                title={t('Theorem Discussion')}
                currentUser={currentUser}
                onOpenAuth={onOpenAuth}
                scopeType="theorem"
                scopeKey={theoremScopeKey}
                anchorType="general"
                emptyMessage={t('No theorem-wide discussion has started yet.')}
              />
            ) : null}

            {discussionTab === 'code' ? (
              <DiscussionPanel
                title={t('Code Discussions')}
                currentUser={currentUser}
                onOpenAuth={onOpenAuth}
                scopeType="theorem"
                scopeKey={theoremScopeKey}
                anchorType="lean_decl"
                currentAnchor={codeAnchor}
                emptyMessage={
                  codeAnchor
                    ? t('No discussion threads exist for the selected declaration yet.')
                    : t('No declaration discussions exist for this theorem yet.')
                }
                selectionRequiredMessage={t(
                  'Click a theorem / lemma / def declaration in the Lean source to start a thread for it.',
                )}
                onSummariesChange={setCodeDiscussionThreads}
              />
            ) : null}

            {discussionTab === 'pdf' && hasPdfPreview ? (
              <DiscussionPanel
                title={t('PDF Discussions')}
                currentUser={currentUser}
                onOpenAuth={onOpenAuth}
                scopeType="theorem"
                scopeKey={theoremScopeKey}
                anchorType="pdf_page"
                currentAnchor={pdfAnchor}
                emptyMessage={
                  pdfAnchor
                    ? t('No discussion threads exist for the selected PDF anchor yet.')
                    : t('No PDF discussions exist for this theorem yet.')
                }
                selectionRequiredMessage={t(
                  'Use a mapped PDF excerpt from the PDF panel to anchor a discussion thread.',
                )}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
