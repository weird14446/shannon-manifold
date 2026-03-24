import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  LoaderCircle,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';

import {
  deleteTheorem,
  getTheoremDetail,
  getTheoremPdfMapping,
  getTheoremPdfUrl,
  type AuthUser,
  type IndexedProofDetail,
  type TheoremPdfMappingItem,
  updateTheorem,
} from '../../api';
import { LeanCodeHighlighter } from './LeanCodeHighlighter';

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
  }) => void;
}

export function VerifiedCodeViewer({
  currentUser,
  documentId,
  onBack,
  onOpenAuth,
  onOpenPlayground,
}: VerifiedCodeViewerProps) {
  const [detail, setDetail] = useState<IndexedProofDetail | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [mappingItems, setMappingItems] = useState<TheoremPdfMappingItem[]>([]);
  const [hoveredMappingItem, setHoveredMappingItem] = useState<TheoremPdfMappingItem | null>(null);
  const [isLoadingMapping, setIsLoadingMapping] = useState(false);
  const [mappingError, setMappingError] = useState('');
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
          setError(loadError?.response?.data?.detail ?? 'Failed to load the selected code entry.');
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

  const updatedAtLabel = useMemo(() => {
    if (!detail) {
      return '';
    }
    return new Date(detail.updated_at).toLocaleString();
  }, [detail]);

  const handleOpenPlayground = () => {
    if (!detail) {
      return;
    }

    onOpenPlayground({
      code: detail.content,
      title: detail.title,
      proofWorkspaceId: detail.proof_workspace_id,
      pdfFilename: detail.pdf_filename,
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
      setError(saveError?.response?.data?.detail ?? 'Failed to save the code entry.');
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

    const confirmed = window.confirm(`Delete "${detail.title}" from the verified database?`);
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setError('');

    try {
      await deleteTheorem(detail.id);
      onBack();
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail ?? 'Failed to delete the code entry.');
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
            loadError?.response?.data?.detail ?? 'Failed to load the PDF mapping for this code entry.',
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

  if (isLoading) {
    return (
      <section className="verified-code-screen glass-panel">
        <div className="theorem-empty-state">
          <LoaderCircle size={18} className="spin" />
          Loading verified code...
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
            Back to Database
          </button>
        </div>
        <div className="theorem-empty-state">{error || 'The requested code entry was not found.'}</div>
      </section>
    );
  }

  return (
    <section className="verified-code-screen glass-panel">
      <div className="verified-code-header">
        <div className="verified-code-heading">
          <div className="verified-code-kicker">
            <FileCode2 size={16} />
            Verified Code Viewer
          </div>
          <h2>{detail.title}</h2>
          <p>
            {detail.path ?? detail.module_name ?? 'Workspace module'} · {updatedAtLabel}
          </p>
        </div>

        <div className="verified-code-actions">
          <button type="button" className="button-secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to Database
          </button>
          <button type="button" className="button-secondary" onClick={handleOpenPlayground}>
            <ExternalLink size={16} />
            Open in Lean Playground
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
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              ) : (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil size={16} />
                  Edit
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
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="verified-code-meta">
        <span className="proof-badge">{detail.proof_language}</span>
        <span className="proof-badge">{detail.status}</span>
        <span className="proof-badge">{detail.source_kind.replace(/_/g, ' ')}</span>
        <span className={detail.can_edit ? 'proof-badge' : 'proof-readonly-pill'}>
          {detail.can_edit ? (
            <>
              <Check size={12} />
              Editable by you
            </>
          ) : (
            'Read-only public code'
          )}
        </span>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {!detail.can_edit && (
        <div className="proof-readonly-note">
          This page is public, so anyone can inspect the code. Editing stays restricted to the
          owner, while deletion is available to the owner or an administrator.
        </div>
      )}

      <div className={`verified-code-layout ${hasPdfPreview ? 'has-pdf' : ''}`}>
        <div className="verified-code-panel">
          <div className="verified-code-kicker">
            <FileCode2 size={16} />
            Lean Source
          </div>
          {isEditing ? (
            <div className="verified-code-editor">
              <label className="verified-code-field">
                <span>Title</span>
                <input
                  className="input-field"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder="Lean module title"
                />
              </label>
              <label className="verified-code-field verified-code-field-grow">
                <span>Lean Source</span>
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
              activeSymbolName={hoveredMappingItem?.symbol_name ?? null}
              onDeclarationHover={setHoveredMappingItem}
            />
          )}
        </div>

        {hasPdfPreview && pdfPreviewUrl && pdfDownloadUrl && (
          <div className="verified-pdf-panel">
            <div className="verified-pdf-header">
              <div>
                <div className="verified-code-kicker">
                  <FileText size={16} />
                  Source PDF
                </div>
                <p className="verified-pdf-copy">
                  {detail.pdf_filename ?? 'Original uploaded PDF'}
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
                  Open PDF
                </a>
                <a className="button-secondary" href={pdfDownloadUrl}>
                  <Download size={16} />
                  Download PDF
                </a>
              </div>
            </div>
            <div className="verified-pdf-mapping-card">
              <div className="verified-pdf-mapping-kicker">Lean ↔ PDF Mapping</div>
              {isLoadingMapping ? (
                <div className="verified-pdf-mapping-copy">
                  <LoaderCircle size={15} className="spin" />
                  Generating PDF excerpts for the Lean declarations...
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
                </>
              ) : mappingItems.length > 0 ? (
                <div className="verified-pdf-mapping-copy">
                  Hover a mapped Lean declaration to preview the corresponding PDF excerpt here.
                </div>
              ) : (
                <div className="verified-pdf-mapping-copy">
                  No PDF mapping could be generated for the current Lean declarations yet.
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
    </section>
  );
}
