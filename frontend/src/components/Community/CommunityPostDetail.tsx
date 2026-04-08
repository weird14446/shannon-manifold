import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  LoaderCircle,
  Pin,
  PinOff,
  Pencil,
  SendToBack,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

import {
  deleteCommunityPost,
  featureCommunityPost,
  getCommunityPost,
  publishCommunityPost,
  type AuthUser,
  type CommunityArtifact,
  type CommunityCategory,
  type CommunityPostDetail as CommunityPostDetailType,
} from '../../api';
import { useI18n } from '../../i18n';
import { CommunityComments } from './CommunityComments';

interface CommunityPostDetailProps {
  postId: number;
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onBack: () => void;
  onOpenProof: (documentId: number) => void;
  onOpenProject: (ownerSlug: string, projectSlug: string) => void;
  onEditPost: (postId: number) => void;
  onDeleted: () => void;
}

const CATEGORY_LABELS: Record<CommunityCategory, string> = {
  note: 'Note',
  theorem_review: 'Theorem Review',
  project_log: 'Project Log',
  paper: 'Paper',
  essay: 'Essay',
};

export function CommunityPostDetail({
  postId,
  currentUser,
  onOpenAuth,
  onBack,
  onOpenProof,
  onOpenProject,
  onEditPost,
  onDeleted,
}: CommunityPostDetailProps) {
  const { t, formatDateTime } = useI18n();
  const [post, setPost] = useState<CommunityPostDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isFeaturing, setIsFeaturing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadPost = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await getCommunityPost(postId);
        if (isMounted) {
          setPost(response);
        }
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.response?.data?.detail ?? t('Failed to load the community post.'));
          setPost(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    void loadPost();
    return () => {
      isMounted = false;
    };
  }, [postId]);

  const linkedArtifacts = useMemo(() => {
    if (!post) {
      return [];
    }
    const items: CommunityArtifact[] = [];
    if (post.primary_artifact) {
      items.push(post.primary_artifact);
    }
    for (const item of post.related_artifacts) {
      if (!items.some((candidate) => `${candidate.artifact_type}:${candidate.artifact_ref}` === `${item.artifact_type}:${item.artifact_ref}`)) {
        items.push(item);
      }
    }
    return items;
  }, [post]);

  const handleOpenArtifact = (artifact: CommunityArtifact) => {
    if (artifact.artifact_type === 'theorem' && artifact.theorem_id) {
      onOpenProof(artifact.theorem_id);
      return;
    }
    if (
      artifact.artifact_type === 'project' &&
      artifact.project_owner_slug &&
      artifact.project_slug
    ) {
      onOpenProject(artifact.project_owner_slug, artifact.project_slug);
    }
  };

  const handleTogglePublished = async () => {
    if (!post) {
      return;
    }
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    setIsPublishing(true);
    setError('');
    try {
      const response = await publishCommunityPost(post.id, post.status !== 'published');
      setPost(response);
    } catch (publishError: any) {
      setError(publishError?.response?.data?.detail ?? t('Failed to change the publishing state.'));
    } finally {
      setIsPublishing(false);
    }
  };

  const handleToggleFeatured = async () => {
    if (!post) {
      return;
    }
    setIsFeaturing(true);
    setError('');
    try {
      const response = await featureCommunityPost(post.id, !post.is_featured);
      setPost(response);
    } catch (featureError: any) {
      setError(featureError?.response?.data?.detail ?? t('Failed to update the featured state.'));
    } finally {
      setIsFeaturing(false);
    }
  };

  const handleDeletePost = async () => {
    if (!post) {
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm(t('Delete "{title}"?', { title: post.title }))) {
      return;
    }
    setIsDeleting(true);
    setError('');
    try {
      await deleteCommunityPost(post.id);
      onDeleted();
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail ?? t('Failed to delete the post.'));
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <section className="community-screen">
        <div className="community-shell">
          <div className="glass-panel theorem-empty-state">
            <LoaderCircle size={18} className="spin" />
            {t('Loading community post...')}
          </div>
        </div>
      </section>
    );
  }

  if (!post) {
    return (
      <section className="community-screen">
        <div className="community-shell">
          <div className="glass-panel community-detail-empty">
            <button type="button" className="button-secondary" onClick={onBack}>
              <ArrowLeft size={16} />
              {t('Back to Community')}
            </button>
            <div className="theorem-empty-state">{error || t('Community post not found.')}</div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="community-screen">
      <div className="community-shell community-detail-shell">
        <div className="community-detail-column">
          <article className="glass-panel community-article-card">
            <div className="community-article-header">
              <div>
                <div className="community-kicker">{t('Community Post')}</div>
                <h2>{post.title}</h2>
                <div className="community-article-meta">
                  <span>{post.author_name}</span>
                  <span>{t(CATEGORY_LABELS[post.category])}</span>
                  <span>{formatDateTime(post.published_at || post.updated_at)}</span>
                  <span>{t('{count} comments', { count: String(post.comment_count) })}</span>
                </div>
              </div>
              <div className="community-detail-actions">
                <button type="button" className="button-secondary" onClick={onBack}>
                  <ArrowLeft size={16} />
                  {t('Back to Community')}
                </button>
                {post.can_edit ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => onEditPost(post.id)}
                  >
                    <Pencil size={16} />
                    {t('Edit')}
                  </button>
                ) : null}
                {post.can_publish ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void handleTogglePublished()}
                    disabled={isPublishing}
                  >
                    {isPublishing ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <SendToBack size={16} />
                    )}
                    {post.status === 'published' ? t('Unpublish') : t('Publish')}
                  </button>
                ) : null}
                {post.can_feature && post.status === 'published' ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void handleToggleFeatured()}
                    disabled={isFeaturing}
                  >
                    {isFeaturing ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : post.is_featured ? (
                      <PinOff size={16} />
                    ) : (
                      <Pin size={16} />
                    )}
                    {post.is_featured ? t('Unfeature') : t('Feature')}
                  </button>
                ) : null}
                {post.can_delete ? (
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => void handleDeletePost()}
                    disabled={isDeleting}
                  >
                    {isDeleting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
                    {t('Delete')}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="community-card-tags">
              <span className="proof-badge">{t(CATEGORY_LABELS[post.category])}</span>
              <span className="proof-badge">{t(post.status === 'published' ? 'Published' : 'Draft')}</span>
              {post.is_featured ? <span className="proof-badge">{t('Featured')}</span> : null}
              {post.tags.map((tag) => (
                <span key={tag} className="proof-badge">
                  {tag}
                </span>
              ))}
            </div>

            {error ? <div className="auth-error">{error}</div> : null}

            <div className="community-article-summary">{post.summary}</div>
            <div className="community-markdown-body">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {post.content_markdown}
              </ReactMarkdown>
            </div>
          </article>

          <CommunityComments
            postId={post.id}
            currentUser={currentUser}
            onOpenAuth={onOpenAuth}
            canComment={post.can_comment}
          />
        </div>

        <aside className="community-detail-side">
          <section className="glass-panel community-side-panel">
            <div className="community-section-header">
              <div className="community-kicker">
                <ExternalLink size={16} />
                {t('Linked Artifacts')}
              </div>
              <p className="community-section-copy">
                {t('Theorem and project references that ground this journal entry in the platform.')}
              </p>
            </div>
            {linkedArtifacts.length === 0 ? (
              <div className="community-empty-state">{t('No theorem or project references were attached.')}</div>
            ) : (
              <div className="community-linked-artifact-list">
                {linkedArtifacts.map((artifact) => (
                  <button
                    key={`${artifact.artifact_type}:${artifact.artifact_ref}`}
                    type="button"
                    className="community-artifact-card"
                    onClick={() => handleOpenArtifact(artifact)}
                  >
                    <div className="community-card-meta">
                      {t(artifact.artifact_type === 'theorem' ? 'Verified theorem' : 'Project')}
                    </div>
                    <strong>{artifact.title}</strong>
                    <span>{artifact.subtitle}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
