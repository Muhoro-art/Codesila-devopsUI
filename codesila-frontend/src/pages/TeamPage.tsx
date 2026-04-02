import { useState, useEffect } from "react";
import {
  listInvitations, createInvitation, revokeInvitation, resendInvitation,
  type OrgInvitation,
} from "../api/saas";
import { useAuth } from "../contexts/AuthContext";

export default function TeamPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("DEVELOPER");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadInvitations = async () => {
    try {
      const res = await listInvitations();
      setInvitations(res.invitations);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadInvitations(); }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await createInvitation(email, role);
      setEmail("");
      setShowInviteForm(false);
      loadInvitations();
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this invitation?")) return;
    await revokeInvitation(id);
    loadInvitations();
  };

  const handleResend = async (id: string) => {
    await resendInvitation(id);
    alert("Invitation resent");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-cyber-cyan animate-pulse font-orbitron">Loading team...</div>
      </div>
    );
  }

  return (
    <div className="text-gray-200">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-orbitron text-cyber-cyan">Team Management</h1>
            <p className="text-gray-400 mt-1">Invite and manage team members</p>
          </div>
          <button
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="px-4 py-2 bg-cyber-cyan text-cyber-base rounded text-sm font-medium hover:bg-cyber-cyan/80"
          >
            + Invite Member
          </button>
        </div>

        {/* Invite Form */}
        {showInviteForm && (
          <form onSubmit={handleInvite} className="bg-cyber-surface border border-gray-700 rounded-lg p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Invite Team Member</h3>
            {error && <div className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{error}</div>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="colleague@company.com"
                  className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none"
                >
                  <option value="USER">User</option>
                  <option value="DEVELOPER">Developer</option>
                  <option value="DEVOPS">DevOps</option>
                  <option value="MANAGER">Manager</option>
                  {isAdmin && <option value="ADMIN">Admin</option>}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-cyber-cyan text-cyber-base rounded text-sm font-medium hover:bg-cyber-cyan/80 disabled:opacity-50"
              >
                {submitting ? "Sending..." : "Send Invitation"}
              </button>
              <button
                type="button"
                onClick={() => setShowInviteForm(false)}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded text-sm hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Invitations List */}
        <div className="bg-cyber-surface border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">Pending Invitations</h2>
          </div>
          {invitations.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              No invitations sent yet
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-gray-400 border-b border-gray-700">
                <tr>
                  <th className="text-left px-6 py-3">Email</th>
                  <th className="text-left px-6 py-3">Role</th>
                  <th className="text-left px-6 py-3">Status</th>
                  <th className="text-left px-6 py-3">Invited By</th>
                  <th className="text-left px-6 py-3">Expires</th>
                  <th className="text-right px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-800 hover:bg-cyber-base/50">
                    <td className="px-6 py-3 text-white">{inv.email}</td>
                    <td className="px-6 py-3">
                      <span className="px-2 py-0.5 rounded bg-gray-700 text-gray-300 text-xs">{inv.role}</span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        inv.status === "PENDING" ? "bg-yellow-900 text-yellow-400" :
                        inv.status === "ACCEPTED" ? "bg-green-900 text-green-400" :
                        "bg-gray-700 text-gray-400"
                      }`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-400">{inv.invitedBy?.name || inv.invitedBy?.email}</td>
                    <td className="px-6 py-3 text-gray-400">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                    <td className="px-6 py-3 text-right space-x-2">
                      {inv.status === "PENDING" && (
                        <>
                          <button onClick={() => handleResend(inv.id)} className="text-cyber-cyan hover:underline text-xs">
                            Resend
                          </button>
                          <button onClick={() => handleRevoke(inv.id)} className="text-red-400 hover:underline text-xs">
                            Revoke
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
