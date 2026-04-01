import { useEffect, useMemo, useState } from 'react';
import { CornerDownRight, LoaderCircle, LockKeyhole, MessageSquare, Send, Trash2 } from 'lucide-react';

import {
  createCommunityPostComment,
  deleteCommunityPostComment,
  listCommunityPostComments,
  type AuthUser,
  type CommunityPostComment,
} from '../../api';

interface CommunityCommentsProps {
  postId: number;
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  canComment: boolean;
}

interface CommunityCommentNode extends CommunityPostComment {
  children: CommunityCommentNode[];
}

const formatTimestamp = (value: string) => new Date(value).toLocaleString();

const buildCommentTree = (comments: CommunityPostComment[]): CommunityCommentNode[] => {
  const nodeLookup = new Map<number, CommunityCommentNode>();
  const sorted = [...comments].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );

  sorted.forEach((comment) => {
    nodeLookup.set(comment.id, { ...comment, children: [] });
  });

  const roots: CommunityCommentNode[] = [];
  nodeLookup.forEach((node) => {
    if (node.parent_id == null) {
      roots.push(node);
      return;
    }
    const parent = nodeLookup.get(node.parent_id);
    if (!parent) {
      roots.push(node);
      return;
    }
    parent.children.push(node);
  });

  return roots;
};

export function CommunityComments({
  postId,
  currentUser,
  onOpenAuth,
  canComment,
}: CommunityCommentsProps) {
  const [comments, setComments] = useState<CommunityPostComment[]>([]);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyParent, setReplyParent] = useState<CommunityPostComment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [error, setError] = useState('');

  const refreshComments = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await listCommunityPostComments(postId);
      setComments(response);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.detail ?? 'Failed to load post comments.');
      setComments([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshComments();
  }, [postId]);

  const commentTree = useMemo(() => buildCommentTree(comments), [comments]);

  const handleCreateComment = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    const nextBody = newCommentBody.trim();
    if (!nextBody) {
      setError('Write a comment before posting.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const response = await createCommunityPostComment(postId, {
        body: nextBody,
      });
      setComments(response);
      setNewCommentBody('');
    } catch (submitError: any) {
      setError(submitError?.response?.data?.detail ?? 'Failed to post the comment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!replyParent) {
      return;
    }
    const nextBody = replyBody.trim();
    if (!nextBody) {
      setError('Write a reply before posting.');
      return;
    }
    setIsSubmittingReply(true);
    setError('');
    try {
      const response = await createCommunityPostComment(postId, {
        body: nextBody,
        parent_id: replyParent.id,
      });
      setComments(response);
      setReplyBody('');
      setReplyParent(null);
    } catch (submitError: any) {
      setError(submitError?.response?.data?.detail ?? 'Failed to post the reply.');
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this comment?')) {
      return;
    }
    try {
      await deleteCommunityPostComment(commentId);
      setReplyBody('');
      setReplyParent(null);
      await refreshComments();
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail ?? 'Failed to delete the comment.');
    }
  };

  const renderCommentNode = (comment: CommunityCommentNode, depth = 0) => (
    <div
      key={comment.id}
      className={`community-comment-thread ${depth > 0 ? 'is-reply-thread' : ''}`}
    >
      <article className={`community-comment-card ${depth > 0 ? 'is-reply' : ''}`}>
        <div className="community-comment-head">
          <div>
            <strong>{comment.author_name}</strong>
            <div className="community-comment-meta">{formatTimestamp(comment.created_at)}</div>
          </div>
          <div className="community-comment-actions">
            {currentUser && canComment ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => setReplyParent(comment)}
              >
                <CornerDownRight size={14} />
                Reply
              </button>
            ) : null}
            {comment.can_delete ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void handleDeleteComment(comment.id)}
              >
                <Trash2 size={14} />
                Delete
              </button>
            ) : null}
          </div>
        </div>
        {comment.parent_author_name ? (
          <div className="community-comment-context">
            <CornerDownRight size={13} />
            Replying to {comment.parent_author_name}
          </div>
        ) : null}
        <p className="community-comment-body">{comment.body}</p>
      </article>
      {comment.children.length > 0 ? (
        <div className="community-comment-children">
          {comment.children.map((child) => renderCommentNode(child, depth + 1))}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="glass-panel community-comments-shell">
      <div className="community-section-header">
        <div className="verified-code-kicker">
          <MessageSquare size={16} />
          Post Comments
        </div>
        <p className="community-section-copy">
          Keep long-form discussion attached to the published journal entry itself.
        </p>
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      {!currentUser ? (
        <div className="discussion-locked-copy">
          <LockKeyhole size={14} />
          Sign in to comment on community posts.
          <button type="button" className="button-secondary" onClick={onOpenAuth}>
            Login / Register
          </button>
        </div>
      ) : canComment ? (
        <div className="community-comment-composer">
          <textarea
            className="proof-textarea community-comment-textarea"
            value={newCommentBody}
            onChange={(event) => setNewCommentBody(event.target.value)}
            placeholder="Share your note, critique, or extension..."
          />
          <div className="discussion-composer-actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => void handleCreateComment()}
              disabled={isSubmitting}
            >
              {isSubmitting ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
              Post Comment
            </button>
          </div>
        </div>
      ) : (
        <div className="community-empty-state">
          Draft posts can only be commented on by their author or an administrator.
        </div>
      )}

      {replyParent ? (
        <div className="community-reply-shell">
          <div className="discussion-replying-banner">
            Replying to {replyParent.author_name}
            <button type="button" className="button-secondary" onClick={() => setReplyParent(null)}>
              Cancel
            </button>
          </div>
          <textarea
            className="proof-textarea community-comment-textarea"
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            placeholder={`Reply to ${replyParent.author_name}...`}
          />
          <div className="discussion-composer-actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => void handleReply()}
              disabled={isSubmittingReply}
            >
              {isSubmittingReply ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
              Reply
            </button>
          </div>
        </div>
      ) : null}

      <div className="community-comment-list">
        {isLoading ? (
          <div className="theorem-empty-state">
            <LoaderCircle size={16} className="spin" />
            Loading comments...
          </div>
        ) : commentTree.length === 0 ? (
          <div className="community-empty-state">
            No one has commented on this post yet.
          </div>
        ) : (
          commentTree.map((comment) => renderCommentNode(comment))
        )}
      </div>
    </section>
  );
}
