import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  Code2,
  FileText,
  Image as ImageIcon,
  LockKeyhole,
  Paperclip,
  Send,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { chatWithOracle, type AuthUser, type ChatCodeContextPayload } from '../../api';
import { useI18n } from '../../i18n';
import { LeanCodeHighlighter } from '../TheoremList/LeanCodeHighlighter';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  suggestedCode?: string | null;
  suggestedLanguage?: string | null;
}

interface ChatbotProps {
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  codeContext?: ChatCodeContextPayload | null;
  defaultAttachmentFile?: File | null;
  onApplySuggestedCode?: (payload: { code: string; title: string }) => void;
}

const CODE_BLOCK_RE = /```(?<lang>[A-Za-z0-9_+-]*)\n(?<code>[\s\S]*?)```/g;
const isPdfAttachment = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
const isImageAttachment = (file: File) =>
  file.type.startsWith('image/') ||
  /\.(png|jpe?g|webp|gif)$/i.test(file.name);

const stripSuggestedCodeBlock = (content: string, suggestedCode?: string | null) => {
  if (!suggestedCode) {
    return content;
  }

  return content.replace(CODE_BLOCK_RE, (block, _lang, code) => {
    const normalizedCode = String(code ?? '').trim();
    if (normalizedCode === suggestedCode.trim()) {
      return '';
    }
    return block;
  });
};

const renderMessageContent = (content: string) => {
  const sanitizedContent = content.trim();
  if (!sanitizedContent) {
    return null;
  }

  const segments: Array<
    | { type: 'text'; value: string }
    | { type: 'code'; value: string; language: string | null }
  > = [];

  let lastIndex = 0;
  for (const match of sanitizedContent.matchAll(CODE_BLOCK_RE)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      const text = sanitizedContent.slice(lastIndex, matchIndex).trim();
      if (text) {
        segments.push({ type: 'text', value: text });
      }
    }

    const code = (match.groups?.code ?? '').trimEnd();
    if (code) {
      segments.push({
        type: 'code',
        value: code,
        language: (match.groups?.lang ?? '').trim() || null,
      });
    }
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < sanitizedContent.length) {
    const tail = sanitizedContent.slice(lastIndex).trim();
    if (tail) {
      segments.push({ type: 'text', value: tail });
    }
  }

  if (segments.length === 0) {
    return <div className="chat-message-copy">{sanitizedContent}</div>;
  }

  return segments.map((segment, index) => {
    if (segment.type === 'text') {
      return (
        <div key={`text-${index}`} className="chat-message-copy">
          {segment.value}
        </div>
      );
    }

    if ((segment.language || '').toLowerCase() === 'lean') {
      return (
        <div key={`code-${index}`} className="chat-message-code">
          <LeanCodeHighlighter code={segment.value} />
        </div>
      );
    }

    return (
      <pre key={`code-${index}`} className="chat-code-preview">
        <code>{segment.value}</code>
      </pre>
    );
  });
};

