// The dashboard sidebar, adapted from the Aceternity UI sidebar
// (src/components/ui/aceternity-sidebar.tsx). Desktop: a 60 px rail that expands to 300 px
// on hover or keyboard focus. Mobile: the same contents inside the accessible shadcn Sheet.

import { useRef, useState, type FocusEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { IconActivity, IconBuildingStore, IconHeart, IconLogout, IconSelector, IconSettings } from "@tabler/icons-react";
import { useApi } from "@/api/ApiContext";
import { useAuth } from "@/auth/AuthContext";
import { DesktopSidebar, Sidebar as AceternitySidebar, SidebarProvider as AceternityProvider, useSidebar as useAceternity } from "@/components/ui/aceternity-sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { initialsFromEmail, useDashboard } from "./context";

export const railNav = [
  { to: "/stores", label: "My Stores", icon: IconBuildingStore },
  { to: "/updates", label: "Updates", icon: IconActivity },
  { to: "/saved", label: "Saved", icon: IconHeart },
] as const;

const iconClass = "h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200";
/**
 * Every rail item uses the same 44 px square slot for its icon. In the 60 px rail
 * (8 px padding on each side) the slot fills the width, so icons stay centred.
 */
const slot = "flex size-11 shrink-0 items-center justify-center";
const item = "flex h-11 w-full items-center rounded-lg";

/** Desktop rail (768 px and wider). */
export function DesktopRail() {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const rail = useRef<HTMLDivElement>(null);
  // While the profile menu is open, the rail stays open, so the menu keeps its anchor.
  const menuOpen = useRef(false);

  function collapseIfIdle() {
    const element = rail.current;
    if (!element || menuOpen.current) return;
    if (element.matches(":hover") || element.contains(document.activeElement)) return;
    setOpen(false);
  }

  return (
    <AceternitySidebar open={open} setOpen={setOpen}>
      <div ref={rail} id="rail" className="sticky top-0 hidden h-svh shrink-0 md:block">
        <DesktopSidebar
          className="justify-between gap-6 border-r border-neutral-200 px-2 py-3 dark:border-neutral-700"
          transition={reduceMotion ? { duration: 0 } : undefined}
          onMouseLeave={() => {
            if (!menuOpen.current) setOpen(false);
          }}
          onFocus={() => setOpen(true)}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !menuOpen.current) setOpen(false);
          }}
        >
          <RailContents
            onMenuOpenChange={value => {
              menuOpen.current = value;
              if (value) setOpen(true);
              else requestAnimationFrame(collapseIfIdle);
            }}
          />
        </DesktopSidebar>
      </div>
    </AceternitySidebar>
  );
}

/** Mobile: the rail contents, always expanded, inside the navigation Sheet. */
export function MobileRailContents() {
  return (
    <AceternityProvider open setOpen={() => {}}>
      <div className="flex h-full flex-col justify-between gap-6 bg-neutral-100 px-3 py-3 dark:bg-neutral-800">
        <RailContents />
      </div>
    </AceternityProvider>
  );
}

function RailContents({ onMenuOpenChange }: { onMenuOpenChange?(open: boolean): void }) {
  const { open } = useAceternity();
  const location = useLocation();
  return (
    <>
      <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <Link
          to="/stores"
          aria-label="The Catalogue"
          className={cn(item, "relative z-20 text-sm font-normal text-black")}
        >
          <span className={slot}>
            <span className="h-5 w-6 shrink-0 rounded-tl-lg rounded-tr-sm rounded-br-lg rounded-bl-sm bg-black dark:bg-white" />
          </span>
          {open && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pr-3 font-medium whitespace-pre text-black dark:text-white">
              The Catalogue
            </motion.span>
          )}
        </Link>
        <nav aria-label="Main" className="mt-6 flex flex-col gap-1">
          {railNav.map(item => {
            const exact = location.pathname === item.to;
            const active = exact || location.pathname.startsWith(item.to + "/");
            return (
              <RailLink
                key={item.to}
                to={item.to}
                label={item.label}
                active={active}
                current={exact ? "page" : active ? "location" : undefined}
                icon={<item.icon className={cn(iconClass, active && "text-black dark:text-white")} stroke={active ? 2.2 : 2} />}
              />
            );
          })}
        </nav>
      </div>
      <ProfileMenu onOpenChange={onMenuOpenChange} />
    </>
  );
}

/** Aceternity's SidebarLink, with router navigation, an active state, and an accessible name. */
function RailLink({
  to,
  label,
  icon,
  active,
  current,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  current?: "page" | "location";
}) {
  const { open, animate } = useAceternity();
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={current}
      className={cn(
        item,
        "group/sidebar",
        active ? "bg-neutral-200 dark:bg-neutral-700" : "hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60",
      )}
    >
      <span className={slot}>{icon}</span>
      <motion.span
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className={cn(
          "pr-3 text-neutral-700 dark:text-neutral-200 text-sm group-hover/sidebar:translate-x-1 transition duration-150 whitespace-pre inline-block",
          active && "font-semibold text-black dark:text-white",
        )}
      >
        {label}
      </motion.span>
    </Link>
  );
}

function ProfileMenu({ onOpenChange }: { onOpenChange?(open: boolean): void }) {
  const api = useApi();
  const { account, setAccount } = useAuth();
  const { requestSettings, profileTrigger } = useDashboard();
  const { open, animate } = useAceternity();
  const navigate = useNavigate();
  const pendingSettings = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const email = account?.email ?? "";

  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      await api.signOut();
      setAccount(null);
      navigate("/login", { replace: true, state: { notice: "You signed out." } });
    } catch (failure) {
      setError(failure instanceof Error ? `Couldn’t sign out. ${failure.message}` : "Couldn’t sign out. Try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="border-t border-neutral-200 pt-3 dark:border-neutral-700">
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            ref={profileTrigger}
            type="button"
            aria-label={`Profile menu for ${email}`}
            className={cn(item, "group/sidebar text-left hover:bg-neutral-200/60 data-[state=open]:bg-neutral-200 dark:hover:bg-neutral-700/60")}
          >
            <span className={slot} aria-hidden="true">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-[11px] font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900">
                {initialsFromEmail(email)}
              </span>
            </span>
            <motion.span
              aria-hidden="true"
              animate={{
                display: animate ? (open ? "inline-block" : "none") : "inline-block",
                opacity: animate ? (open ? 1 : 0) : 1,
              }}
              className="min-w-0 flex-1 truncate pr-1 text-sm text-neutral-700 dark:text-neutral-200"
            >
              {email}
            </motion.span>
            {open && <IconSelector className="mr-3 ml-auto h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={4}
          className="min-w-56 rounded-lg"
          onCloseAutoFocus={event => {
            if (!pendingSettings.current) return;
            pendingSettings.current = false;
            event.preventDefault();
            requestSettings("profile");
          }}
        >
          <DropdownMenuLabel className="px-2 py-2 font-normal">
            <span className="block text-[13px] text-muted-foreground">Signed in as</span>
            <span className="block max-w-64 text-sm font-medium break-all text-foreground">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => (pendingSettings.current = true)}>
            <IconSettings />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
            <IconLogout />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="pt-2 text-[13px] leading-[18px] text-black dark:text-white">
          {error}
        </p>
      )}
    </div>
  );
}
