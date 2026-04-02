import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Key, AlertTriangle, CheckCircle2 } from "lucide-react";
import { login2FA } from "../api/auth";
import { useAuth } from "../contexts/AuthContext";

export default function Verify2FAPage() {
	const navigate = useNavigate();
	const { login } = useAuth();
	const [token, setToken] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const pendingUserId = sessionStorage.getItem("pending2faUserId");
		if (!pendingUserId) {
			navigate("/login", { replace: true });
		}
	}, [navigate]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const userId = sessionStorage.getItem("pending2faUserId");
			if (!userId) {
				throw new Error("Missing 2FA session, please log in again");
			}

			const data = await login2FA(userId, token);
			sessionStorage.removeItem("pending2faUserId");

			// Use AuthContext to store token + user (syncs sessionStorage & React state)
			login(data.token, data.user, data.organization, (data as any).refreshToken);

			switch (data.user.role) {
				case "ADMIN":
					navigate("/admin");
					break;
				case "MANAGER":
					navigate("/manager");
					break;
				case "DEVOPS":
					navigate("/devops");
					break;
				case "DEVELOPER":
					navigate("/developer");
					break;
				default:
					navigate("/");
			}
		} catch (err: any) {
			setError(err.message || "2FA verification failed");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-cyber-base flex items-center justify-center p-4 relative overflow-hidden">
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

			<div className="relative w-full max-w-md">
				<div className="bg-cyber-base/90 backdrop-blur-xl border border-cyber-cyan/20 rounded-2xl shadow-xl shadow-cyber-cyan/5 overflow-hidden">
					<div className="border-b border-cyber-cyan/10 p-6 text-center">
						<div className="flex items-center justify-center gap-3 mb-4">
							<div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyber-cyan to-cyber-purple flex items-center justify-center">
								<Shield size={24} className="text-cyber-base" />
							</div>
							<div>
								<h1
									className="font-orbitron text-2xl tracking-tight"
									style={{ color: "#4C29BD" }}
								>
									VERIFY ACCESS
								</h1>
								<p className="text-gray-400 text-sm font-fira mt-1">
									Two-Factor Authentication
								</p>
							</div>
						</div>
						<p className="text-gray-300 text-sm font-fira">
							Enter the 6-digit code from your authenticator app
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

					<form onSubmit={handleSubmit} className="p-6 space-y-5">
						<div>
							<label className="flex items-center gap-2 text-sm text-gray-300 mb-2 font-fira">
								<Key size={14} className="text-cyber-green" />
								<span>Authentication Code</span>
							</label>
							<div className="relative">
								<input
									type="text"
									inputMode="numeric"
									value={token}
									onChange={(e) => setToken(e.target.value.replace(/\s+/g, ""))}
									required
									placeholder="123456"
									className="w-full bg-gray-900/50 border border-gray-700 text-white p-3.5 pl-11 rounded-lg font-fira text-sm
													 focus:outline-none focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/20
													 transition-colors placeholder:text-gray-500 tracking-widest"
									disabled={loading}
									autoComplete="one-time-code"
								/>
								<div className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-cyber-green">
									<Key size={16} />
								</div>
							</div>
						</div>

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
										<span>Verifying...</span>
									</>
								) : (
									<>
										<CheckCircle2 size={16} />
										<span>VERIFY</span>
									</>
								)}
							</div>
						</button>
					</form>

					<div className="border-t border-gray-800/50 p-4 text-center text-xs text-gray-600">
						<button
							type="button"
							onClick={() => navigate("/login")}
							className="text-cyber-cyan hover:text-white transition-colors font-fira"
						>
							Back to login
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
