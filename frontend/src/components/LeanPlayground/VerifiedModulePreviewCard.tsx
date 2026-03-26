import { FileCode2, FileText, LoaderCircle, X } from 'lucide-react';

import { getTheoremPdfUrl, type IndexedProofDetail } from '../../api';
import { LeanCodeHighlighter } from '../TheoremList/LeanCodeHighlighter';

interface VerifiedModulePreviewCardProps {
  detail: IndexedProofDetail | null;
  error: string;
  isLoading: boolean;
  modulePath: string | null;
  onClose: () => void;
  onRemix: () => void;
}

export function VerifiedModulePreviewCard({
  detail,
  error,
  isLoading,
  modulePath,
  onClose,
  onRemix,
}: VerifiedModulePreviewCardProps) {
  if (!detail && !error && !isLoading) {
    return null;
  }

  const updatedAtLabel = detail ? new Date(detail.updated_at).toLocaleString() : '';
  const pdfPreviewUrl = detail?.has_pdf ? getTheoremPdfUrl(detail.id) : null;

  return (
    <div className="playground-module-preview-overlay" onClick={onClose}>
      <article
        className="glass-panel playground-module-preview-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="playground-module-preview-header">
          <div className="playground-module-preview-heading">
            <div className="verified-code-kicker">
              <FileCode2 size={16} />
              Verified Module
            </div>
            <h3>{detail?.title ?? modulePath ?? 'Verified module'}</h3>
            <p>{detail?.path ?? detail?.module_name ?? modulePath ?? 'Project module'}</p>
          </div>
          <button
            type="button"
            className="playground-module-preview-close"
            onClick={onClose}
            aria-label="Close module preview"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="theorem-empty-state">
            <LoaderCircle size={18} className="spin" />
            Loading verified module...
          </div>
        ) : error ? (
          <div className="theorem-empty-state">{error}</div>
        ) : detail ? (
          <>
            <div className="playground-module-preview-meta">
              <span className="proof-badge">{detail.proof_language}</span>
              <span className="proof-badge">{detail.is_verified ? 'verified' : 'draft'}</span>
              {detail.project_title && <span className="proof-badge">{detail.project_title}</span>}
              {detail.has_pdf && <span className="proof-badge">pdf</span>}
              <span className="proof-badge">{updatedAtLabel}</span>
            </div>

            {detail.has_pdf && pdfPreviewUrl && (
              <div className="playground-module-preview-actions">
                <a
                  className="button-secondary"
                  href={pdfPreviewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileText size={16} />
                  Open PDF
                </a>
              </div>
            )}

            <div className="playground-module-preview-body">
              <LeanCodeHighlighter code={detail.content} />
            </div>

            <div className="playground-module-preview-footer">
              <button type="button" className="button-secondary" onClick={onRemix}>
                Remix this module
              </button>
              <button type="button" className="button-primary" onClick={onClose}>
                Return to Playground
              </button>
            </div>
          </>
        ) : null}
      </article>
    </div>
  );
}
