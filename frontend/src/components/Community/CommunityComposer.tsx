import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Link2, LoaderCircle, Save, Search, SendToBack, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

import {
  createCommunityPost,
  getCommunityPost,
  getTheorems,
  listProjects,
  publishCommunityPost,
  updateCommunityPost,
  type AuthUser,
  type CommunityCategory,
  type IndexedProofSummary,
  type ProjectSummary,
} from '../../api';
import { useI18n } from '../../i18n';

interface CommunityComposerProps {
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  postId?: number | null;
  onCancel: () => void;
  onSaved: (postId: number) => void;
}

interface ArtifactCandidate {
  key: string;
  artifact_type: 'theorem' | 'project';
  artifact_ref: string;
  title: string;
  subtitle: string;
}

const COMMUNITY_CATEGORIES: Array<{ value: CommunityCategory; label: string }> = [
  { value: 'note', label: 'Note' },
  { value: 'theorem_review', label: 'Theorem Review' },
  { value: 'project_log', label: 'Project Log' },
  { value: 'paper', label: 'Paper' },
  { value: 'essay', label: 'Essay' },
];

const buildArtifactCandidateLabel = (candidate: ArtifactCandidate) =>
  candidate.artifact_type === 'theorem' ? 'Theorem' : 'Project';

const parseTagInput = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toArtifactPayload = (artifact: ArtifactCandidate | null) =>
  artifact
    ? {
        artifact_type: artifact.artifact_type,
        artifact_ref: artifact.artifact_ref,
      }
    : null;

