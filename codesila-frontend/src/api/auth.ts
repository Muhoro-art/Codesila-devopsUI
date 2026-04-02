// src/api/auth.ts
import { API_BASE, readJsonResponse, secureFetch } from "./client";

interface LoginResponse {
  token: string;
  refreshToken?: string;
  user: { id: string; email: string; role: string; name?: string; orgId?: string; onboardingComplete?: boolean };
  organization?: { id: string; name: string; slug: string; logoUrl?: string; industry?: string; size?: string };
  twoFactorRequired?: boolean;
  userId?: string;
}

export interface RegisterInput {
  companyName: string;
  industry?: string;
  companySize: string;
  domain?: string;
  email: string;
  password: string;
  fullName: string;
  jobTitle?: string;
}

export interface RegisterResponse {
  token: string;
  user: { id: string; email: string; role: string; name?: string; orgId: string; onboardingComplete: boolean };
  organization: { id: string; name: string; slug: string; logoUrl?: string; industry?: string; size?: string };
  subscription: { planName: string; status: string } | null;
}

export async function registerCompany(input: RegisterInput): Promise<RegisterResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await readJsonResponse<RegisterResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || "Registration failed");
  return data;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await readJsonResponse<LoginResponse & { error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Login failed");
  }

  return data;
}

export async function login2FA(userId: string, token: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/2fa/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId, token }),
  });

  const data = await readJsonResponse<LoginResponse & { error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "2FA login failed");
  }

  return data;
}

interface Generate2FAResponse {
  qrCode: string;
}

export async function generate2FA(): Promise<Generate2FAResponse> {
  const res = await secureFetch(`${API_BASE}/auth/2fa/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await readJsonResponse<Generate2FAResponse & { error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Failed to generate 2FA");
  }

  return data;
}

export async function verify2FA(token: string) {
  const res = await secureFetch(`${API_BASE}/auth/2fa/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });

  const data = await readJsonResponse<{ ok: true; error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Failed to verify 2FA");
  }

  return data;
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  const res = await secureFetch(`${API_BASE}/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await readJsonResponse<{ ok: true; error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Failed to change password");
  }

  return data;
}

export type AdminUser = {
  id: string;
  email: string;
  role: string;
  orgId: string;
  twoFactorEnabled: boolean;
  isActive: boolean;
  createdAt: string;
};

export async function listUsers() {
  const res = await secureFetch(`${API_BASE}/admin/users`, {});

  const json = await readJsonResponse<{ success: boolean; data: AdminUser[]; error?: { message: string } }>(res);

  if (!res.ok) {
    throw new Error(json.error?.message || "Failed to load users");
  }

  return json.data;
}

export async function createUser(input: {
  email: string;
  password: string;
  role: string;
}) {
  const res = await secureFetch(`${API_BASE}/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await readJsonResponse<AdminUser & { error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Failed to create user");
  }

  return data;
}

export async function updateUser(userId: string, input: { role?: string; isActive?: boolean }) {
  const res = await secureFetch(`${API_BASE}/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await readJsonResponse<{ success: boolean; data: AdminUser; error?: { message: string } }>(res);
  if (!res.ok) throw new Error(data.error?.message || "Failed to update user");
  return data.data;
}

export async function revokeUser(userId: string) {
  const res = await secureFetch(`${API_BASE}/admin/users/${userId}`,
    {
      method: "DELETE",
    }
  );

  const data = await readJsonResponse<{ ok: true; error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Failed to revoke user");
  }

  return data;
}

export async function activateUser(userId: string) {
  const res = await secureFetch(
    `${API_BASE}/admin/users/${userId}/activate`,
    {
      method: "POST",
    }
  );

  const data = await readJsonResponse<{ ok: true; error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Failed to activate user");
  }

  return data;
}

export interface MeResponse {
  id: string;
  email: string;
  role: string;
  name?: string;
  orgId?: string;
}

export async function getMe(): Promise<MeResponse> {
  const res = await secureFetch(`${API_BASE}/auth/me`, {});

  const data = await readJsonResponse<MeResponse & { error?: string }>(res);

  if (!res.ok) {
    throw new Error(data.error || "Failed to fetch profile");
  }

  return data;
}
