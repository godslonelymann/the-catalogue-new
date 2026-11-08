import { lazy, Suspense, useEffect } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { Hero } from "../components/landing/Hero";
import { LandingNav } from "../components/landing/LandingNav";
import { SkipLink } from "../components/Layout";

// Everything under the hero loads as its own chunk, so the first paint needs only the hero.
const BelowFold = lazy(() => import("../components/landing/BelowFold"));

export function LandingPage() {
  const { account, loading } = useAuth();

  useEffect(() => {
    document.title = "The Catalogue";
  }, []);

  if (!loading && account) return <Navigate to="/stores" replace />;

  return (
    <div className="landing-theme">
      <SkipLink />
      <LandingNav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <Suspense fallback={<div className="min-h-[100svh]" />}>
          <BelowFold />
        </Suspense>
      </main>
    </div>
  );
}
