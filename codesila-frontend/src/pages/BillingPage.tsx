import { useState, useEffect } from "react";
import {
  listPlans, getSubscription, changePlan, cancelSubscription, reactivateSubscription,
  listInvoices, getUsageSummary,
  type Plan, type Subscription, type Invoice, type UsageSummary,
} from "../api/saas";
import { useAuth } from "../contexts/AuthContext";

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");

  useEffect(() => {
    Promise.all([
      listPlans().catch(() => ({ plans: [] })),
      getSubscription().catch(() => ({ subscription: null })),
      listInvoices().catch(() => ({ invoices: [] })),
      getUsageSummary().catch(() => null),
    ]).then(([p, s, i, u]) => {
      setPlans(p.plans);
      setSubscription(s.subscription);
      setInvoices(i.invoices);
      setUsage(u);
      setLoading(false);
    });
  }, []);

  const handleChangePlan = async (planId: string) => {
    setActionLoading(planId);
    try {
      const res = await changePlan(planId);
      setSubscription(res.subscription);
    } catch (err: any) {
      alert(err.message);
    }
    setActionLoading(null);
  };

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel your subscription?")) return;
    try {
      const res = await cancelSubscription();
      setSubscription(res.subscription);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleReactivate = async () => {
    try {
      const res = await reactivateSubscription();
      setSubscription(res.subscription);
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-cyber-cyan animate-pulse font-orbitron">Loading billing...</div>
      </div>
    );
  }

  const currentPlan = subscription?.plan;
  const { organization } = useAuth();

  return (
    <div className="text-gray-200">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-orbitron text-cyber-cyan">Billing & Plans</h1>
            <p className="text-gray-400 mt-1">
              Manage subscription for <span className="text-white font-medium">{organization?.name || "your organization"}</span>
            </p>
          </div>
          {subscription?.cancelAtPeriodEnd && (
            <button onClick={handleReactivate} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-white text-sm font-medium">
              Reactivate Subscription
            </button>
          )}
        </div>

        {/* Current Plan Banner */}
        {currentPlan && (
          <div className="bg-cyber-surface border border-cyber-cyan/30 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-400 uppercase tracking-wide">Current Plan</div>
                <div className="text-2xl font-orbitron text-cyber-cyan mt-1">{currentPlan.displayName}</div>
                <div className="text-gray-400 text-sm mt-1">
                  {subscription.status === "TRIALING" && subscription.trialEndsAt
                    ? `Trial ends ${new Date(subscription.trialEndsAt).toLocaleDateString()}`
                    : `${subscription.billingCycle === "ANNUAL" ? "Annual" : "Monthly"} billing`}
                  {subscription.cancelAtPeriodEnd && " · Cancels at period end"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-white">
                  ${((billingCycle === "ANNUAL" ? currentPlan.annualPrice : currentPlan.monthlyPrice) / 100).toFixed(0)}
                </div>
                <div className="text-gray-400 text-sm">/ {billingCycle === "ANNUAL" ? "year" : "month"}</div>
              </div>
            </div>
          </div>
        )}

        {/* Usage Summary */}
        {usage && (
          <div className="bg-cyber-surface border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-orbitron text-white mb-4">Usage This Period</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <UsageCard label="Team Members" value={usage.resources.users} max={usage.limits?.maxUsers} />
              <UsageCard label="Projects" value={usage.resources.projects} max={usage.limits?.maxProjects} />
              <UsageCard label="API Calls" value={usage.currentPeriod.apiCalls ?? 0} max={usage.limits?.maxApiCalls} />
            </div>
          </div>
        )}

        {/* Billing Cycle Toggle */}
        <div className="flex items-center justify-center gap-3">
          <span className={`text-sm ${billingCycle === "MONTHLY" ? "text-white" : "text-gray-500"}`}>Monthly</span>
          <button
            onClick={() => setBillingCycle(billingCycle === "MONTHLY" ? "ANNUAL" : "MONTHLY")}
            className={`relative w-12 h-6 rounded-full transition-colors ${billingCycle === "ANNUAL" ? "bg-cyber-cyan" : "bg-gray-600"}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${billingCycle === "ANNUAL" ? "translate-x-6" : "translate-x-0.5"}`} />
          </button>
          <span className={`text-sm ${billingCycle === "ANNUAL" ? "text-white" : "text-gray-500"}`}>
            Annual <span className="text-green-400 text-xs">(Save ~17%)</span>
          </span>
        </div>

        {/* Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = currentPlan?.id === plan.id;
            const price = billingCycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice;
            const isEnterprise = plan.name === "enterprise";

            return (
              <div
                key={plan.id}
                className={`bg-cyber-surface border rounded-lg p-6 flex flex-col ${
                  isCurrent ? "border-cyber-cyan" : "border-gray-700"
                }`}
              >
                <div className="mb-4">
                  <h3 className="text-lg font-orbitron text-white">{plan.displayName}</h3>
                  <p className="text-gray-400 text-sm mt-1">{plan.description}</p>
                </div>

                <div className="mb-4">
                  {isEnterprise ? (
                    <div className="text-2xl font-bold text-white">Custom</div>
                  ) : (
                    <>
                      <span className="text-3xl font-bold text-white">${(price / 100).toFixed(0)}</span>
                      <span className="text-gray-400">/{billingCycle === "ANNUAL" ? "yr" : "mo"}</span>
                    </>
                  )}
                </div>

                <ul className="space-y-2 mb-6 flex-1 text-sm">
                  <li className="text-gray-300">Up to {plan.maxUsers === 9999 ? "Unlimited" : plan.maxUsers} users</li>
                  <li className="text-gray-300">Up to {plan.maxProjects === 9999 ? "Unlimited" : plan.maxProjects} projects</li>
                  <li className="text-gray-300">{formatStorage(plan.maxStorage)} storage</li>
                  <li className="text-gray-300">{plan.maxApiCalls >= 9999999 ? "Unlimited" : plan.maxApiCalls.toLocaleString()} API calls/mo</li>
                  {plan.features?.sso && <li className="text-green-400">✓ SSO / SAML</li>}
                  {plan.features?.audit_log && <li className="text-green-400">✓ Audit Log</li>}
                  {plan.features?.advanced_analytics && <li className="text-green-400">✓ Advanced Analytics</li>}
                  {plan.features?.priority_support && <li className="text-green-400">✓ Priority Support</li>}
                </ul>

                {isCurrent ? (
                  <button
                    disabled
                    className="w-full py-2 rounded bg-gray-700 text-gray-400 text-sm cursor-default"
                  >
                    Current Plan
                  </button>
                ) : isEnterprise ? (
                  <a
                    href="mailto:sales@codesila.com"
                    className="w-full py-2 rounded bg-cyber-cyan/20 text-cyber-cyan text-sm text-center hover:bg-cyber-cyan/30"
                  >
                    Contact Sales
                  </a>
                ) : (
                  <button
                    onClick={() => handleChangePlan(plan.id)}
                    disabled={actionLoading === plan.id}
                    className="w-full py-2 rounded bg-cyber-cyan text-cyber-base text-sm font-medium hover:bg-cyber-cyan/80 disabled:opacity-50"
                  >
                    {actionLoading === plan.id ? "Processing..." : "Select Plan"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Cancel Subscription */}
        {subscription && !subscription.cancelAtPeriodEnd && subscription.plan.name !== "free" && (
          <div className="bg-cyber-surface border border-red-800/30 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-red-400">Cancel Subscription</h3>
            <p className="text-gray-400 text-sm mt-1">Your plan will remain active until the end of the current billing period.</p>
            <button onClick={handleCancel} className="mt-4 px-4 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-sm">
              Cancel Subscription
            </button>
          </div>
        )}

        {/* Invoices */}
        {invoices.length > 0 && (
          <div className="bg-cyber-surface border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-orbitron text-white mb-4">Invoices</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-gray-400 border-b border-gray-700">
                  <tr>
                    <th className="pb-2">Invoice #</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-gray-800">
                      <td className="py-2 text-white">{inv.invoiceNumber}</td>
                      <td className="py-2">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                      <td className="py-2">${(inv.amountDue / 100).toFixed(2)} {inv.currency}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          inv.status === "PAID" ? "bg-green-900 text-green-400" :
                          inv.status === "OPEN" ? "bg-yellow-900 text-yellow-400" :
                          "bg-gray-700 text-gray-400"
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UsageCard({ label, value, max }: { label: string; value: number; max?: number }) {
  const pct = max ? Math.min((value / max) * 100, 100) : 0;
  const isWarning = pct > 80;
  const isCritical = pct > 95;

  return (
    <div className="bg-cyber-base rounded-lg p-4">
      <div className="text-gray-400 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">
        {value.toLocaleString()}
        {max && <span className="text-sm text-gray-400 font-normal"> / {max >= 9999 ? "∞" : max.toLocaleString()}</span>}
      </div>
      {max && max < 9999 && (
        <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isCritical ? "bg-red-500" : isWarning ? "bg-yellow-500" : "bg-cyber-cyan"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function formatStorage(bytes: number): string {
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(0)} TB`;
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(0)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${bytes} B`;
}
