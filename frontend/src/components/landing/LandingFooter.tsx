import { Link } from "react-router";
import { TextHoverEffect } from "./ui/text-hover-effect";

export function LandingFooter() {
  return (
    <footer className="l-wrap pt-16 md:pt-24">
      <TextHoverEffect text="CATALOGUE" />
      <div className="flex min-h-14 flex-col items-start justify-between gap-3 border-t border-(--l-line) py-5 text-[13px] text-(--l-muted) sm:flex-row sm:items-center">
        <span>© 2026 The Catalogue</span>
        <nav aria-label="Footer" className="flex gap-5">
          <Link to="/login" className="hover:text-(--l-ink)">
            Sign in
          </Link>
          <Link to="/signup" className="hover:text-(--l-ink)">
            Sign up
          </Link>
        </nav>
      </div>
    </footer>
  );
}
