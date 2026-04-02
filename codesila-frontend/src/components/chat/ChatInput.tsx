// src/components/chat/ChatInput.tsx
import { useState, useRef, useEffect } from 'react';
import {
  Send, AlertTriangle, X,
} from 'lucide-react';
import type { RolePerks } from './chatConfig';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Props {
  onSend: (content: string, priority: 'normal' | 'urgent') => void;
  placeholder: string;
  perks: RolePerks;
  disabled?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

const ChatInput = ({ onSend, placeholder, perks, disabled }: Props) => {
  const [message, setMessage] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [message]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    // Enforce max message length
    if (trimmed.length > perks.maxMessageLength) {
      return; // Could show an error toast here
    }

    onSend(trimmed, isUrgent ? 'urgent' : 'normal');
    setMessage('');
    setIsUrgent(false);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const remaining = perks.maxMessageLength - message.length;
  const nearLimit = remaining < 100 && remaining >= 0;
  const overLimit = remaining < 0;

  return (
    <div className="border-t border-cyber-cyan/20 bg-cyber-base shrink-0">
      {/* Urgent banner */}
      {isUrgent && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-red-900/30 border-b border-red-500/20">
          <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
            <AlertTriangle size={13} />
            <span>Sending as URGENT — all recipients will be notified</span>
          </div>
          <button
            onClick={() => setIsUrgent(false)}
            className="p-0.5 text-red-400 hover:text-red-300 transition"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 p-3">
        {/* Action buttons (left side) */}
        <div className="flex items-center gap-1 shrink-0 pb-1">
          {perks.canMarkUrgent && (
            <button
              onClick={() => setIsUrgent(!isUrgent)}
              className={`p-1.5 rounded-lg transition ${
                isUrgent
                  ? 'text-red-400 bg-red-900/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
              title="Mark as urgent"
            >
              <AlertTriangle size={16} />
            </button>
          )}
        </div>

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            className={`w-full bg-gray-900/60 text-cyber-text text-sm font-fira pl-4 pr-4 py-2.5 rounded-2xl
                       placeholder-gray-500 resize-none
                       focus:outline-none transition
                       ${isUrgent
                         ? 'border border-red-500/40 focus:border-red-500/60 focus:ring-1 focus:ring-red-500/20'
                         : 'border border-cyber-cyan/20 focus:border-cyber-cyan/40 focus:ring-1 focus:ring-cyber-cyan/20'
                       }
                       disabled:opacity-50`}
            style={{ maxHeight: '120px' }}
          />
          {/* Character count */}
          {(nearLimit || overLimit) && (
            <div className={`absolute bottom-1 right-3 text-[10px] ${overLimit ? 'text-red-400' : 'text-amber-400'}`}>
              {remaining}
            </div>
          )}
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!message.trim() || overLimit || disabled}
          className={`shrink-0 p-2.5 rounded-full transition-all ${
            message.trim() && !overLimit
              ? isUrgent
                ? 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20'
                : 'bg-cyber-green text-cyber-base hover:bg-cyber-green/90 shadow-lg shadow-cyber-green/20'
              : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
          }`}
          title="Send (Enter)"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};

export default ChatInput;
