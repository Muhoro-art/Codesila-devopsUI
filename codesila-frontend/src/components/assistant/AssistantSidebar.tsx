import { useState } from "react";
import { Bot, Send } from "lucide-react";
import { API_BASE, getAuthHeader } from "../../api/client";
import MarkdownMessage from "../chat/MarkdownMessage";

type Msg = {
  role: "user" | "assistant";
  text: string;
};

export default function AssistantSidebar() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!input.trim()) return;

    const next = [...messages, { role: "user" as const, text: input }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const authHeaders = getAuthHeader();
      const res = await fetch(`${API_BASE}/assistant/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders ?? {}),
        },
        body: JSON.stringify({
          query: input,
          history: next,
        }),
      });

      const data = await res.json();

      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.answer_md ?? "(no response)" },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Error: Failed to reach the assistant." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="sticky top-6 h-[calc(100vh-3rem)] bg-gray-900/40 border border-cyber-cyan/30 rounded-lg flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-cyber-cyan/20">
        <Bot size={18} className="text-cyber-cyan" />
        <span className="font-orbitron text-cyber-cyan">
          DevOps Assistant
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "text-right"
                : "text-left text-cyber-green"
            }
          >
            <div className="inline-block max-w-[90%] bg-black/30 p-2 rounded">
              {m.role === 'user' ? (
                <pre className="whitespace-pre-wrap font-mono">
                  {m.text}
                </pre>
              ) : (
                <MarkdownMessage content={m.text} />
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-cyber-cyan italic">thinking…</div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-700 flex gap-2">
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-black/40 text-white p-2 rounded text-sm resize-none"
          placeholder="Ask about pipelines, logs, deploys…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) ask();
          }}
        />
        <button
          onClick={ask}
          disabled={loading}
          className="bg-cyber-cyan text-cyber-base p-2 rounded hover:animate-pulseNeon"
        >
          <Send size={14} />
        </button>
      </div>
    </aside>
  );
}
