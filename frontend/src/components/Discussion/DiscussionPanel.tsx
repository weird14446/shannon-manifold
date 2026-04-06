import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCheck,
  CornerDownRight,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react';

import {
  createDiscussionComment,
  createDiscussionThread,
  deleteDiscussionComment,
  getDiscussionThread,
  listDiscussionThreads,
  updateDiscussionThread,
  type AuthUser,
  type DiscussionComment,
  type DiscussionThreadDetail,
  type DiscussionThreadSummary,
} from '../../api';
import { useI18n } from '../../i18n';

type DiscussionScopeType = 'theorem' | 'project';
type DiscussionAnchorType = 'general' | 'lean_decl' | 'pdf_page' | 'project_readme';

export interface DiscussionAnchorSelection {
  anchor_type: DiscussionAnchorType;
  anchor_json: Record<string, unknown>;
  label: string;
}

interface DiscussionPanelProps {
  title: string;
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  scopeType: DiscussionScopeType;
  scopeKey: string;
  anchorType: DiscussionAnchorType;
  currentAnchor?: DiscussionAnchorSelection | null;
  emptyMessage: string;
  selectionRequiredMessage?: string;
  onSummariesChange?: (threads: DiscussionThreadSummary[]) => void;
}

interface DiscussionCommentNode extends DiscussionComment {
  children: DiscussionCommentNode[];
}

const formatCommentCount = (count: number) => `${count} comment${count === 1 ? '' : 's'}`;

const asNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

const buildDiscussionCommentTree = (comments: DiscussionComment[]): DiscussionCommentNode[] => {
  const sortedComments = [...comments].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
  const nodeLookup = new Map<number, DiscussionCommentNode>();

  sortedComments.forEach((comment) => {
    nodeLookup.set(comment.id, { ...comment, children: [] });
  });

  const roots: DiscussionCommentNode[] = [];
  nodeLookup.forEach((node) => {
    if (node.parent_id == null) {
      roots.push(node);
      return;
    }
    const parentNode = nodeLookup.get(node.parent_id);
    if (!parentNode) {
      roots.push(node);
      return;
    }
    parentNode.children.push(node);
  });

  return roots;
};

const discussionAnchorMatches = (
  thread: DiscussionThreadSummary,
  anchor: DiscussionAnchorSelection | null | undefined,
) => {
  if (!anchor) {
    return true;
  }
  if (thread.anchor_type !== anchor.anchor_type) {
    return false;
  }

  const threadAnchor = thread.anchor_json;
  if (anchor.anchor_type === 'lean_decl') {
    return (
      asNumber(threadAnchor.document_id) === asNumber(anchor.anchor_json.document_id) &&
      asString(threadAnchor.symbol_name) === asString(anchor.anchor_json.symbol_name) &&
      asNumber(threadAnchor.start_line) === asNumber(anchor.anchor_json.start_line) &&
      asNumber(threadAnchor.end_line) === asNumber(anchor.anchor_json.end_line)
    );
  }

  if (anchor.anchor_type === 'pdf_page') {
    return (
      asNumber(threadAnchor.document_id) === asNumber(anchor.anchor_json.document_id) &&
      asNumber(threadAnchor.pdf_page) === asNumber(anchor.anchor_json.pdf_page) &&
      asString(threadAnchor.symbol_name) === asString(anchor.anchor_json.symbol_name) &&
      asNumber(threadAnchor.start_line) === asNumber(anchor.anchor_json.start_line)
    );
  }

  if (anchor.anchor_type === 'project_readme') {
    return (
      asString(threadAnchor.project_root) === asString(anchor.anchor_json.project_root) &&
      asString(threadAnchor.readme_path) === asString(anchor.anchor_json.readme_path)
    );
  }

  return thread.anchor_type === 'general';
};

