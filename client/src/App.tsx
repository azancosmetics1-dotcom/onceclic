import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

// Public Marketing & Legal Pages
import { Home } from './pages/Home';
import { Pricing } from './pages/Pricing';
import { Terms } from './pages/Terms';
import { Privacy } from './pages/Privacy';
import { RefundPolicy } from './pages/RefundPolicy';
import { CookiePolicy } from './pages/CookiePolicy';
import { AcceptableUse } from './pages/AcceptableUse';
import { Security } from './pages/Security';
import { About } from './pages/About';
import { FAQ } from './pages/FAQ';
import { Disclaimer } from './pages/Disclaimer';
import { Contact } from './pages/Contact';

// Auth & Verification
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { VerifyEmail } from './pages/VerifyEmail';
import { AuthCallback } from './pages/AuthCallback';
import { Onboarding } from './pages/Onboarding';
import { Welcome } from './pages/Welcome';

// App Dashboard
import { AppLayout } from './components/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { AnalyticsPage } from './pages/Analytics';
import { IntegrationsPage } from './pages/Integrations';
import { AIEmployeePage } from './pages/AIEmployee';
import { AIReceptionistPage } from './pages/AIReceptionist';
import { KnowledgeBase } from './pages/KnowledgeBase';
import { AppointmentsPage } from './pages/Appointments';
import { ConversationsPage } from './pages/Conversations';
import { EmailPage } from './pages/Email';
import { BillingPage } from './pages/Billing';
import { SettingsPage } from './pages/Settings';

// Public Hosted Chat & Dedicated Booking
import { HostedChat } from './pages/HostedChat';
import { PublicBooking } from './pages/PublicBooking';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Marketing & Legal */}
          <Route path="/" element={<Home />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy-policy" element={<Privacy />} />
          <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
          <Route path="/refund-policy" element={<RefundPolicy />} />
          <Route path="/refund" element={<Navigate to="/refund-policy" replace />} />
          <Route path="/cookie-policy" element={<CookiePolicy />} />
          <Route path="/cookies" element={<Navigate to="/cookie-policy" replace />} />
          <Route path="/acceptable-use" element={<AcceptableUse />} />
          <Route path="/security" element={<Security />} />
          <Route path="/about" element={<About />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/disclaimer" element={<Disclaimer />} />
          <Route path="/contact" element={<Contact />} />

          {/* Auth & Verification */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Onboarding & Welcome */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/welcome"
            element={
              <ProtectedRoute>
                <Welcome />
              </ProtectedRoute>
            }
          />

          {/* SaaS Dashboard App */}
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="integrations" element={<IntegrationsPage />} />
            <Route path="ai-employee" element={<AIEmployeePage />} />
            <Route path="ai-receptionist" element={<AIReceptionistPage />} />
            <Route path="knowledge" element={<KnowledgeBase />} />
            <Route path="appointments" element={<AppointmentsPage />} />
            <Route path="conversations" element={<ConversationsPage />} />
            <Route path="email" element={<EmailPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          {/* Public Hosted Chat for Visitors */}
          <Route path="/chat/:orgSlug" element={<HostedChat />} />

          {/* Public Dedicated Booking & Reservation Page */}
          <Route path="/book/:orgSlug" element={<PublicBooking />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};
