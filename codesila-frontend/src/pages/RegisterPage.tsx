import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { registerCompany } from "../api/auth";
import { useAuth } from "../contexts/AuthContext";
import {
  Building2,
  User,
  Mail,
  Key,
  Eye,
  EyeOff,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Check,
  Briefcase,
  Globe,
  Users,
  Shield,
} from "lucide-react";

type Step = 1 | 2 | 3;

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Company info (Step 1)
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [companySize, setCompanySize] = useState("SMALL");
  const [domain, setDomain] = useState("");

  // Admin user info (Step 2)
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  const validateStep1 = (): boolean => {
    if (!companyName.trim()) { setError("Company name is required"); return false; }
    if (companyName.length < 2) { setError("Company name must be at least 2 characters"); return false; }
    setError("");
    return true;
  };

  const validateStep2 = (): boolean => {
    if (!fullName.trim()) { setError("Your full name is required"); return false; }
    if (!email.trim()) { setError("Email address is required"); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Please enter a valid email address"); return false; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return false; }
    if (!/[A-Z]/.test(password)) { setError("Password must contain an uppercase letter"); return false; }
    if (!/[a-z]/.test(password)) { setError("Password must contain a lowercase letter"); return false; }
    if (!/[0-9]/.test(password)) { setError("Password must contain a number"); return false; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return false; }
    setError("");
    return true;
  };

  const nextStep = () => {
    if (step === 1 && validateStep1()) setStep(2);
    if (step === 2 && validateStep2()) setStep(3);
  };

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await registerCompany({
        companyName,
        industry: industry || undefined,
        companySize,
        domain: domain || undefined,
        email,
        password,
        fullName,
        jobTitle: jobTitle || undefined,
      });

      login(result.token, result.user, result.organization);
      navigate("/admin");
    } catch (err: any) {
      setError(err.message || "Registration failed");
      // If it's a duplicate email error, go back to step 2
      if (err.message?.includes("email")) setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const sizeOptions = [
    { value: "SOLO", label: "Just me", desc: "Solo founder" },
    { value: "SMALL", label: "2–10", desc: "Small team" },
    { value: "MEDIUM", label: "11–50", desc: "Growing company" },
    { value: "LARGE", label: "51–200", desc: "Established org" },
    { value: "ENTERPRISE", label: "200+", desc: "Enterprise" },
  ];

  const industries = [
    "Technology", "Finance", "Healthcare", "E-Commerce", "Education",
    "Media", "Manufacturing", "Consulting", "Government", "Telecommunications",
  ];

  return (
    <div className="min-h-screen bg-cyber-base flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyber-cyan to-transparent animate-pulse" />
        <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyber-green to-transparent animate-pulse delay-700" />
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(to right, rgba(0,255,255,0.03) 1px, transparent 1px),
                           linear-gradient(to bottom, rgba(0,255,255,0.03) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }} />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="bg-cyber-base/90 backdrop-blur-xl border border-cyber-cyan/20 rounded-2xl shadow-xl shadow-cyber-cyan/5 overflow-hidden">
          {/* Header */}
          <div className="border-b border-cyber-cyan/10 p-6">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyber-cyan to-cyber-purple flex items-center justify-center">
                <Building2 size={22} className="text-cyber-base" />
              </div>
              <div>
                <h1 className="font-orbitron text-2xl tracking-tight" style={{ color: "#4C29BD" }}>
                  CODESILA
                </h1>
                <p className="text-gray-400 text-sm font-fira">Register your company</p>
              </div>
            </div>

            {/* Step indicator */}
            <div className="flex items-center justify-center gap-2 mt-4">
              {[1, 2, 3].map((s) => (
                <React.Fragment key={s}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                    s < step ? "bg-green-500 text-white" :
                    s === step ? "bg-cyber-cyan text-cyber-base" :
                    "bg-gray-700 text-gray-400"
                  }`}>
                    {s < step ? <Check size={14} /> : s}
                  </div>
                  {s < 3 && <div className={`w-12 h-0.5 ${s < step ? "bg-green-500" : "bg-gray-700"}`} />}
                </React.Fragment>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2 px-2">
              <span>Company</span>
              <span>Your Account</span>
              <span>Confirm</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-6 mt-4 p-3 bg-red-900/15 border-l-3 border-cyber-red rounded-r-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-cyber-red mt-0.5 flex-shrink-0" />
                <p className="font-fira text-sm text-gray-200">{error}</p>
              </div>
            </div>
          )}

          {/* Step 1: Company Info */}
          {step === 1 && (
            <div className="p-6 space-y-5">
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                  <Building2 size={14} className="text-cyber-cyan" />
                  Company Name *
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Corporation"
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20 transition-colors"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                  <Briefcase size={14} className="text-cyber-green" />
                  Industry
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan appearance-none"
                >
                  <option value="">Select industry...</option>
                  {industries.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-3 font-fira">
                  <Users size={14} className="text-cyber-purple" />
                  Company Size *
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {sizeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCompanySize(opt.value)}
                      className={`p-3 rounded-lg border text-center transition-colors ${
                        companySize === opt.value
                          ? "border-cyber-cyan bg-cyber-cyan/10 text-white"
                          : "border-gray-700 bg-gray-900/30 text-gray-400 hover:border-gray-500"
                      }`}
                    >
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[10px] mt-0.5 opacity-60">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                  <Globe size={14} className="text-gray-400" />
                  Company Domain
                  <span className="text-xs text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="acme.com"
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20 transition-colors"
                />
              </div>

              <button
                onClick={nextStep}
                className="w-full py-3 bg-gradient-to-r from-cyber-purple to-cyber-cyan text-white font-orbitron rounded-lg
                         hover:opacity-95 transition-all flex items-center justify-center gap-2"
              >
                Continue <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* Step 2: Admin Account */}
          {step === 2 && (
            <div className="p-6 space-y-5">
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                  <User size={14} className="text-cyber-cyan" />
                  Full Name *
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20 transition-colors"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                  <Briefcase size={14} className="text-gray-400" />
                  Job Title
                  <span className="text-xs text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="CTO, VP of Engineering, etc."
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20 transition-colors"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                  <Mail size={14} className="text-cyber-green" />
                  Work Email *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20 transition-colors"
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="flex items-center justify-between text-sm text-gray-300 mb-2 font-fira">
                  <span className="flex items-center gap-2">
                    <Key size={14} className="text-cyber-purple" />
                    Password *
                  </span>
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="text-xs text-cyber-cyan hover:text-white transition-colors flex items-center gap-1">
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 chars, upper + lower + number"
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20 transition-colors"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
                  <Shield size={14} className="text-gray-400" />
                  Confirm Password *
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full bg-gray-900/50 border border-gray-700 text-white p-3 rounded-lg font-fira text-sm
                           focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20 transition-colors"
                  autoComplete="new-password"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setError(""); setStep(1); }}
                  className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  onClick={nextStep}
                  className="flex-1 py-3 bg-gradient-to-r from-cyber-purple to-cyber-cyan text-white font-orbitron rounded-lg
                           hover:opacity-95 transition-all flex items-center justify-center gap-2"
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Review & Confirm */}
          {step === 3 && (
            <div className="p-6 space-y-5">
              <div className="space-y-4">
                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Company</div>
                  <div className="text-white font-medium text-lg">{companyName}</div>
                  <div className="flex gap-3 mt-2 text-sm text-gray-400">
                    {industry && <span>{industry}</span>}
                    <span>{sizeOptions.find((o) => o.value === companySize)?.label} employees</span>
                    {domain && <span>· {domain}</span>}
                  </div>
                </div>

                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Admin Account</div>
                  <div className="text-white font-medium">{fullName}</div>
                  <div className="text-sm text-gray-400">{email}</div>
                  {jobTitle && <div className="text-sm text-gray-500">{jobTitle}</div>}
                </div>

                <div className="bg-gray-900/50 rounded-lg p-4 border border-cyber-cyan/30">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Plan</div>
                  <div className="text-cyber-cyan font-medium">Startup — Free</div>
                  <div className="text-sm text-gray-400 mt-1">
                    10 team members · 5 projects · GitHub integration included
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    You can upgrade to Business or Corporate at any time from the billing page.
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setError(""); setStep(2); }}
                  className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 py-3 bg-gradient-to-r from-cyber-purple to-cyber-cyan text-white font-orbitron rounded-lg
                           hover:opacity-95 transition-all flex items-center justify-center gap-2
                           disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent
                              translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-cyber-base border-t-transparent rounded-full animate-spin" />
                      <span>Creating your workspace...</span>
                    </>
                  ) : (
                    <>
                      <Building2 size={16} />
                      <span>CREATE COMPANY</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-gray-800/50 p-4 text-center">
            <p className="text-sm text-gray-400 font-fira">
              Already have an account?{" "}
              <Link to="/login" className="text-cyber-cyan hover:underline">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