export function DiscussionPanel({
  title,
  currentUser,
  onOpenAuth,
  scopeType,
  scopeKey,
  anchorType,
  currentAnchor = null,
  emptyMessage,
  selectionRequiredMessage,
  onSummariesChange,
}: DiscussionPanelProps) {
  const { t, formatDateTime } = useI18n();
  const [threads, setThreads] = useState<DiscussionThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<DiscussionThreadDetail | null>(null);
  const [isThreadDetailOpen, setIsThreadDetailOpen] = useState(false);
  const [newThreadBody, setNewThreadBody] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyParent, setReplyParent] = useState<DiscussionComment | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isSubmittingThread, setIsSubmittingThread] = useState(false);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || !isThreadDetailOpen || !selectedThreadId) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isThreadDetailOpen, selectedThreadId]);

  const refreshThreads = async (preferredThreadId?: number | null) => {
    setIsLoadingThreads(true);
    setPanelError('');
    try {
      const response = await listDiscussionThreads({
        scope_type: scopeType,
        scope_key: scopeKey,
        anchor_type: anchorType,
      });
      setThreads(response);
      onSummariesChange?.(response);
      if (typeof preferredThreadId === 'number') {
        setSelectedThreadId(preferredThreadId);
        setIsThreadDetailOpen(true);
      }
    } catch (error: any) {
      setPanelError(error?.response?.data?.detail ?? 'Failed to load discussions.');
      setThreads([]);
      onSummariesChange?.([]);
      setSelectedThreadId(null);
      setSelectedThread(null);
    } finally {
      setIsLoadingThreads(false);
    }
  };

  useEffect(() => {
    void refreshThreads();
  }, [scopeType, scopeKey, anchorType]);

  const visibleThreads = useMemo(() => {
    if (!currentAnchor || anchorType === 'general') {
      return threads;
    }
    return threads.filter((thread) => discussionAnchorMatches(thread, currentAnchor));
  }, [anchorType, currentAnchor, threads]);

  const selectedThreadComments = useMemo(
    () => buildDiscussionCommentTree(selectedThread?.comments ?? []),
    [selectedThread?.comments],
  );

  useEffect(() => {
    if (visibleThreads.length === 0) {
      setSelectedThreadId(null);
      setSelectedThread(null);
      setIsThreadDetailOpen(false);
      return;
    }

    if (selectedThreadId && visibleThreads.some((thread) => thread.id === selectedThreadId)) {
      return;
    }

    setSelectedThreadId(null);
    setSelectedThread(null);
    setIsThreadDetailOpen(false);
  }, [selectedThreadId, visibleThreads]);

  useEffect(() => {
    let isMounted = true;
    if (!selectedThreadId) {
      setSelectedThread(null);
      setReplyBody('');
      setReplyParent(null);
      return;
    }

    const loadThread = async () => {
      setIsLoadingThread(true);
      setPanelError('');
      try {
        const response = await getDiscussionThread(selectedThreadId);
        if (isMounted) {
          setSelectedThread(response);
        }
      } catch (error: any) {
        if (isMounted) {
          setPanelError(error?.response?.data?.detail ?? 'Failed to load the discussion thread.');
          setSelectedThread(null);
        }
      } finally {
        if (isMounted) {
          setIsLoadingThread(false);
        }
      }
    };

    void loadThread();
    return () => {
      isMounted = false;
    };
  }, [selectedThreadId]);

  const canCreateThread =
    anchorType === 'general' || Boolean(currentAnchor && currentAnchor.anchor_type === anchorType);

  const handleCreateThread = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!canCreateThread) {
      return;
    }
    const nextBody = newThreadBody.trim();
    if (!nextBody) {
      setPanelError(t('Write a comment to start a discussion thread.'));
      return;
    }

    setIsSubmittingThread(true);
    setPanelError('');
    try {
      const response = await createDiscussionThread({
        scope_type: scopeType,
        scope_key: scopeKey,
        anchor_type: anchorType,
        anchor_json: currentAnchor?.anchor_json ?? {},
        body: nextBody,
      });
      setNewThreadBody('');
      setSelectedThread(response);
      setSelectedThreadId(response.id);
      setIsThreadDetailOpen(true);
      await refreshThreads(response.id);
    } catch (error: any) {
      setPanelError(error?.response?.data?.detail ?? t('Failed to create the discussion thread.'));
    } finally {
      setIsSubmittingThread(false);
    }
  };

  const handleReply = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!selectedThread) {
      return;
    }
    const nextBody = replyBody.trim();
    if (!nextBody) {
      setPanelError(t('Write a reply before posting.'));
      return;
    }

    setIsSubmittingReply(true);
    setPanelError('');
    try {
      const response = await createDiscussionComment(selectedThread.id, {
        body: nextBody,
        parent_id: replyParent?.id ?? null,
      });
      setSelectedThread(response);
      setReplyBody('');
      setReplyParent(null);
      await refreshThreads(response.id);
    } catch (error: any) {
      setPanelError(error?.response?.data?.detail ?? t('Failed to post the reply.'));
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleToggleResolved = async () => {
    if (!selectedThread) {
      return;
    }
    try {
      const response = await updateDiscussionThread(selectedThread.id, {
        status: selectedThread.status === 'resolved' ? 'open' : 'resolved',
      });
      setSelectedThread(response);
      await refreshThreads(response.id);
    } catch (error: any) {
      setPanelError(error?.response?.data?.detail ?? t('Failed to update the discussion status.'));
    }
  };

  const handleOpenThread = (threadId: number) => {
    setSelectedThreadId(threadId);
    setIsThreadDetailOpen(true);
  };

  const handleDeleteComment = async (commentId: number) => {
    if (typeof window !== 'undefined' && !window.confirm(t('Delete this comment?'))) {
      return;
    }
    try {
      await deleteDiscussionComment(commentId);
      setReplyBody('');
      setReplyParent(null);
      if (!selectedThread) {
        await refreshThreads();
        return;
      }
      await refreshThreads(selectedThread.id);
      try {
        const reloaded = await getDiscussionThread(selectedThread.id);
        setSelectedThread(reloaded);
      } catch {
        setSelectedThread(null);
        setSelectedThreadId(null);
      }
    } catch (error: any) {
      setPanelError(error?.response?.data?.detail ?? t('Failed to delete the comment.'));
    }
  };

  const renderCommentNode = (comment: DiscussionCommentNode, depth = 0) => (
    <div key={comment.id} className={`discussion-comment-thread ${depth > 0 ? 'is-reply-thread' : ''}`}>
      <article className={`discussion-comment-card ${depth > 0 ? 'is-reply' : ''}`}>
        <div className="discussion-comment-head">
          <div>
            <strong>{comment.author_name}</strong>
            <div className="discussion-thread-card-meta">{formatDateTime(comment.created_at)}</div>
          </div>
          <div className="discussion-comment-actions">
            {currentUser ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => setReplyParent(comment)}
              >
                <CornerDownRight size={14} />
                {t('Reply')}
              </button>
            ) : null}
            {comment.can_delete ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void handleDeleteComment(comment.id)}
              >
                <Trash2 size={14} />
                {t('Delete')}
              </button>
            ) : null}
          </div>
        </div>
        {comment.parent_author_name ? (
          <div className="discussion-thread-card-meta discussion-comment-context">
            <CornerDownRight size={13} />
            {t('Replying to {name}', { name: comment.parent_author_name })}
          </div>
        ) : null}
        <p className="discussion-comment-body">{comment.body}</p>
      </article>
      {comment.children.length > 0 ? (
        <div className="discussion-comment-children">
          {comment.children.map((child) => renderCommentNode(child, depth + 1))}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="discussion-panel-shell">
      <div className="discussion-panel-header">
        <div>
          <div className="verified-code-kicker">
            <MessageSquare size={16} />
            {title}
          </div>
          <p className="discussion-panel-copy">
            {anchorType === 'general'
              ? t('Discuss the current artifact as a whole.')
              : currentAnchor
                ? currentAnchor.label
                : selectionRequiredMessage || emptyMessage}
          </p>
        </div>
      </div>

      {panelError && <div className="auth-error">{panelError}</div>}

      <div className="discussion-composer-card">
        {!currentUser ? (
          <div className="discussion-locked-copy">
            <LockKeyhole size={14} />
            {t('Sign in to start a thread or reply.')}
            <button type="button" className="button-secondary" onClick={onOpenAuth}>
              {t('Login / Register')}
            </button>
          </div>
        ) : !canCreateThread ? (
          <div className="discussion-panel-copy">
            {selectionRequiredMessage || t('Select an anchor before starting a discussion thread.')}
          </div>
        ) : (
          <>
            <textarea
              className="proof-textarea discussion-composer-textarea"
              value={newThreadBody}
              onChange={(event) => setNewThreadBody(event.target.value)}
              placeholder={
                anchorType === 'general'
                  ? t('Start a new discussion...')
                  : t('Start a new anchored discussion...')
              }
            />
            <div className="discussion-composer-actions">
              <button
                type="button"
                className="button-primary"
                onClick={() => void handleCreateThread()}
                disabled={isSubmittingThread}
              >
                {isSubmittingThread ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
                {t('Start Thread')}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="discussion-panel-body">
        <div className="discussion-thread-list">
          {isLoadingThreads ? (
            <div className="theorem-empty-state">
              <LoaderCircle size={16} className="spin" />
              {t('Loading threads...')}
            </div>
          ) : visibleThreads.length === 0 ? (
            <div className="theorem-empty-state">{emptyMessage}</div>
          ) : (
            visibleThreads.map((thread) => (
              <article
                key={thread.id}
                className={`discussion-thread-card ${thread.id === selectedThreadId ? 'is-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => handleOpenThread(thread.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpenThread(thread.id);
                  }
                }}
              >
                <div className="discussion-thread-card-head">
                  <div className="discussion-thread-card-main">
                    <strong>{thread.anchor_label}</strong>
                  </div>
                  <div className="discussion-thread-card-badges">
                    {thread.status === 'resolved' ? (
                      <span className="proof-badge">{t('Resolved')}</span>
                    ) : (
                      <span className="proof-badge">{t('Active')}</span>
                    )}
                    {thread.is_outdated ? <span className="proof-readonly-pill">{t('Outdated')}</span> : null}
                  </div>
                </div>
                <div className="discussion-thread-card-meta">
                  {thread.created_by_name} · {formatCommentCount(thread.comment_count)}
                </div>
                {thread.latest_comment_preview ? (
                  <p className="discussion-thread-card-preview">{thread.latest_comment_preview}</p>
                ) : null}
                <div className="discussion-thread-card-footer">
                  <div className="discussion-thread-card-meta">
                    {t('Updated {timestamp}', {
                      timestamp: formatDateTime(thread.latest_activity_at),
                    })}
                  </div>
                  <div className="discussion-thread-card-hint">
                    <MessageSquare size={13} />
                    {thread.id === selectedThreadId && isThreadDetailOpen
                      ? t('Opened')
                      : t('Open thread')}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        {selectedThreadId && isThreadDetailOpen && portalTarget
          ? createPortal(
              <div className="discussion-thread-modal-backdrop" onClick={() => setIsThreadDetailOpen(false)}>
                <div className="discussion-thread-modal" onClick={(event) => event.stopPropagation()}>
                  {isLoadingThread ? (
                    <div className="theorem-empty-state">
                      <LoaderCircle size={16} className="spin" />
                      {t('Loading discussion...')}
                    </div>
                  ) : !selectedThread ? (
                    <div className="theorem-empty-state">{t('Discussion thread not found.')}</div>
                  ) : (
                    <>
                      <div className="discussion-thread-detail-header">
                        <div>
                          <div className="discussion-thread-detail-title">{selectedThread.anchor_label}</div>
                          <div className="discussion-thread-card-meta">
                            {t('Started by {name} · {timestamp}', {
                              name: selectedThread.created_by_name,
                              timestamp: formatDateTime(selectedThread.created_at),
                            })}
                          </div>
                        </div>
                        <div className="discussion-thread-detail-actions">
                          {selectedThread.can_resolve ? (
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => void handleToggleResolved()}
                            >
                              {selectedThread.status === 'resolved' ? (
                                <>
                                  <RotateCcw size={16} />
                                  {t('Reopen')}
                                </>
                              ) : (
                                <>
                                  <CheckCheck size={16} />
                                  {t('Resolve')}
                                </>
                              )}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => setIsThreadDetailOpen(false)}
                          >
                            <X size={14} />
                            {t('Close')}
                          </button>
                        </div>
                      </div>

                      <div className="discussion-comment-list">
                        {selectedThreadComments.map((comment) => renderCommentNode(comment))}
                      </div>

                      {!currentUser ? (
                        <div className="discussion-locked-copy">
                          <LockKeyhole size={14} />
                          {t('Sign in to reply.')}
                        </div>
                      ) : (
                        <div className="discussion-reply-card">
                          {replyParent ? (
                            <div className="discussion-replying-banner">
                              {t('Replying to {name}', { name: replyParent.author_name })}
                              <button
                                type="button"
                                className="button-secondary"
                                onClick={() => setReplyParent(null)}
                              >
                                {t('Cancel')}
                              </button>
                            </div>
                          ) : null}
                          <textarea
                            className="proof-textarea discussion-composer-textarea"
                            value={replyBody}
                            onChange={(event) => setReplyBody(event.target.value)}
                            placeholder={t('Write a reply...')}
                          />
                          <div className="discussion-composer-actions">
                            <button
                              type="button"
                              className="button-primary"
                              onClick={() => void handleReply()}
                              disabled={isSubmittingReply}
                            >
                              {isSubmittingReply ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
                              {t('Reply')}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>,
              portalTarget,
            )
          : null}
      </div>
    </section>
  );
}
