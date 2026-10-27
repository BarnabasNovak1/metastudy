import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { UserDataProvider } from "@/contexts/UserDataContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import AchievementToast from "@/components/AchievementToast";

const FeaturesComponent = lazy(() => import("@/components/Features").then((m) => ({ default: m.Features })));
const Study = lazy(() => import("./pages/Study"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const AccountUsage = lazy(() => import("@/pages/AccountUsage"));
const Achievements = lazy(() => import("@/pages/Achievements"));
const Account = lazy(() => import("./pages/Account"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const CheckoutCancel = lazy(() => import("./pages/CheckoutCancel"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ConfirmEmail = lazy(() => import("./pages/ConfirmEmail"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
const ResponsibleAIPage = lazy(() => import("./pages/ResponsibleAIPage"));
import { CookieConsent } from "@/components/CookieConsent";
import { AIDisclosure } from "@/components/AIDisclosure";
import EmailVerificationGate from "@/components/EmailVerificationGate";

const queryClient = new QueryClient();

// Username gate: disabled for now - Google signup flow in Auth.tsx handles username collection
// This gate was showing incorrectly for users who already have usernames because profile data wasn't loaded yet
const UsernameRequiredGate = () => null;

// Scroll to top on every route change (hash links like /privacy#security handle their own scrolling)
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  // Let us control scroll position instead of the browser restoring it
  useEffect(() => {
    try { window.history.scrollRestoration = 'manual'; } catch {}
  }, []);

  useLayoutEffect(() => {
    if (hash) return;
    // Force an instant jump; this also cancels any in-flight smooth scroll
    // animation left over from hash-section navigation (e.g. /privacy#terms)
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    html.scrollTop = 0;
    document.body.scrollTop = 0;
    html.style.scrollBehavior = prev;
  }, [pathname, hash]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <TooltipProvider>
        <UserDataProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ScrollToTop />
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/study" element={<Study />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/faq" element={<FaqPage />} />
              <Route path="/usage" element={<AccountUsage />} />
              <Route path="/achievements" element={<Achievements />} />
              <Route path="/account" element={<Account />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/auth/confirm" element={<ConfirmEmail />} />
              <Route path="/Features" element={<FeaturesComponent />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="/responsible-ai" element={<ResponsibleAIPage />} />
              <Route path="/checkout/success" element={<CheckoutSuccess />} />
              <Route path="/checkout/cancel" element={<CheckoutCancel />} />
              {/* Hidden admin dashboard - not linked anywhere */}
              <Route path="/internal-ops-7f3k9x-admin" element={<AdminDashboard />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            <UsernameRequiredGate />
            <EmailVerificationGate />
            <AchievementToast />
            <CookieConsent />
            <AIDisclosure />
          </BrowserRouter>
        </UserDataProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
