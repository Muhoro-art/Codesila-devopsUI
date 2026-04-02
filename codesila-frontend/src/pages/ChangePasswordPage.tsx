import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Key, Lock } from "lucide-react";
import { changePassword } from "../api/auth";
import { getAuthToken } from "../api/client";

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }

    setLoading(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center py-12 relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyber-cyan to-transparent animate-pulse"></div>
        <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyber-green to-transparent animate-pulse delay-700"></div>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(0, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(0, 255, 255, 0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        ></div>
      </div>

      <div className="relative w-full max-w-lg">
        <div className="bg-cyber-base/90 backdrop-blur-xl border border-cyber-cyan/20 rounded-2xl shadow-xl shadow-cyber-cyan/5 overflow-hidden">
          <div className="border-b border-cyber-cyan/10 p-6 text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyber-cyan to-cyber-purple flex items-center justify-center">
                <Key size={24} className="text-cyber-base" />
              </div>
              <div>
                <h1 className="font-orbitron text-2xl tracking-tight" style={{ color: "#4C29BD" }}>
                  CHANGE PASSWORD
                </h1>
                <p className="text-gray-400 text-sm font-fira mt-1">
                  Keep your account secure
                </p>
              </div>
            </div>
            <p className="text-gray-300 text-sm font-fira">
              Enter your current password and choose a new one.
            </p>
          </div>

          {error && (
            <div className="mx-6 mt-4 p-3 bg-red-900/15 border-l-3 border-cyber-red rounded-r-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-cyber-red mt-0.5 flex-shrink-0" />
                <p className="font-fira text-sm text-gray-200">{error}</p>
              </div>
            </div>
          )}

          {success && (
            <div className="mx-6 mt-4 p-3 bg-emerald-900/20 border-l-3 border-cyber-green rounded-r-lg">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={16} className="text-cyber-green mt-0.5 flex-shrink-0" />
                <p className="font-fira text-sm text-gray-200">Password updated successfully.</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                <Lock size={14} className="text-cyber-cyan" />
                <span>Current Password</span>
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full bg-gray-900/50 border border-gray-700 text-white p-3.5 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20
                           transition-colors placeholder:text-gray-500"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                <Key size={14} className="text-cyber-green" />
                <span>New Password</span>
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full bg-gray-900/50 border border-gray-700 text-white p-3.5 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-green focus:ring-1 focus:ring-cyber-green/20
                           transition-colors placeholder:text-gray-500"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                <Key size={14} className="text-cyber-purple" />
                <span>Confirm New Password</span>
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full bg-gray-900/50 border border-gray-700 text-white p-3.5 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-purple focus:ring-1 focus:ring-cyber-purple/20
                           transition-colors placeholder:text-gray-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-cyber-green to-cyber-cyan text-cyber-base font-orbitron rounded-lg
                         hover:opacity-95 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-cyber-cyan/50
                         transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>

          <div className="border-t border-gray-800/50 p-4 text-center text-xs text-gray-600">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="text-cyber-cyan hover:text-white transition-colors font-fira"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
