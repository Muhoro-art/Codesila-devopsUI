import { useState, useEffect } from "react";
import { listAuditLogs, type AuditLog } from "../api/saas";

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const limit = 50;

  const load = async () => {
    setLoading(true);
    try {
      const res = await listAuditLogs({
        ...filters,
        limit: String(limit),
        offset: String(page * limit),
      });
      setLogs(res.auditLogs);
      setTotal(res.total);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, filters]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="text-gray-200">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-orbitron text-cyber-cyan">Audit Log</h1>
          <p className="text-gray-400 mt-1">Track all actions performed in your organization</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            placeholder="Filter by action..."
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            className="bg-cyber-surface border border-gray-600 rounded px-3 py-2 text-sm text-white focus:border-cyber-cyan focus:outline-none w-48"
          />
          <input
            placeholder="Filter by entity type..."
            onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
            className="bg-cyber-surface border border-gray-600 rounded px-3 py-2 text-sm text-white focus:border-cyber-cyan focus:outline-none w-48"
          />
          <input
            type="date"
            onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
            className="bg-cyber-surface border border-gray-600 rounded px-3 py-2 text-sm text-white focus:border-cyber-cyan focus:outline-none"
          />
          <span className="text-gray-500 self-center text-sm">{total} events found</span>
        </div>

        {/* Log Table */}
        <div className="bg-cyber-surface border border-gray-700 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500 animate-pulse">Loading audit logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center text-gray-500">No audit events found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-gray-400 border-b border-gray-700">
                <tr>
                  <th className="text-left px-6 py-3">Timestamp</th>
                  <th className="text-left px-6 py-3">Actor</th>
                  <th className="text-left px-6 py-3">Action</th>
                  <th className="text-left px-6 py-3">Entity</th>
                  <th className="text-left px-6 py-3">Project</th>
                  <th className="text-left px-6 py-3">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-800 hover:bg-cyber-base/50">
                    <td className="px-6 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-white text-xs">
                      {log.actor?.name || log.actor?.email || "System"}
                    </td>
                    <td className="px-6 py-3">
                      <span className="px-2 py-0.5 rounded bg-cyber-cyan/10 text-cyber-cyan text-xs font-mono">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-400 text-xs font-mono">
                      {log.entityType}{log.entityId ? `:${log.entityId.slice(0, 8)}` : ""}
                    </td>
                    <td className="px-6 py-3 text-gray-400 text-xs">{log.project?.name || "—"}</td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{log.ipAddress || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded bg-gray-700 text-gray-300 text-sm disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-gray-400 text-sm">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page + 1 >= totalPages}
              className="px-3 py-1 rounded bg-gray-700 text-gray-300 text-sm disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
