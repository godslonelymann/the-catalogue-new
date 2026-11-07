import { createContext, use, useEffect, useMemo, type RefObject } from "react";

export type SettingsTab = "profile" | "password" | "two-factor" | "devices";
export const settingsTabs: SettingsTab[] = ["profile", "password", "two-factor", "devices"];

export interface Crumb {
  label: string;
  to?: string;
}

export interface DashboardValue {
  /** Opens Settings. On mobile it closes the navigation Sheet first. */
  requestSettings(tab?: SettingsTab): void;
  openCommand(): void;
  setCrumbs(crumbs: Crumb[]): void;
  crumbs: Crumb[];
  profileTrigger: RefObject<HTMLButtonElement | null>;
  menuButton: RefObject<HTMLButtonElement | null>;
}

export const DashboardContext = createContext<DashboardValue | null>(null);

export function useDashboard(): DashboardValue {
  const value = use(DashboardContext);
  if (!value) throw new Error("useDashboard needs the dashboard layout.");
  return value;
}

/** Sets the breadcrumb trail for the current page. Use names from the API when they exist. */
export function useBreadcrumbs(crumbs: Crumb[]) {
  const { setCrumbs } = useDashboard();
  const key = JSON.stringify(crumbs);
  const stable = useMemo(() => JSON.parse(key) as Crumb[], [key]);
  useEffect(() => setCrumbs(stable), [stable, setCrumbs]);
}

/** Up to two uppercase letters from the email, for the Avatar fallback. */
export function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._+-]+/).filter(part => /[a-z0-9]/i.test(part));
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : local.replace(/[^a-z0-9]/gi, "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

export const isMacPlatform = () =>
  typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "");
