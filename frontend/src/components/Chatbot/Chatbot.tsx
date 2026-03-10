import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { chatWithRAG } from '../../api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function Chatbot() {
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
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const { reply } = await chatWithRAG(input, messages);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error communicating with the Oracle.' }]);
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

      <div style={{ display: 'flex', gap: '8px' }}>
        <input 
          type="text" 
          className="input-field" 
          placeholder="Ask a question..." 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button className="button-primary" onClick={handleSend} disabled={isLoading} style={{ padding: '10px' }}>
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