export function CommunityComposer({
  currentUser,
  onOpenAuth,
  postId = null,
  onCancel,
  onSaved,
}: CommunityComposerProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [contentMarkdown, setContentMarkdown] = useState('');
  const [category, setCategory] = useState<CommunityCategory>('note');
  const [tagsInput, setTagsInput] = useState('');
  const [primaryArtifact, setPrimaryArtifact] = useState<ArtifactCandidate | null>(null);
  const [relatedArtifacts, setRelatedArtifacts] = useState<ArtifactCandidate[]>([]);
  const [artifactSearch, setArtifactSearch] = useState('');
  const [relatedSearch, setRelatedSearch] = useState('');
  const [artifactCandidates, setArtifactCandidates] = useState<ArtifactCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(postId));
  const [isLoadingArtifacts, setIsLoadingArtifacts] = useState(true);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    let isMounted = true;
    const loadArtifacts = async () => {
      setIsLoadingArtifacts(true);
      try {
        const [theorems, projects] = await Promise.all([getTheorems(), listProjects()]);
        if (!isMounted) {
          return;
        }
        const theoremCandidates: ArtifactCandidate[] = theorems.map((theorem: IndexedProofSummary) => ({
          key: `theorem:${theorem.id}`,
          artifact_type: 'theorem',
          artifact_ref: String(theorem.id),
          title: theorem.title,
          subtitle: theorem.module_name ?? theorem.path ?? theorem.statement,
        }));
        const projectCandidates: ArtifactCandidate[] = projects.map((project: ProjectSummary) => ({
          key: `project:${project.project_root}`,
          artifact_type: 'project',
          artifact_ref: project.project_root,
          title: project.title,
          subtitle: project.entry_module_name,
        }));
        setArtifactCandidates([...theoremCandidates, ...projectCandidates]);
      } catch {
        if (isMounted) {
          setArtifactCandidates([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingArtifacts(false);
        }
      }
    };
    void loadArtifacts();
    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!postId) {
      return;
    }
    let isMounted = true;
    const loadPost = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await getCommunityPost(postId);
        if (!isMounted) {
          return;
        }
        setTitle(response.title);
        setSummary(response.summary);
        setContentMarkdown(response.content_markdown);
        setCategory(response.category);
        setTagsInput(response.tags.join(', '));
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.response?.data?.detail ?? t('Failed to load the selected post.'));
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

  useEffect(() => {
    if (!postId || artifactCandidates.length === 0) {
      return;
    }
    let isMounted = true;
    const loadArtifactSelections = async () => {
      try {
        const response = await getCommunityPost(postId);
        if (!isMounted) {
          return;
        }
        const candidateByKey = new Map(
          artifactCandidates.map((candidate) => [candidate.key, candidate]),
        );
        const primaryKey = response.primary_artifact
          ? `${response.primary_artifact.artifact_type}:${response.primary_artifact.artifact_ref}`
          : null;
        setPrimaryArtifact(primaryKey ? candidateByKey.get(primaryKey) ?? null : null);
        setRelatedArtifacts(
          response.related_artifacts
            .map((artifact) => candidateByKey.get(`${artifact.artifact_type}:${artifact.artifact_ref}`))
            .filter((artifact): artifact is ArtifactCandidate => Boolean(artifact)),
        );
      } catch {
        if (isMounted) {
          setPrimaryArtifact(null);
          setRelatedArtifacts([]);
        }
      }
    };
    void loadArtifactSelections();
    return () => {
      isMounted = false;
    };
  }, [artifactCandidates, postId]);

  const filteredPrimaryCandidates = useMemo(() => {
    const needle = artifactSearch.trim().toLowerCase();
    return artifactCandidates
      .filter((candidate) =>
        !needle
          || `${candidate.title} ${candidate.subtitle}`.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [artifactCandidates, artifactSearch]);

  const filteredRelatedCandidates = useMemo(() => {
    const needle = relatedSearch.trim().toLowerCase();
    return artifactCandidates
      .filter((candidate) => {
        if (primaryArtifact?.key === candidate.key) {
          return false;
        }
        if (relatedArtifacts.some((item) => item.key === candidate.key)) {
          return false;
        }
        return !needle || `${candidate.title} ${candidate.subtitle}`.toLowerCase().includes(needle);
      })
      .slice(0, 8);
  }, [artifactCandidates, primaryArtifact, relatedArtifacts, relatedSearch]);

  const handleSave = async (shouldPublish: boolean) => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!title.trim() || !contentMarkdown.trim()) {
      setError('Title and markdown body are required.');
      return;
    }

    const payload = {
      title: title.trim(),
      summary: summary.trim(),
      content_markdown: contentMarkdown.trim(),
      category,
      tags: parseTagInput(tagsInput),
      primary_artifact: toArtifactPayload(primaryArtifact),
      related_artifacts: relatedArtifacts.map((artifact) => ({
        artifact_type: artifact.artifact_type,
        artifact_ref: artifact.artifact_ref,
      })),
    };

    if (shouldPublish) {
      setIsPublishing(true);
    } else {
      setIsSavingDraft(true);
    }
    setError('');

    try {
      const savedPost = postId
        ? await updateCommunityPost(postId, payload)
        : await createCommunityPost(payload);
      const finalPost = shouldPublish
        ? await publishCommunityPost(savedPost.id, true)
        : savedPost;
      onSaved(finalPost.id);
    } catch (saveError: any) {
      setError(saveError?.response?.data?.detail ?? t('Failed to save the community post.'));
    } finally {
      setIsSavingDraft(false);
      setIsPublishing(false);
    }
  };

  if (!currentUser) {
    return (
      <section className="community-screen">
        <div className="community-shell">
          <div className="glass-panel community-detail-empty">
            <div className="theorem-empty-state">{t('Sign in to write a community post.')}</div>
            <div className="community-detail-actions">
              <button type="button" className="button-secondary" onClick={onCancel}>
                <ArrowLeft size={16} />
                {t('Back to Community')}
              </button>
              <button type="button" className="button-primary" onClick={onOpenAuth}>
                {t('Login / Register')}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="community-screen">
        <div className="community-shell">
          <div className="glass-panel theorem-empty-state">
            <LoaderCircle size={18} className="spin" />
            {t('Loading composer...')}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="community-screen">
      <div className="community-shell community-composer-shell">
        <div className="community-composer-column">
          <div className="glass-panel community-composer-card">
            <div className="community-section-header">
              <div className="community-kicker">
                <Save size={16} />
                {postId ? t('Edit Community Post') : t('New Community Post')}
              </div>
              <p className="community-section-copy">
                {t('Draft in markdown, attach theorem/project context, then publish when ready.')}
              </p>
            </div>

            {error ? <div className="auth-error">{error}</div> : null}

            <div className="community-composer-form">
              <label>
                <span className="auth-field-label">{t('Title')}</span>
                <input
                  className="input-field"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('A compactness note on import discipline')}
                  maxLength={255}
                />
              </label>
              <label>
                <span className="auth-field-label">{t('Summary')}</span>
                <textarea
                  className="proof-textarea community-summary-textarea"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder={t('A short editorial summary for the archive card.')}
                  maxLength={1200}
                />
              </label>
              <div className="auth-input-grid">
                <label>
                  <span className="auth-field-label">{t('Category')}</span>
                  <select
                    className="input-field"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as CommunityCategory)}
                  >
                    {COMMUNITY_CATEGORIES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {t(item.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="auth-field-label">{t('Tags')}</span>
                  <input
                    className="input-field"
                    value={tagsInput}
                    onChange={(event) => setTagsInput(event.target.value)}
                    placeholder={t('compactness, imports, topology')}
                  />
                </label>
              </div>
              <label>
                <span className="auth-field-label">{t('Markdown Body')}</span>
                <textarea
                  className="proof-textarea community-markdown-textarea"
                  value={contentMarkdown}
                  onChange={(event) => setContentMarkdown(event.target.value)}
                  placeholder={t('# Main idea')}
                />
              </label>
            </div>

            <div className="community-artifact-picker-grid">
              <section className="glass-panel community-artifact-picker">
                <div className="community-section-header">
                  <div className="community-kicker">
                    <Link2 size={16} />
                    {t('Primary Artifact')}
                  </div>
                  <p className="community-section-copy">
                    {t('A single theorem or project that best grounds this post.')}
                  </p>
                </div>
                <label className="community-search-field">
                  <Search size={16} />
                  <input
                    className="input-field"
                    value={artifactSearch}
                    onChange={(event) => setArtifactSearch(event.target.value)}
                    placeholder={t('Search theorems or projects...')}
                  />
                </label>
                {primaryArtifact ? (
                  <div className="community-selected-artifact">
                    <div>
                      <strong>{primaryArtifact.title}</strong>
                      <div className="community-card-meta">
                        {t(buildArtifactCandidateLabel(primaryArtifact))} · {primaryArtifact.subtitle}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setPrimaryArtifact(null)}
                    >
                      <X size={14} />
                      {t('Remove')}
                    </button>
                  </div>
                ) : null}
                {isLoadingArtifacts ? (
                  <div className="theorem-empty-state">
                    <LoaderCircle size={16} className="spin" />
                    {t('Loading artifacts...')}
                  </div>
                ) : (
                  <div className="community-artifact-candidate-list">
                    {filteredPrimaryCandidates.map((candidate) => (
                      <button
                        key={candidate.key}
                        type="button"
                        className="community-artifact-candidate"
                        onClick={() => {
                          setPrimaryArtifact(candidate);
                          setRelatedArtifacts((current) =>
                            current.filter((item) => item.key !== candidate.key),
                          );
                        }}
                      >
                        <strong>{candidate.title}</strong>
                        <span>
                          {t(buildArtifactCandidateLabel(candidate))} · {candidate.subtitle}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="glass-panel community-artifact-picker">
                <div className="community-section-header">
                  <div className="community-kicker">
                    <Link2 size={16} />
                    {t('Related Artifacts')}
                  </div>
                  <p className="community-section-copy">
                    {t('Additional theorem or project references that support the article.')}
                  </p>
                </div>
                <label className="community-search-field">
                  <Search size={16} />
                  <input
                    className="input-field"
                    value={relatedSearch}
                    onChange={(event) => setRelatedSearch(event.target.value)}
                    placeholder={t('Search supporting artifacts...')}
                  />
                </label>
                {relatedArtifacts.length > 0 ? (
                  <div className="community-selected-artifact-stack">
                    {relatedArtifacts.map((artifact) => (
                      <div key={artifact.key} className="community-selected-artifact">
                        <div>
                          <strong>{artifact.title}</strong>
                          <div className="community-card-meta">
                            {t(buildArtifactCandidateLabel(artifact))} · {artifact.subtitle}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() =>
                            setRelatedArtifacts((current) =>
                              current.filter((item) => item.key !== artifact.key),
                            )
                          }
                        >
                          <X size={14} />
                          {t('Remove')}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="community-artifact-candidate-list">
                  {filteredRelatedCandidates.map((candidate) => (
                    <button
                      key={candidate.key}
                      type="button"
                      className="community-artifact-candidate"
                      onClick={() =>
                        setRelatedArtifacts((current) => [...current, candidate].slice(0, 8))
                      }
                    >
                      <strong>{candidate.title}</strong>
                      <span>
                        {t(buildArtifactCandidateLabel(candidate))} · {candidate.subtitle}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="community-composer-actions">
              <button type="button" className="button-secondary" onClick={onCancel}>
                <ArrowLeft size={16} />
                {t('Back to Community')}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => void handleSave(false)}
                disabled={isSavingDraft || isPublishing}
              >
                {isSavingDraft ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
                {t('Save Draft')}
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => void handleSave(true)}
                disabled={isSavingDraft || isPublishing}
              >
                {isPublishing ? <LoaderCircle size={16} className="spin" /> : <SendToBack size={16} />}
                Publish
              </button>
            </div>
          </div>
        </div>

        <aside className="community-preview-column">
          <div className="glass-panel community-preview-card">
            <div className="community-section-header">
              <div className="community-kicker">
                <Save size={16} />
                {t('Live Preview')}
              </div>
              <p className="community-section-copy">
                The preview uses the same markdown renderer as the published post detail page.
              </p>
            </div>
            <div className="community-preview-title">{title.trim() || t('Untitled community post')}</div>
            <div className="community-card-tags">
              <span className="proof-badge">
                {COMMUNITY_CATEGORIES.find((item) => item.value === category)?.label ?? 'Note'}
              </span>
              {parseTagInput(tagsInput).map((tag) => (
                <span key={tag} className="proof-badge">
                  {tag}
                </span>
              ))}
            </div>
            {summary.trim() ? <div className="community-article-summary">{summary.trim()}</div> : null}
            <div className="community-markdown-body">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {contentMarkdown || t('*No markdown body yet.*')}
              </ReactMarkdown>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
