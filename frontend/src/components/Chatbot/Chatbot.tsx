import { useState, useRef, useEffect } from 'react';
import { LockKeyhole, Send, Bot, User } from 'lucide-react';
import { chatWithOracle, type AuthUser } from '../../api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatbotProps {
  currentUser: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => void;
}

export function Chatbot({ currentUser, onOpenAuth, onLogout }: ChatbotProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! I am the Shannon Manifold Theorem Oracle. How can I assist you with your mathematical proofs today?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const { reply } = await chatWithOracle(input, messages);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (error) {
      console.error('Chat error:', error);

      if ((error as any)?.response?.status === 401) {
        onLogout();
        onOpenAuth();
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Your session expired. Please sign in again to continue.' }
        ]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Error communicating with the Oracle.' }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '8px' }}>
        {messages.map((msg, index) => (
          <div 
            key={index} 
            className="animate-fade-in"
            style={{ 
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              background: msg.role === 'user' ? 'linear-gradient(135deg, var(--accent-color), #5a3dcc)' : 'rgba(255,255,255,0.05)',
              padding: '12px 16px',
              borderRadius: '12px',
              maxWidth: '85%',
              border: msg.role === 'assistant' ? '1px solid rgba(255,255,255,0.1)' : 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', opacity: 0.8, fontSize: '0.8rem' }}>
              {msg.role === 'assistant' ? <Bot size={14} /> : <User size={14} />}
              <span>{msg.role === 'assistant' ? 'Oracle' : 'You'}</span>
            </div>
            <div style={{ lineHeight: 1.4, fontSize: '0.95rem' }}>
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div style={{ alignSelf: 'flex-start', padding: '12px', color: 'var(--text-secondary)' }} className="animate-fade-in">
            Oracle is thinking...
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
          Sign in to ask questions and keep your member session in the MySQL-backed workspace.
        </button>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <input 
          type="text" 
          className="input-field" 
          placeholder={currentUser ? 'Ask a question...' : 'Login required to use the Oracle'} 
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
