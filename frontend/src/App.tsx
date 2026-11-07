import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router";
import type { Api } from "./api/client";
import { ApiContext } from "./api/ApiContext";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { DashboardLayout } from "./dashboard/DashboardLayout";
import { MyStoresPage } from "./dashboard/pages/MyStoresPage";
import { ProductPage } from "./dashboard/pages/ProductPage";
import { NotFoundState, StorePage } from "./dashboard/pages/StorePage";
import { UpdatesPage } from "./dashboard/pages/UpdatesPage";
import { SavedPage } from "./dashboard/pages/SavedPage";
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  SignupSentPage,
  TwoFactorPage,
  VerifyEmailPage,
} from "./pages/AuthPages";
import { LandingPage } from "./pages/LandingPage";

// Development only: the Aceternity sidebar demo. Production builds leave it out.
const SidebarDemoPage = import.meta.env.DEV ? lazy(() => import("./pages/SidebarDemoPage")) : null;

/**
 * /account is kept for old links and for the Google linking callback.
 * It opens Settings on the Profile tab and keeps the callback result.
 */
function AccountRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams({ settings: "profile" });
  const google = params.get("google");
  if (google) next.set("google", google);
  return <Navigate to={`/stores?${next.toString()}`} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/signup/sent" element={<SignupSentPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/two-factor" element={<TwoFactorPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {SidebarDemoPage && (
        <Route
          path="/demo/sidebar"
          element={
            <Suspense fallback={null}>
              <SidebarDemoPage />
            </Suspense>
          }
        />
      )}

      {/* Every route below needs a signed-in account. */}
      <Route element={<DashboardLayout />}>
        <Route path="/stores" element={<MyStoresPage />} />
        <Route path="/stores/:storeId" element={<StorePage />} />
        <Route path="/stores/:storeId/products/:productId" element={<ProductPage />} />
        <Route path="/updates" element={<UpdatesPage />} />
        <Route path="/saved" element={<SavedPage />} />
        {/* Alerts and the wishlist are one list now. Old links open it. */}
        <Route path="/wishlist" element={<Navigate to="/saved" replace />} />
        <Route path="/alerts" element={<Navigate to="/saved" replace />} />
        <Route path="/account" element={<AccountRedirect />} />
        <Route path="*" element={<NotFoundState />} />
      </Route>
    </Routes>
  );
}

export function App({ api }: { api: Api }) {
  return (
    <ApiContext value={api}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ApiContext>
  );
}
