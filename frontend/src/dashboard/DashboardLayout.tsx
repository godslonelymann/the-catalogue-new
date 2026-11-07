import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { HeartIcon, MenuIcon, PlusIcon, PulseIcon, StoreIcon } from "./icons";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sidebar, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardContext, isMacPlatform, settingsTabs, type Crumb, type SettingsTab } from "./context";
import { Crumbs, useFocusReturn } from "./parts";
import { DesktopRail, MobileRailContents } from "./Rail";
import { SettingsDialog } from "./settings/SettingsDialog";

const nav = [
  { to: "/stores", label: "My Stores", icon: StoreIcon },
  { to: "/updates", label: "Updates", icon: PulseIcon },
  { to: "/saved", label: "Saved", icon: HeartIcon },
] as const;

/**
 * Matches the start of the label or of a word in it, so "add" finds "Add a store" and not "Saved".
 * Earlier matches rank higher.
 */
function commandFilter(value: string, search: string): number {
  const label = value.toLowerCase();
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  if (label.startsWith(query)) return 1;
  if (label.split(/\s+/).some(word => word.startsWith(query))) return 0.5;
  return 0;
}

/** Every signed-in route renders inside this layout. Signed-out visitors go to sign-in. */
export function DashboardLayout() {
  const { account, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="dashboard-theme flex min-h-svh" aria-busy="true">
        <div className="hidden w-[60px] border-r border-neutral-200 bg-neutral-100 md:block" />
        <div className="flex-1 p-8">
          <Skeleton className="h-9 w-48" />
        </div>
      </div>
    );
  }
  if (!account) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <SidebarProvider className="dashboard-theme bg-background">
      <Shell />
    </SidebarProvider>
  );
}

function Shell() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const settingsAfterSheet = useRef<SettingsTab | null>(null);
  const commandFocus = useFocusReturn();
  const openCommand = useCallback(() => {
    commandFocus.capture();
    setCommandOpen(true);
  }, [commandFocus]);

  // /account and Google linking return here with ?settings=profile.
  const requestedTab = params.get("settings") as SettingsTab | null;
  const [handledTab, setHandledTab] = useState<string | null>(null);
  if (requestedTab && settingsTabs.includes(requestedTab) && handledTab !== requestedTab) {
    setHandledTab(requestedTab);
    setSettingsTab(requestedTab);
  }

  // Close the mobile navigation after each navigation.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    if (openMobile) setOpenMobile(false);
  }

  const requestSettings = useCallback(
    (tab: SettingsTab = "profile") => {
      if (isMobile && openMobile) {
        // Close the Sheet first. Settings opens after the Sheet has closed.
        settingsAfterSheet.current = tab;
        setOpenMobile(false);
      } else {
        setSettingsTab(tab);
      }
    },
    [isMobile, openMobile, setOpenMobile],
  );

  const anyModalOpen = settingsTab !== null || commandOpen || openMobile;
  useEffect(() => {
    const mac = isMacPlatform();
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (commandOpen) return setCommandOpen(false);
      // Keep at most one modal open.
      if (anyModalOpen || document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      openCommand();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyModalOpen, commandOpen, openCommand]);

  const value = useMemo(
    () => ({
      requestSettings,
      openCommand,
      setCrumbs,
      crumbs,
      profileTrigger,
      menuButton,
    }),
    [requestSettings, openCommand, crumbs],
  );

  function closeSettings() {
    setSettingsTab(null);
    if (params.has("settings") || params.has("google")) {
      const next = new URLSearchParams(params);
      next.delete("settings");
      next.delete("google");
      setParams(next, { replace: true });
    }
  }

  return (
    <DashboardContext value={value}>
      <a
        href="#main"
        onClick={event => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
        className="sr-only z-50 rounded-lg bg-background px-4 py-3 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <DesktopRail />
      {/* Below 768 px the same contents open in an accessible Sheet (focus trap, Escape, focus return). */}
      {isMobile && (
        <Sidebar
          onMobileCloseAutoFocus={event => {
            const tab = settingsAfterSheet.current;
            if (!tab) return;
            settingsAfterSheet.current = null;
            event.preventDefault();
            setSettingsTab(tab);
          }}
        >
          <MobileRailContents />
        </Sidebar>
      )}

      <div className="flex min-h-svh min-w-0 flex-1 flex-col bg-background">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:px-6 lg:px-8">
          <Button
            ref={menuButton}
            variant="ghost"
            size="icon"
            className="-ml-2 md:hidden"
            aria-label="Menu"
            aria-expanded={openMobile}
            onClick={() => setOpenMobile(true)}
          >
            <MenuIcon />
          </Button>
          <Link to="/stores" className="flex h-11 items-center text-[15px] font-semibold tracking-tight md:hidden">
            The Catalogue
          </Link>
          <Crumbs crumbs={crumbs} className="hidden min-w-0 md:block" />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 outline-none md:px-6 md:py-8 lg:px-8">
          <Outlet />
        </main>
      </div>

      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        navigate={to => navigate(to)}
        restoreFocus={event => commandFocus.restore(event, () => document.getElementById("main"))}
      />
      <SettingsDialog
        tab={settingsTab}
        onTabChange={setSettingsTab}
        onClose={closeSettings}
        googleResult={params.get("google")}
        restoreFocus={() => (isMobile ? menuButton.current : profileTrigger.current)?.focus()}
      />
    </DashboardContext>
  );
}

function CommandMenu({
  open,
  onOpenChange,
  navigate,
  restoreFocus,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  navigate(to: string): void;
  restoreFocus(event: Event): void;
}) {
  // The chosen action runs after the Command dialog has closed, so two modals never overlap.
  const pending = useRef<(() => void) | null>(null);
  const run = (action: () => void) => {
    pending.current = action;
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 shadow-xl sm:max-w-lg"
        onCloseAutoFocus={event => {
          const action = pending.current;
          if (!action) return restoreFocus(event);
          pending.current = null;
          event.preventDefault();
          action();
        }}
      >
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <DialogDescription className="sr-only">Go to a section or add a store.</DialogDescription>
        <Command className="rounded-none" filter={commandFilter}>
          <CommandInput placeholder="Type a command" aria-label="Search commands" />
          <CommandList>
            <CommandEmpty>No matching commands.</CommandEmpty>
            <CommandGroup heading="Go to">
              {nav.map(item => (
                <CommandItem key={item.to} value={item.label} onSelect={() => run(() => navigate(item.to))}>
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem value="Add a store" onSelect={() => run(() => navigate("/stores?add=1"))}>
                <PlusIcon />
                Add a store
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
