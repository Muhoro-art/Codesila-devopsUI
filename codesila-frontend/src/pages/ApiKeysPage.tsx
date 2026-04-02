import { useState, useEffect } from "react";
import {
  listApiKeys, createApiKey, revokeApiKey,
  listWebhooks, createWebhook, deleteWebhook, getWebhookEvents,
  type ApiKeyInfo, type WebhookEndpoint,
} from "../api/saas";

export default function ApiKeysPage() {
  const [tab, setTab] = useState<"keys" | "webhooks">("keys");

  return (
    <div className="text-gray-200">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-orbitron text-cyber-cyan">Developer Settings</h1>
          <p className="text-gray-400 mt-1">API keys and webhook configuration</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-cyber-surface rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab("keys")}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              tab === "keys" ? "bg-cyber-cyan text-cyber-base" : "text-gray-400 hover:text-white"
            }`}
          >
            API Keys
          </button>
          <button
            onClick={() => setTab("webhooks")}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              tab === "webhooks" ? "bg-cyber-cyan text-cyber-base" : "text-gray-400 hover:text-white"
            }`}
          >
            Webhooks
          </button>
        </div>

        {tab === "keys" ? <ApiKeysTab /> : <WebhooksTab />}
      </div>
    </div>
  );
}

function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("read");
  const [expiry, setExpiry] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const res = await listApiKeys().catch(() => ({ apiKeys: [] }));
    setKeys(res.apiKeys);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await createApiKey(name, scopes, expiry ? parseInt(expiry) : undefined);
      setNewKey(res.apiKey.rawKey ?? null);
      setName("");
      setShowCreate(false);
      load();
    } catch (err: any) {
      alert(err.message);
    }
    setSubmitting(false);
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    await revokeApiKey(id);
    load();
  };

  const copyKey = () => {
    if (newKey) navigator.clipboard.writeText(newKey);
  };

  return (
    <div className="space-y-4">
      {/* New key warning */}
      {newKey && (
        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4">
          <p className="text-yellow-400 text-sm font-medium mb-2">⚠️ Copy your API key now — it won't be shown again</p>
          <div className="flex items-center gap-2">
            <code className="bg-cyber-base px-3 py-2 rounded text-green-400 text-xs flex-1 overflow-x-auto">{newKey}</code>
            <button onClick={copyKey} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white">Copy</button>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-2 text-gray-400 text-xs hover:text-white">Dismiss</button>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-cyber-cyan text-cyber-base rounded text-sm font-medium hover:bg-cyber-cyan/80">
          + Create API Key
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-cyber-surface border border-gray-700 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="My API Key"
                className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Scopes</label>
              <select value={scopes} onChange={(e) => setScopes(e.target.value)}
                className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none">
                <option value="read">Read Only</option>
                <option value="read,write">Read + Write</option>
                <option value="read,write,admin">Full Access</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Expires (days)</label>
              <input value={expiry} onChange={(e) => setExpiry(e.target.value)} type="number" min="1" max="365" placeholder="Never"
                className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none" />
            </div>
          </div>
          <button type="submit" disabled={submitting} className="px-4 py-2 bg-cyber-cyan text-cyber-base rounded text-sm font-medium disabled:opacity-50">
            {submitting ? "Creating..." : "Create Key"}
          </button>
        </form>
      )}

      {/* Keys Table */}
      <div className="bg-cyber-surface border border-gray-700 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 animate-pulse">Loading...</div>
        ) : keys.length === 0 ? (
          <div className="p-12 text-center text-gray-500">No API keys yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-400 border-b border-gray-700">
              <tr>
                <th className="text-left px-6 py-3">Name</th>
                <th className="text-left px-6 py-3">Key</th>
                <th className="text-left px-6 py-3">Scopes</th>
                <th className="text-left px-6 py-3">Status</th>
                <th className="text-left px-6 py-3">Last Used</th>
                <th className="text-right px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-gray-800 hover:bg-cyber-base/50">
                  <td className="px-6 py-3 text-white">{key.name}</td>
                  <td className="px-6 py-3 text-gray-400 font-mono text-xs">{key.keyPrefix}...****</td>
                  <td className="px-6 py-3">
                    {key.scopes.split(",").map((s) => (
                      <span key={s} className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 text-xs mr-1">{s.trim()}</span>
                    ))}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      key.status === "ACTIVE" ? "bg-green-900 text-green-400" : "bg-red-900 text-red-400"
                    }`}>{key.status}</span>
                  </td>
                  <td className="px-6 py-3 text-gray-400">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}</td>
                  <td className="px-6 py-3 text-right">
                    {key.status === "ACTIVE" && (
                      <button onClick={() => handleRevoke(key.id)} className="text-red-400 hover:underline text-xs">Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WebhooksTab() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["*"]);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const [wh, ev] = await Promise.all([
      listWebhooks().catch(() => ({ webhooks: [] })),
      getWebhookEvents().catch(() => ({ events: [] })),
    ]);
    setWebhooks(wh.webhooks);
    setAvailableEvents(ev.events);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createWebhook(url, selectedEvents, description || undefined);
      setUrl("");
      setDescription("");
      setSelectedEvents(["*"]);
      setShowCreate(false);
      load();
    } catch (err: any) {
      alert(err.message);
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this webhook endpoint?")) return;
    await deleteWebhook(id);
    load();
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-cyber-cyan text-cyber-base rounded text-sm font-medium hover:bg-cyber-cyan/80">
          + Add Webhook
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-cyber-surface border border-gray-700 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Endpoint URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://your-server.com/webhook"
                className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Slack notification hook"
                className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Events</label>
            <div className="flex flex-wrap gap-2">
              {availableEvents.map((event) => (
                <button key={event} type="button" onClick={() => toggleEvent(event)}
                  className={`px-2 py-1 rounded text-xs border ${
                    selectedEvents.includes(event) ? "border-cyber-cyan text-cyber-cyan bg-cyber-cyan/10" : "border-gray-600 text-gray-400 hover:border-gray-500"
                  }`}>
                  {event}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={submitting} className="px-4 py-2 bg-cyber-cyan text-cyber-base rounded text-sm font-medium disabled:opacity-50">
            {submitting ? "Creating..." : "Create Webhook"}
          </button>
        </form>
      )}

      <div className="bg-cyber-surface border border-gray-700 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 animate-pulse">Loading...</div>
        ) : webhooks.length === 0 ? (
          <div className="p-12 text-center text-gray-500">No webhook endpoints configured</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-400 border-b border-gray-700">
              <tr>
                <th className="text-left px-6 py-3">URL</th>
                <th className="text-left px-6 py-3">Events</th>
                <th className="text-left px-6 py-3">Status</th>
                <th className="text-left px-6 py-3">Failures</th>
                <th className="text-right px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((wh) => (
                <tr key={wh.id} className="border-b border-gray-800 hover:bg-cyber-base/50">
                  <td className="px-6 py-3 text-white font-mono text-xs max-w-xs truncate">{wh.url}</td>
                  <td className="px-6 py-3 text-gray-400 text-xs">{wh.events.split(",").length} events</td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      wh.status === "ACTIVE" ? "bg-green-900 text-green-400" :
                      wh.status === "PAUSED" ? "bg-yellow-900 text-yellow-400" :
                      "bg-red-900 text-red-400"
                    }`}>{wh.status}</span>
                  </td>
                  <td className="px-6 py-3 text-gray-400">{wh.failureCount}</td>
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => handleDelete(wh.id)} className="text-red-400 hover:underline text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
