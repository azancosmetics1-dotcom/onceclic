import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Organization, OrganizationMembership, UserRole } from '@onceclic/shared';
import { api } from '../api/client';

interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  membership: OrganizationMembership | null;
  role: UserRole | null;
  organizations: Array<{ organization: Organization; membership: OrganizationMembership }>;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string, fullName: string, businessName?: string) => Promise<void>;
  logout: () => void;
  switchOrganization: (orgId: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [organizations, setOrganizations] = useState<
    Array<{ organization: Organization; membership: OrganizationMembership }>
  >([]);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    try {
      const data = await api.getProfile();
      setUser(data.user);
      setOrganizations(data.organizations);

      if (data.organizations.length > 0) {
        const storedOrgId = localStorage.getItem('onceclic_org_id');
        const active =
          data.organizations.find((o) => o.organization.id === storedOrgId) || data.organizations[0];

        setOrganization(active.organization);
        setMembership(active.membership);
        api.setOrgId(active.organization.id);
      }
    } catch (err) {
      console.warn('[AuthContext] Session expired or invalid');
      api.clearAuth();
      setUser(null);
      setOrganization(null);
      setMembership(null);
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('onceclic_token');
    if (token) {
      refreshProfile();
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, pass: string) => {
    const res = await api.login({ email, password: pass });
    setUser(res.user);
    if (res.organization && res.membership) {
      setOrganization(res.organization);
      setMembership(res.membership);
      api.setOrgId(res.organization.id);
    }
    await refreshProfile();
  };

  const register = async (email: string, pass: string, fullName: string, businessName?: string) => {
    const res = await api.register({ email, password: pass, fullName, businessName });
    setUser(res.user);
    if (res.organization && res.membership) {
      setOrganization(res.organization);
      setMembership(res.membership);
      api.setOrgId(res.organization.id);
    }
    await refreshProfile();
  };

  const switchOrganization = async (orgId: string) => {
    const target = organizations.find((o) => o.organization.id === orgId);
    if (target) {
      setOrganization(target.organization);
      setMembership(target.membership);
      api.setOrgId(target.organization.id);
    }
  };

  const logout = () => {
    api.clearAuth();
    setUser(null);
    setOrganization(null);
    setMembership(null);
    setOrganizations([]);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        membership,
        role: membership?.role || null,
        organizations,
        loading,
        login,
        register,
        logout,
        switchOrganization,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
