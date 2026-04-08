import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenText,
  LoaderCircle,
  PenSquare,
  Search,
  Sparkles,
  Telescope,
} from 'lucide-react';

import {
  listCommunityPosts,
  type AuthUser,
  type CommunityArtifact,
  type CommunityCategory,
  type CommunityPostSummary,
} from '../../api';
import { useI18n } from '../../i18n';

interface CommunityHomeProps {
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onOpenPost: (postId: number) => void;
  onCompose: () => void;
}

const COMMUNITY_CATEGORIES: Array<{ value: 'all' | CommunityCategory; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'note', label: 'Notes' },
  { value: 'theorem_review', label: 'Theorem Reviews' },
  { value: 'project_log', label: 'Project Logs' },
  { value: 'paper', label: 'Papers' },
  { value: 'essay', label: 'Essays' },
];

const CATEGORY_LABELS: Record<CommunityCategory, string> = {
  note: 'Note',
  theorem_review: 'Theorem Review',
  project_log: 'Project Log',
  paper: 'Paper',
  essay: 'Essay',
};

export function CommunityHome({
  currentUser,
  onOpenAuth,
  onOpenPost,
  onCompose,
}: CommunityHomeProps) {
  const { t, formatDate } = useI18n();
  const [posts, setPosts] = useState<CommunityPostSummary[]>([]);
  const [drafts, setDrafts] = useState<CommunityPostSummary[]>([]);
  const [category, setCategory] = useState<'all' | CommunityCategory>('all');
  const [search, setSearch] = useState('');
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadPosts = async () => {
      setIsLoadingPosts(true);
      setError('');
      try {
        const response = await listCommunityPosts({
          category: category === 'all' ? null : category,
          search: search.trim() || null,
        });
        if (isMounted) {
          setPosts(response);
        }
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.response?.data?.detail ?? t('Failed to load community posts.'));
          setPosts([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingPosts(false);
        }
      }
    };

    void loadPosts();
    return () => {
      isMounted = false;
    };
  }, [category, search]);

  useEffect(() => {
    if (!currentUser) {
      setDrafts([]);
      setIsLoadingDrafts(false);
      return;
    }
    let isMounted = true;
    const loadDrafts = async () => {
      setIsLoadingDrafts(true);
      try {
        const response = await listCommunityPosts({
          status: 'draft',
          author_id: currentUser.id,
        });
        if (isMounted) {
          setDrafts(response);
        }
      } catch {
        if (isMounted) {
          setDrafts([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingDrafts(false);
        }
      }
    };
    void loadDrafts();
    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  const heroPost = useMemo(
    () => posts.find((post) => post.is_featured) ?? posts[0] ?? null,
    [posts],
  );

  const archivePosts = useMemo(
    () => posts.filter((post) => post.id !== heroPost?.id),
    [heroPost?.id, posts],
  );

  const referencedArtifacts = useMemo(() => {
    const items = new Map<string, CommunityArtifact>();
    const addArtifact = (artifact: CommunityArtifact | null) => {
      if (!artifact) {
        return;
      }
      const key = `${artifact.artifact_type}:${artifact.artifact_ref}`;
      if (!items.has(key)) {
        items.set(key, artifact);
      }
    };
    posts.forEach((post) => {
      addArtifact(post.primary_artifact);
      post.related_artifacts.forEach(addArtifact);
    });
    return [...items.values()].slice(0, 8);
  }, [posts]);

  return (
    <section className="community-screen">
      <div className="community-shell">
        <header className="glass-panel community-hero-shell">
          <div className="community-hero-copy">
            <div className="community-kicker">
              <BookOpenText size={16} />
              {t('Community Journal')}
            </div>
            <h2>{t('Long-form mathematical notes, reviews, and project logs.')}</h2>
            <p>
              {t(
                'Publish journal-style posts that cite verified theorems and projects without losing the artifact-first workflow of Shannon Manifold.',
              )}
            </p>
            <div className="community-hero-actions">
              <button
                type="button"
                className="button-primary"
                onClick={currentUser ? onCompose : onOpenAuth}
              >
                <PenSquare size={16} />
                {t('Write a Post')}
              </button>
              <div className="community-hero-note">
                {currentUser
                  ? t('Drafts stay private until you publish.')
                  : t('Published posts are public. Sign in to write and comment.')}
              </div>
            </div>
          </div>
          <div className="community-hero-stats">
            <div className="community-hero-stat">
              <span>{t('Published')}</span>
              <strong>{posts.length}</strong>
            </div>
            <div className="community-hero-stat">
              <span>{t('Drafts')}</span>
              <strong>{currentUser ? drafts.length : '—'}</strong>
            </div>
            <div className="community-hero-stat">
              <span>{t('Referenced Artifacts')}</span>
              <strong>{referencedArtifacts.length}</strong>
            </div>
          </div>
        </header>

        <div className="glass-panel community-filter-bar">
          <div className="community-chip-row">
            {COMMUNITY_CATEGORIES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`community-chip ${category === item.value ? 'is-active' : ''}`}
              onClick={() => setCategory(item.value)}
            >
                {item.value === 'all' ? t('All') : t(item.label)}
              </button>
            ))}
          </div>
          <label className="community-search-field">
            <Search size={16} />
            <input
              className="input-field"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Search titles, summaries, and markdown...')}
            />
          </label>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}

        <div className="community-grid">
          <div className="community-main-column">
            {isLoadingPosts ? (
              <div className="glass-panel theorem-empty-state">
                <LoaderCircle size={18} className="spin" />
                {t('Loading community posts...')}
              </div>
            ) : heroPost ? (
              <button
                type="button"
                className="glass-panel community-featured-card"
                onClick={() => onOpenPost(heroPost.id)}
              >
                <div className="community-featured-header">
                  <div className="community-kicker">
                    <Sparkles size={16} />
                    {heroPost.is_featured ? t('Featured Post') : t('Latest Post')}
                  </div>
                  <div className="community-card-meta">
                    {t(CATEGORY_LABELS[heroPost.category])} · {formatDate(heroPost.published_at)}
                  </div>
                </div>
                <h3>{heroPost.title}</h3>
                <p>{heroPost.summary}</p>
                <div className="community-card-tags">
                  {heroPost.tags.map((tag) => (
                    <span key={tag} className="proof-badge">
                      {tag}
                    </span>
                  ))}
                  {heroPost.primary_artifact ? (
                    <span className="proof-badge">
                      {heroPost.primary_artifact.artifact_type === 'theorem'
                        ? t('Theorem')
                        : t('Project')}
                    </span>
                  ) : null}
                </div>
                <div className="community-card-footer">
                  <span>{heroPost.author_name}</span>
                  <span>{t('{count} comments', { count: String(heroPost.comment_count) })}</span>
                </div>
              </button>
            ) : (
              <div className="glass-panel theorem-empty-state">
                {t('No published community posts match the current filters.')}
              </div>
            )}

            <section className="community-archive-section">
              <div className="community-section-header">
                <div className="community-kicker">
                  <Telescope size={16} />
                  {t('Latest Archive')}
                </div>
                <p className="community-section-copy">
                  {t('Browse recent long-form notes, theorem reviews, papers, and project logs.')}
                </p>
              </div>
              <div className="community-archive-list">
                {archivePosts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className="glass-panel community-post-card"
                    onClick={() => onOpenPost(post.id)}
                  >
                    <div className="community-post-card-head">
                      <div>
                        <div className="community-post-card-title">{post.title}</div>
                        <div className="community-card-meta">
                          {post.author_name} · {formatDate(post.published_at)}
                        </div>
                      </div>
                      <div className="community-card-badges">
                        <span className="proof-badge">{t(CATEGORY_LABELS[post.category])}</span>
                        {post.is_featured ? <span className="proof-badge">{t('Featured')}</span> : null}
                      </div>
                    </div>
                    <p className="community-post-card-summary">{post.summary}</p>
                    <div className="community-card-tags">
                      {post.tags.map((tag) => (
                        <span key={tag} className="proof-badge">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="community-card-footer">
                      <span>{t('{count} comments', { count: String(post.comment_count) })}</span>
                      {post.primary_artifact ? <span>{post.primary_artifact.title}</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside className="community-side-column">
            {currentUser ? (
              <section className="glass-panel community-side-panel">
                <div className="community-section-header">
                  <div className="community-kicker">
                    <PenSquare size={16} />
                    {t('My Drafts')}
                  </div>
                  <p className="community-section-copy">
                    {t('Private drafts stay visible only to you until they are published.')}
                  </p>
                </div>
                {isLoadingDrafts ? (
                  <div className="theorem-empty-state">
                    <LoaderCircle size={16} className="spin" />
                    {t('Loading drafts...')}
                  </div>
                ) : drafts.length === 0 ? (
                  <div className="community-empty-state">{t('No private drafts yet.')}</div>
                ) : (
                  <div className="community-side-list">
                    {drafts.map((post) => (
                      <button
                        key={post.id}
                        type="button"
                        className="community-side-item"
                        onClick={() => onOpenPost(post.id)}
                      >
                        <strong>{post.title}</strong>
                        <span>{t(CATEGORY_LABELS[post.category])}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            <section className="glass-panel community-side-panel">
                <div className="community-section-header">
                  <div className="community-kicker">
                    <Telescope size={16} />
                    {t('Referenced Artifacts')}
                  </div>
                  <p className="community-section-copy">
                    {t('Community posts can point back to verified theorems and projects.')}
                  </p>
                </div>
              {referencedArtifacts.length === 0 ? (
                <div className="community-empty-state">
                  {t('No theorem or project references are visible in the current archive.')}
                </div>
              ) : (
                <div className="community-side-list">
                  {referencedArtifacts.map((artifact) => (
                    <div
                      key={`${artifact.artifact_type}:${artifact.artifact_ref}`}
                      className="community-side-item is-static"
                    >
                      <strong>{artifact.title}</strong>
                      <span>
                        {artifact.artifact_type === 'theorem' ? t('Theorem') : t('Project')} · {artifact.subtitle}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
