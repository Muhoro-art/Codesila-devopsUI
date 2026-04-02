// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  API_BASE,
  getAuthToken,
  setAuthToken,
  setRefreshToken,
  clearTokens,
  refreshAccessToken,
} from '../api/client';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  domain?: string;
  industry?: string;
  size?: string;
}

export interface User {
  id: string;
  name?: string;
  email: string;
  role: string;
  orgId?: string;
  onboardingComplete?: boolean;
}

interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User, org?: Organization, refreshTkn?: string) => void;
  logout: () => void;
  setOrganization: (org: Organization) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  organization: null,
  token: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
  setOrganization: () => {},
});

/**
 * Decode a JWT payload without verification (client-side only for expiry check).
 * Returns null if the token is malformed.
 */
function decodeTokenPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch {
    return null;
  }
}

/** Refresh the access token 60 seconds before it expires. */
const REFRESH_BUFFER_MS = 60_000;

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganizationState] = useState<Organization | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Clear any scheduled refresh timer. */
  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  /** Schedule an automatic token refresh based on access token expiry. */
  const scheduleTokenRefresh = useCallback((accessToken: string) => {
    clearRefreshTimer();
    const payload = decodeTokenPayload(accessToken);
    if (!payload?.exp) return;

    const expiresAt = payload.exp * 1000;
    const now = Date.now();
    const delay = Math.max(expiresAt - now - REFRESH_BUFFER_MS, 5_000); // min 5s

    refreshTimerRef.current = setTimeout(async () => {
      const newToken = await refreshAccessToken();
      if (newToken) {
        setToken(newToken);
        scheduleTokenRefresh(newToken);
      } else {
        // Refresh failed — session expired
        clearTokens();
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('organization');
        setToken(null);
        setUser(null);
        setOrganizationState(null);
      }
    }, delay);
  }, [clearRefreshTimer]);

  // Load auth state from sessionStorage on mount, then verify with server
  useEffect(() => {
    const storedToken = getAuthToken();
    const storedUser = sessionStorage.getItem('user');
    const storedOrg = sessionStorage.getItem('organization');

    if (!storedToken || !storedUser) {
      clearTokens();
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('organization');
      setIsLoading(false);
      return;
    }

    try {
      const parsedUser = JSON.parse(storedUser) as User;
      setToken(storedToken);
      setUser(parsedUser);
      if (storedOrg) {
        setOrganizationState(JSON.parse(storedOrg) as Organization);
      }
    } catch {
      clearTokens();
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('organization');
      setIsLoading(false);
      return;
    }

    // Verify token with server and refresh user + org data
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          // Try refreshing the token
          const newToken = await refreshAccessToken();
          if (!newToken) {
            clearTokens();
            sessionStorage.removeItem('user');
            sessionStorage.removeItem('organization');
            setToken(null);
            setUser(null);
            setOrganizationState(null);
            return;
          }
          setToken(newToken);
          scheduleTokenRefresh(newToken);
          // Re-fetch /me with new token
          const retryRes = await fetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${newToken}` },
          });
          if (!retryRes.ok) {
            clearTokens();
            sessionStorage.removeItem('user');
            sessionStorage.removeItem('organization');
            setToken(null);
            setUser(null);
            setOrganizationState(null);
            return;
          }
          const fresh = await retryRes.json();
          const updated: User = {
            id: fresh.id,
            email: fresh.email,
            name: fresh.name,
            role: fresh.role,
            orgId: fresh.orgId,
            onboardingComplete: fresh.onboardingComplete,
          };
          sessionStorage.setItem('user', JSON.stringify(updated));
          setUser(updated);
          if (fresh.organization) {
            const org: Organization = {
              id: fresh.organization.id,
              name: fresh.organization.name,
              slug: fresh.organization.slug,
              logoUrl: fresh.organization.logoUrl,
              domain: fresh.organization.domain,
              industry: fresh.organization.industry,
              size: fresh.organization.size,
            };
            sessionStorage.setItem('organization', JSON.stringify(org));
            setOrganizationState(org);
          }
          return;
        }

        // Token still valid — schedule refresh and update state
        scheduleTokenRefresh(storedToken);
        const fresh = await res.json();
        const updated: User = {
          id: fresh.id,
          email: fresh.email,
          name: fresh.name,
          role: fresh.role,
          orgId: fresh.orgId,
          onboardingComplete: fresh.onboardingComplete,
        };
        sessionStorage.setItem('user', JSON.stringify(updated));
        setUser(updated);

        if (fresh.organization) {
          const org: Organization = {
            id: fresh.organization.id,
            name: fresh.organization.name,
            slug: fresh.organization.slug,
            logoUrl: fresh.organization.logoUrl,
            domain: fresh.organization.domain,
            industry: fresh.organization.industry,
            size: fresh.organization.size,
          };
          sessionStorage.setItem('organization', JSON.stringify(org));
          setOrganizationState(org);
        }
      })
      .catch(() => {
        // Network error — keep stored data, schedule refresh anyway
        if (storedToken) scheduleTokenRefresh(storedToken);
      })
      .finally(() => setIsLoading(false));

    return () => clearRefreshTimer();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback((newToken: string, newUser: User, org?: Organization, refreshTkn?: string) => {
    setAuthToken(newToken);
    sessionStorage.setItem('user', JSON.stringify(newUser));
    if (refreshTkn) {
      setRefreshToken(refreshTkn);
    }
    if (org) {
      sessionStorage.setItem('organization', JSON.stringify(org));
      setOrganizationState(org);
    }
    setToken(newToken);
    setUser(newUser);
    scheduleTokenRefresh(newToken);
  }, [scheduleTokenRefresh]);

  const setOrganization = useCallback((org: Organization) => {
    sessionStorage.setItem('organization', JSON.stringify(org));
    setOrganizationState(org);
  }, []);

  const logout = useCallback(() => {
    clearRefreshTimer();
    clearTokens();
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('organization');
    setToken(null);
    setUser(null);
    setOrganizationState(null);
  }, [clearRefreshTimer]);

  return (
    <AuthContext.Provider value={{ user, organization, token, isLoading, login, logout, setOrganization }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};