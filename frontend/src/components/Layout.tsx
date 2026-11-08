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
