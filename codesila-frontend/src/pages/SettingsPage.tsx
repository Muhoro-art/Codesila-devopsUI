import { useState, useEffect } from "react";
import {
  getOrgProfile, updateOrgProfile,
  getUserPreferences, updateUserPreferences, updateUserProfile,
  getFeatures,
  listExports, requestExport,
  type OrgProfile, type FeatureStatus, type DataExport,
} from "../api/saas";
import { useAuth } from "../contexts/AuthContext";

export default function SettingsPage() {
  const [tab, setTab] = useState<"org" | "profile" | "features" | "exports">("org");

  const tabs = [
    { key: "org", label: "Organization" },
    { key: "profile", label: "My Profile" },
    { key: "features", label: "Features" },
    { key: "exports", label: "Data Exports" },
  ];

  return (
    <div className="text-gray-200">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-orbitron text-cyber-cyan">Settings</h1>
          <p className="text-gray-400 mt-1">Organization and personal settings</p>
        </div>

        <div className="flex gap-1 bg-cyber-surface rounded-lg p-1 w-fit">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                tab === t.key ? "bg-cyber-cyan text-cyber-base" : "text-gray-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "org" && <OrgSettingsTab />}
        {tab === "profile" && <ProfileTab />}
        {tab === "features" && <FeaturesTab />}
        {tab === "exports" && <ExportsTab />}
      </div>
    </div>
  );
}

function OrgSettingsTab() {
  const { user, organization, setOrganization } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOrgProfile().then((res) => {
      setProfile(res.profile);
      setName(res.profile.name);
      setIndustry(res.profile.industry || "");
      setSize(res.profile.size);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateOrgProfile({ name, industry, size: size as any });
      setProfile(res.profile);
      // Sync AuthContext so sidebar/header reflects the updated org immediately
      if (organization) {
        setOrganization({ ...organization, name: res.profile.name, industry: res.profile.industry, size: res.profile.size });
      }
    } catch (err: any) {
      alert(err.message);
    }
    setSaving(false);
  };

  if (!profile) return <div className="text-gray-500 animate-pulse">Loading...</div>;

  return (
    <div className="bg-cyber-surface border border-gray-700 rounded-lg p-6 space-y-6">
      <h2 className="text-lg font-semibold text-white">Organization Profile</h2>
      {!isAdmin && <p className="text-xs text-yellow-400">Only admins can edit organization settings.</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Organization Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin}
            className={`w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none ${isAdmin ? "text-white focus:border-cyber-cyan" : "text-gray-500 cursor-not-allowed"}`} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Slug</label>
          <input value={profile.slug} disabled
            className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-gray-500 text-sm cursor-not-allowed" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Industry</label>
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g., Technology, Finance" disabled={!isAdmin}
            className={`w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none ${isAdmin ? "text-white focus:border-cyber-cyan" : "text-gray-500 cursor-not-allowed"}`} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Organization Size</label>
          <select value={size} onChange={(e) => setSize(e.target.value)} disabled={!isAdmin}
            className={`w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none ${isAdmin ? "text-white focus:border-cyber-cyan" : "text-gray-500 cursor-not-allowed"}`}>
            <option value="SOLO">Solo (1)</option>
            <option value="SMALL">Small (2-10)</option>
            <option value="MEDIUM">Medium (11-50)</option>
            <option value="LARGE">Large (51-200)</option>
            <option value="ENTERPRISE">Enterprise (200+)</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-400">
        <span>{profile._count.users} members</span>
        <span>·</span>
        <span>{profile._count.projects} projects</span>
        <span>·</span>
        <span>Created {new Date(profile.createdAt).toLocaleDateString()}</span>
      </div>

      {isAdmin && (
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-cyber-cyan text-cyber-base rounded text-sm font-medium hover:bg-cyber-cyan/80 disabled:opacity-50">
          {saving ? "Saving..." : "Save Changes"}
        </button>
      )}
    </div>
  );
}

