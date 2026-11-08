import { useCallback, useState } from "react";
import { Link } from "react-router";
import { Wordmark } from "../Layout";
import {
  MobileNav,
  MobileNavHeader,
  MobileNavMenu,
  MobileNavToggle,
  NavBody,
  NavItems,
  Navbar,
} from "./ui/resizable-navbar";

const items = [
  { name: "How it works", link: "#how-it-works" },
  { name: "Features", link: "#features" },
  { name: "FAQ", link: "#faq" },
];

const MENU_ID = "landing-mobile-menu";

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <header>
      <Navbar>
        <NavBody>
          <Wordmark to="/" />
          <NavItems items={items} />
          <nav aria-label="Account" className="relative z-10 flex items-center gap-2">
            <Link to="/login" className="l-btn l-btn-sm l-btn-quiet">
              Sign in
            </Link>
            <Link to="/signup" className="l-btn l-btn-sm l-btn-primary">
              Get started
            </Link>
          </nav>
        </NavBody>

        <MobileNav>
          <MobileNavHeader>
            <Wordmark to="/" />
            <MobileNavToggle isOpen={open} onClick={() => setOpen(o => !o)} controls={MENU_ID} />
          </MobileNavHeader>
          <MobileNavMenu id={MENU_ID} isOpen={open} onClose={close}>
            <nav aria-label="Sections" className="flex flex-col">
              {items.map(item => (
                <a
                  key={item.link}
                  href={item.link}
                  onClick={close}
                  className="flex h-11 items-center rounded-xl px-3 text-[15px] text-(--l-ink) hover:bg-black/[0.04]"
                >
                  {item.name}
                </a>
              ))}
            </nav>
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-(--l-line) pt-3">
              <Link to="/login" className="l-btn l-btn-ghost">
                Sign in
              </Link>
              <Link to="/signup" className="l-btn l-btn-primary">
                Get started
              </Link>
            </div>
          </MobileNavMenu>
        </MobileNav>
      </Navbar>
    </header>
  );
}