export function Chatbot({
  currentUser,
  onOpenAuth,
  onLogout,
  codeContext = null,
  defaultAttachmentFile = null,
  onApplySuggestedCode,
}: ChatbotProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: t(
        'Hello! I am the Shannon Manifold Theorem Oracle. Ask about proofs, Lean4, imports, or have me draft code with you.',
      ),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isContextVisible, setIsContextVisible] = useState(true);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const autoAttachedFile = !attachedFile ? defaultAttachmentFile : null;
  const effectiveAttachmentFile = attachedFile ?? autoAttachedFile;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    if (!input.trim() && !effectiveAttachmentFile) return;

    const prompt = input.trim() || t('Please analyze the attached file.');
    const attachmentLabel = effectiveAttachmentFile ? effectiveAttachmentFile.name : null;
    const displayContent = attachmentLabel
      ? input.trim()
        ? `${input.trim()}\n\n[Attached: ${attachmentLabel}]`
        : `[Attached: ${attachmentLabel}]`
      : prompt;

    const userMessage: Message = { role: 'user', content: displayContent };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const { reply, suggested_code, suggested_language } = await chatWithOracle(
        prompt,
        messages,
        codeContext,
        effectiveAttachmentFile,
      );
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: reply,
          suggestedCode: suggested_code ?? null,
          suggestedLanguage: suggested_language ?? null,
        },
      ]);
      setAttachedFile(null);
    } catch (error) {
      console.error('Chat error:', error);

      if ((error as any)?.response?.status === 401) {
        onLogout();
        onOpenAuth();
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: t('Your session expired. Please sign in again to continue.') }
        ]);
      } else {
        const detail =
          (error as any)?.response?.data?.detail ||
          t('Error communicating with the Oracle.');
        setMessages((prev) => [...prev, { role: 'assistant', content: String(detail) }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
      {codeContext &&
        (isContextVisible ? (
          <div className="chat-context-card">
            <div className="chat-context-header">
              <div className="chat-context-label">
                <Code2 size={14} />
                {t('Proof-State-Aware Copilot')}
              </div>
              <button
                type="button"
                className="chat-context-toggle"
                onClick={() => setIsContextVisible(false)}
                aria-label={t('Hide copilot context')}
              >
                <X size={14} />
              </button>
            </div>
            <div className="chat-context-title">{codeContext.title}</div>
            <div className="chat-context-meta">
              {codeContext.module_name || t('Unsaved module')}
              {codeContext.path ? ` · ${codeContext.path}` : ''}
            </div>
            <div className="chat-context-grid">
              <div className="chat-context-chip">
                {t('Cursor {line}:{column}', {
                  line: String(codeContext.cursor_line ?? '?'),
                  column: String(codeContext.cursor_column ?? '?'),
                })}
              </div>
              <div className="chat-context-chip">
                {t('{count} imports', { count: String(codeContext.imports?.length ?? 0) })}
              </div>
            </div>
            {codeContext.active_goal && (
              <div className="chat-context-goal">
                <div className="chat-context-goal-label">{t('Active Goal')}</div>
                <pre>{codeContext.active_goal}</pre>
              </div>
            )}
            <div className="chat-context-helper">
              {t(
                'The Oracle will use the current file, imports, cursor location, nearby code, and current infoview goal to suggest tactics or revise the Lean file.',
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="chat-context-collapsed"
            onClick={() => setIsContextVisible(true)}
          >
            <span className="chat-context-label">
              <Code2 size={14} />
              {t('Proof-State-Aware Copilot')}
            </span>
            <span className="chat-context-collapsed-action">
              <ChevronDown size={14} />
              {t('Show')}
            </span>
          </button>
        ))}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '8px' }}>
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`chat-message-shell animate-fade-in ${msg.role === 'user' ? 'is-user' : 'is-assistant'
              }`}
          >
            <div className="chat-message-meta">
              {msg.role === 'assistant' ? <Bot size={14} /> : <User size={14} />}
              <span>{msg.role === 'assistant' ? t('Oracle') : t('You')}</span>
            </div>
            {renderMessageContent(stripSuggestedCodeBlock(msg.content, msg.suggestedCode))}
            {msg.role === 'assistant' && msg.suggestedCode && (
              <div className="chat-code-suggestion">
                <div className="chat-code-suggestion-head">
                  <div className="chat-code-suggestion-title">
                    <Sparkles size={14} />
                    {t('Suggested {language}', {
                      language: msg.suggestedLanguage || t('code'),
                    })}
                  </div>
                  {onApplySuggestedCode && (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() =>
                        onApplySuggestedCode({
                          code: msg.suggestedCode ?? '',
                          title: codeContext?.title || t('Oracle Draft'),
                        })
                      }
                    >
                      {t('Apply to Playground')}
                    </button>
                  )}
                </div>
                {(msg.suggestedLanguage || '').toLowerCase() === 'lean' ? (
                  <div className="chat-message-code">
                    <LeanCodeHighlighter code={msg.suggestedCode} />
                  </div>
                ) : (
                  <pre className="chat-code-preview">
                    <code>{msg.suggestedCode}</code>
                  </pre>
                )}
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div style={{ alignSelf: 'flex-start', padding: '12px', color: 'var(--text-secondary)' }} className="animate-fade-in">
            {t('Oracle is thinking...')}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {!currentUser && (
        <button
          type="button"
          className="chat-notice"
          onClick={onOpenAuth}
        >
          <LockKeyhole size={16} />
          {t('Sign in to ask questions and keep your member session in the MySQL-backed workspace.')}
        </button>
      )}

      {effectiveAttachmentFile && (
        <div className="chat-attachment-chip">
          <span className="chat-attachment-label">
            {isPdfAttachment(effectiveAttachmentFile) ? <FileText size={14} /> : <ImageIcon size={14} />}
            {attachedFile
              ? attachedFile.name
              : `${effectiveAttachmentFile.name} (auto)`}
          </span>
          {attachedFile && (
            <button
              type="button"
              className="chat-attachment-remove"
              onClick={() => setAttachedFile(null)}
              aria-label={t('Remove attached file')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          ref={attachmentInputRef}
          type="file"
          accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (!file) {
              return;
            }

            const isSupported = isPdfAttachment(file) || isImageAttachment(file);
            if (!isSupported) {
              setMessages((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: t(
                    'Only PDF, PNG, JPG, JPEG, WEBP, and GIF files can be attached right now.',
                  ),
                },
              ]);
              event.target.value = '';
              return;
            }

            setAttachedFile(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="button-secondary"
          onClick={() => attachmentInputRef.current?.click()}
          disabled={!currentUser || isLoading}
          style={{ padding: '10px' }}
          aria-label={t('Attach file to chat')}
        >
          <Paperclip size={18} />
        </button>
        <input
          type="text"
          className="input-field"
          placeholder={
            currentUser
              ? codeContext
                ? t('Ask for the next tactic, a lemma search, a Lean edit, or attach a PDF/image...')
                : t('Ask a question, request a Lean draft, or attach a PDF/image...')
              : t('Login required to use the Oracle')
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={!currentUser || isLoading}
        />
        <button className="button-primary" onClick={handleSend} disabled={!currentUser || isLoading} style={{ padding: '10px' }}>
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
