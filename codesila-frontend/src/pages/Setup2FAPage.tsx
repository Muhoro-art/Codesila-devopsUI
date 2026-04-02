import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, QrCode, Key, CheckCircle2, AlertTriangle } from "lucide-react";
import { generate2FA, verify2FA } from "../api/auth";
import { getAuthToken } from "../api/client";

export default function Setup2FAPage() {
  const navigate = useNavigate();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const authToken = getAuthToken();
    if (!authToken) {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const handleGenerate = async () => {
    setError("");
    setSuccess(false);
    setLoading(true);

    try {
      const data = await generate2FA();
      setQrCode(data.qrCode);
    } catch (err: any) {
      setError(err.message || "Failed to generate 2FA");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setVerifying(true);

    try {
      await verify2FA(token);
      setSuccess(true);
      setToken("");
    } catch (err: any) {
      setError(err.message || "Failed to verify 2FA");
    } finally {
      setVerifying(false);
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

      <div className="relative w-full max-w-4xl">
        <div className="bg-cyber-base/90 backdrop-blur-xl border border-cyber-cyan/20 rounded-2xl shadow-xl shadow-cyber-cyan/5 overflow-hidden">
          <div className="border-b border-cyber-cyan/10 p-6 text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyber-cyan to-cyber-purple flex items-center justify-center">
                <Shield size={24} className="text-cyber-base" />
              </div>
              <div>
                <h1 className="font-orbitron text-2xl tracking-tight" style={{ color: "#4C29BD" }}>
                  2FA SETUP
                </h1>
                <p className="text-gray-400 text-sm font-fira mt-1">
                  Secure your account with authenticator app
                </p>
              </div>
            </div>
            <p className="text-gray-300 text-sm font-fira">
              Generate a QR code, scan it, then verify a one-time code.
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
                <p className="font-fira text-sm text-gray-200">2FA enabled successfully.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 p-6">
            <div className="space-y-5">
              <div className="bg-gray-900/40 border border-cyber-cyan/20 rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <QrCode size={18} className="text-cyber-cyan" />
                  <h2 className="font-orbitron text-sm text-cyber-cyan">Step 1 — Generate QR</h2>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  Click to create a QR code. Scan it with Google Authenticator, Authy, or 1Password.
                </p>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="w-full py-2 bg-cyber-cyan text-cyber-base font-orbitron rounded-lg hover:opacity-95 disabled:opacity-50"
                >
                  {loading ? "Generating..." : "Generate QR Code"}
                </button>
              </div>

              <form onSubmit={handleVerify} className="bg-gray-900/40 border border-cyber-green/20 rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Key size={18} className="text-cyber-green" />
                  <h2 className="font-orbitron text-sm text-cyber-green">Step 2 — Verify Code</h2>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  Enter the 6-digit code from your authenticator app to enable 2FA.
                </p>
<input
  type="text"
  inputMode="numeric"
  value={token}
  onChange={(e) => setToken(e.target.value.replace(/\s+/g, ""))}
  placeholder="123456"
  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3.5 rounded-lg font-fira text-sm
           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20
           transition-colors placeholder:text-gray-500 tracking-widest"
  disabled={verifying}
  required
/>
                <button
                  type="submit"
                  disabled={verifying}
                  className="w-full mt-4 py-2 bg-gradient-to-r from-cyber-green to-cyber-cyan text-cyber-base font-orbitron rounded-lg
                           hover:opacity-95 disabled:opacity-50"
                >
                  {verifying ? "Verifying..." : "Enable 2FA"}
                </button>
              </form>
            </div>

            <div className="bg-gray-900/40 border border-cyber-purple/20 rounded-xl p-6 flex flex-col items-center justify-center text-center">
              {qrCode ? (
                <>
                  <img src={qrCode} alt="2FA QR Code" className="w-56 h-56 rounded-lg border border-cyber-cyan/30" />
                  <p className="mt-4 text-xs text-gray-400">Scan this QR code with your authenticator app.</p>
                </>
              ) : (
                <>
                  <div className="w-48 h-48 rounded-lg border border-dashed border-cyber-purple/40 flex items-center justify-center">
                    <QrCode size={48} className="text-cyber-purple/70" />
                  </div>
                  <p className="mt-4 text-xs text-gray-400">QR preview appears after generation.</p>
                </>
              )}
            </div>
          </div>

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
