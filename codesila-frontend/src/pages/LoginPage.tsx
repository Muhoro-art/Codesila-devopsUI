// src/pages/LoginPage.tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login as apiLogin } from "../api/auth";
import { useAuth } from "../contexts/AuthContext";
import { 
  Lock, 
  Mail, 
  Key, 
  Shield,
  Eye,
  EyeOff,
  AlertTriangle
} from "lucide-react";
import { Smartphone } from 'lucide-react';


export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await apiLogin(email, password);

      if (data.twoFactorRequired) {
        sessionStorage.setItem("pending2faUserId", data.userId ?? "");
        navigate("/verify-2fa");
        return;
      }

      // Use AuthContext to store token + user + org (syncs localStorage & React state)
      login(data.token, data.user, data.organization, (data as any).refreshToken);
      if (rememberMe) {
        sessionStorage.setItem("rememberMe", "true");
      }

      const { user } = data;
      // Route to appropriate dashboard based on role
      switch (user.role) {
        case "ADMIN":
        case "SUPER_ADMIN":
          navigate("/admin"); break;
        case "MANAGER": navigate("/manager"); break;
        case "DEVOPS": navigate("/devops"); break;
        case "DEVELOPER": navigate("/developer"); break;
        default: navigate("/");
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cyber-base flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle cyber background */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyber-cyan to-transparent animate-pulse"></div>
        <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyber-green to-transparent animate-pulse delay-700"></div>
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(to right, rgba(0, 255, 255, 0.03) 1px, transparent 1px),
                           linear-gradient(to bottom, rgba(0, 255, 255, 0.03) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}></div>
      </div>

      {/* Minimalist login card */}
      <div className="relative w-full max-w-md">
        <div className="bg-cyber-base/90 backdrop-blur-xl border border-cyber-cyan/20 rounded-2xl shadow-xl shadow-cyber-cyan/5 overflow-hidden">
          {/* Header - Clean CodeSila branding */}
          <div className="border-b border-cyber-cyan/10 p-6 text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyber-cyan to-cyber-purple flex items-center justify-center">
                <Lock size={24} className="text-cyber-base" />
              </div>
              <div>
                <h1 
                  className="font-orbitron text-2xl tracking-tight animate-glitch"
                  style={{ color: '#4C29BD' }}
                >
                  CODESILA
                </h1>
                <p className="text-gray-400 text-sm font-fira mt-1">Developer Platform</p>
              </div>
            </div>
            <p className="text-gray-300 text-sm font-fira">Secure access for authorized personnel</p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mx-6 mt-4 p-3 bg-red-900/15 border-l-3 border-cyber-red rounded-r-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-cyber-red mt-0.5 flex-shrink-0" />
                <p className="font-fira text-sm text-gray-200">{error}</p>
              </div>
            </div>
          )}

          {/* Login form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Email field */}
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                <Mail size={14} className="text-cyber-cyan" />
                <span>Corporate Email</span>
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="name@company.com"
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3.5 pl-11 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20
                           transition-colors placeholder:text-gray-500"
                  disabled={loading}
                  autoComplete="username"
                />
                <div className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-cyber-cyan">
                  <Mail size={16} />
                </div>
              </div>
            </div>

            {/* Password field */}
            <div>
              <label className="flex items-center justify-between text-sm text-gray-300 mb-2 font-fira">
                <span className="flex items-center gap-2">
                  <Key size={14} className="text-cyber-green" />
                  <span>Access Token</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs text-cyber-cyan hover:text-white transition-colors flex items-center gap-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3.5 pl-11 pr-11 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20
                           transition-colors placeholder:text-gray-500 tracking-widest"
                  disabled={loading}
                  autoComplete="current-password"
                />
                <div className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-cyber-green">
                  <Key size={16} />
                </div>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-cyber-cyan focus:ring-cyber-cyan focus:ring-offset-0"
                  disabled={loading}
                />
                <span className="ml-2 text-sm text-gray-300 font-fira">Remember this session</span>
              </label>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-cyber-purple to-cyber-cyan text-white font-orbitron rounded-lg
                       hover:opacity-95 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-cyber-purple/50
                       transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                       relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent 
                            translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
              
              <div className="flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-cyber-base border-t-transparent rounded-full animate-spin"></div>
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    <span>ACCESS PLATFORM</span>
                  </>
                )}
              </div>
            </button>

            {/* Security footer */}
            <div className="pt-4 border-t border-gray-800/50">
              <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                <Shield size={12} className="text-cyber-green" />
                <span>Session encrypted • All access logged • 2FA enforced</span>
              </div>
            </div>
          </form>

          {/* MFA Hint - Moved here from separate component */}
          <section role="status" aria-live="polite" aria-label="Multi-Factor Authentication" className="bg-gray-900/40 border border-cyber-blue/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <Smartphone size={18} className="text-cyber-blue" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="font-orbitron text-sm text-cyber-blue mb-1">Multi-Factor Authentication</p>
                <p className="text-xs text-gray-400">For enhanced security, MFA will be required after successful login. Have your authenticator app ready.</p>
              </div>
            </div>
          </section>

          {/* Register link */}
          <div className="border-t border-gray-800/50 p-4 text-center">
            <p className="text-sm text-gray-400 font-fira">
              New to CodeSila?{" "}
              <a href="/register" className="text-cyber-cyan hover:underline">Register your company</a>
            </p>
          </div>

          {/* Minimal footer */}
          <div className="border-t border-gray-800/50 p-4 text-center text-xs text-gray-600">
            <p>CodeSila Developer Platform • v3.2.1 • © {new Date().getFullYear()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}