function ProfileTab() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [timezone, setTimezone] = useState("UTC");
  const [locale, setLocale] = useState("en");
  const [theme, setTheme] = useState("dark");
  const [emailNotifs, setEmailNotifs] = useState("true");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getUserPreferences().then((res) => {
      if (res.preferences.theme) setTheme(res.preferences.theme);
      if (res.preferences.email_notifications) setEmailNotifs(res.preferences.email_notifications);
      if (res.preferences.timezone) setTimezone(res.preferences.timezone);
      if (res.preferences.locale) setLocale(res.preferences.locale);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateUserProfile({ name, timezone, locale }),
        updateUserPreferences({ theme, email_notifications: emailNotifs }),
      ]);
    } catch (err: any) {
      alert(err.message);
    }
    setSaving(false);
  };

  return (
    <div className="bg-cyber-surface border border-gray-700 rounded-lg p-6 space-y-6">
      <h2 className="text-lg font-semibold text-white">Personal Settings</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Display Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Email</label>
          <input value={user?.email || ""} disabled
            className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-gray-500 text-sm cursor-not-allowed" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Timezone</label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
            className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none">
            <option value="UTC">UTC</option>
            <option value="America/New_York">Eastern (US)</option>
            <option value="America/Chicago">Central (US)</option>
            <option value="America/Denver">Mountain (US)</option>
            <option value="America/Los_Angeles">Pacific (US)</option>
            <option value="Europe/London">London</option>
            <option value="Europe/Berlin">Berlin</option>
            <option value="Asia/Tokyo">Tokyo</option>
            <option value="Asia/Shanghai">Shanghai</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Language</label>
          <select value={locale} onChange={(e) => setLocale(e.target.value)}
            className="w-full bg-cyber-base border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-cyber-cyan focus:outline-none">
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-white">Preferences</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={emailNotifs === "true"} onChange={(e) => setEmailNotifs(e.target.checked ? "true" : "false")}
            className="w-4 h-4 rounded border-gray-600 text-cyber-cyan focus:ring-cyber-cyan bg-cyber-base" />
          <span className="text-sm text-gray-300">Email notifications</span>
        </label>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="px-4 py-2 bg-cyber-cyan text-cyber-base rounded text-sm font-medium hover:bg-cyber-cyan/80 disabled:opacity-50">
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

function FeaturesTab() {
  const [features, setFeatures] = useState<FeatureStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFeatures().then((res) => setFeatures(res.features)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 animate-pulse">Loading features...</div>;

  return (
    <div className="bg-cyber-surface border border-gray-700 rounded-lg p-6 space-y-4">
      <h2 className="text-lg font-semibold text-white">Feature Availability</h2>
      <p className="text-gray-400 text-sm">Features enabled for your organization based on your current plan</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {features.map((f) => (
          <div key={f.key} className="flex items-center justify-between p-3 bg-cyber-base rounded-lg">
            <div>
              <div className="text-sm text-white font-medium">{f.name}</div>
              <div className="text-xs text-gray-500">{f.description}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded ${
                f.source === "plan" ? "bg-blue-900/50 text-blue-400" :
                f.source === "global" ? "bg-purple-900/50 text-purple-400" :
                f.source === "override" ? "bg-yellow-900/50 text-yellow-400" :
                "bg-gray-800 text-gray-400"
              }`}>{f.source}</span>
              <span className={`w-3 h-3 rounded-full ${f.enabled ? "bg-green-400" : "bg-gray-600"}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExportsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const [exports, setExports] = useState<DataExport[]>([]);
  const [creating, setCreating] = useState(false);

  const load = () => {
    listExports().then((res) => setExports(res.exports)).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleExport = async (type: string) => {
    setCreating(true);
    try {
      await requestExport(type);
      setTimeout(load, 2000); // Reload after processing
    } catch (err: any) {
      alert(err.message);
    }
    setCreating(false);
  };

  const exportTypes = [
    { type: "USER_DATA", label: "My Data", desc: "GDPR personal data", adminOnly: false },
    { type: "PROJECTS", label: "Projects", desc: "All projects & members", adminOnly: false },
    { type: "AUDIT_LOGS", label: "Audit Logs", desc: "Event history", adminOnly: true },
    { type: "FULL_ORG", label: "Full Organization", desc: "All org data", adminOnly: true },
    { type: "BILLING", label: "Billing", desc: "Subscription & invoices", adminOnly: true },
  ].filter((exp) => !exp.adminOnly || isAdmin);

  return (
    <div className="space-y-4">
      <div className="bg-cyber-surface border border-gray-700 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Export Data</h2>
        <p className="text-gray-400 text-sm">Download your organization data for compliance or migration</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {exportTypes.map((exp) => (
            <button key={exp.type} onClick={() => handleExport(exp.type)} disabled={creating}
              className="p-4 bg-cyber-base rounded-lg text-left hover:bg-cyber-base/80 border border-gray-700 hover:border-cyber-cyan/50 disabled:opacity-50">
              <div className="text-sm text-white font-medium">{exp.label}</div>
              <div className="text-xs text-gray-500 mt-1">{exp.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Export History */}
      {exports.length > 0 && (
        <div className="bg-cyber-surface border border-gray-700 rounded-lg p-6">
          <h3 className="text-sm font-medium text-white mb-3">Export History</h3>
          <div className="space-y-2">
            {exports.map((exp) => (
              <div key={exp.id} className="flex items-center justify-between p-3 bg-cyber-base rounded">
                <div>
                  <span className="text-sm text-white">{exp.type.replace(/_/g, " ")}</span>
                  <span className="text-xs text-gray-500 ml-2">{new Date(exp.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    exp.status === "COMPLETED" ? "bg-green-900 text-green-400" :
                    exp.status === "PROCESSING" ? "bg-yellow-900 text-yellow-400 animate-pulse" :
                    exp.status === "FAILED" ? "bg-red-900 text-red-400" :
                    "bg-gray-700 text-gray-400"
                  }`}>{exp.status}</span>
                  {exp.status === "COMPLETED" && exp.fileUrl && (
                    <a href={exp.fileUrl} className="text-cyber-cyan text-xs hover:underline">Download</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
