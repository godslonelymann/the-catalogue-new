import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "./Icon";

export function Wordmark({ to }: { to: string }) {
  return (
    <Link to={to} className="wordmark">
      <span className="mark">
        <Icon name="brand" />
      </span>
      The Catalogue
    </Link>
  );
}

export function SkipLink() {
  return (
    <a
      className="skip btn"
      href="#main"
      onClick={event => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}
    >
      Skip to content
    </a>
  );
}

/** Dark public frame from the prototype, for the landing and sign-in pages. */
export function PublicFrame({ nav, children }: { nav?: ReactNode; children: ReactNode }) {
  return (
    <div className="public">
      <SkipLink />
      <header className="site-head">
        <div className="wrap between">
          <Wordmark to="/" />
          {nav && <nav className="row" aria-label="Account">{nav}</nav>}
        </div>
      </header>
      {children}
    </div>
  );
}
