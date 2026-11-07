import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { useApi } from "@/api/ApiContext";
import type { SessionInfo, TwoFactorSetup } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { dateTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { LoaderIcon, MonitorIcon } from "../icons";
import { settingsTabs, type SettingsTab } from "../context";
import { RetryAlert, StatusBadge } from "../parts";

const labels: Record<SettingsTab, string> = {
  profile: "Profile",
  password: "Password",
  "two-factor": "Two-factor authentication",
  devices: "Devices",
};

interface Props {
  tab: SettingsTab | null;
  onTabChange(tab: SettingsTab): void;
  onClose(): void;
  /** Result of the Google linking callback, from the URL. */
  googleResult: string | null;
  restoreFocus(): void;
}

/**
 * Settings, from the sidebar-13 block structure: a section list beside a scrolling panel.
 * All state lives inside the dialog content, so it is cleared when the dialog closes.
 */
export function SettingsDialog({ tab, onTabChange, onClose, googleResult, restoreFocus }: Props) {
  const isMobile = useIsMobile();
  return (
    <Dialog open={tab !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent
        onCloseAutoFocus={event => {
          event.preventDefault();
          restoreFocus();
        }}
        className="flex flex-col gap-0 overflow-hidden p-0 shadow-xl md:h-[min(640px,85dvh)] md:max-h-[85dvh] md:max-w-[760px]! max-md:inset-0! max-md:top-0! max-md:left-0! max-md:h-dvh! max-md:w-screen! max-md:max-w-none! max-md:translate-x-0! max-md:translate-y-0! max-md:rounded-none!"
      >
        <div className="flex h-14 shrink-0 items-center border-b pr-14 pl-4 md:pl-6">
          <DialogTitle className="dash-section-title">Settings</DialogTitle>
          <DialogDescription className="sr-only">Manage your profile, password, two-factor authentication, and devices.</DialogDescription>
        </div>
        {tab && (
          <Tabs
            value={tab}
            onValueChange={value => onTabChange(value as SettingsTab)}
            orientation={isMobile ? "horizontal" : "vertical"}
            className="min-h-0 flex-1 gap-0 md:flex-row"
          >
            <TabsList
              className="h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-2 md:h-auto! md:w-52 md:flex-col md:items-stretch md:self-stretch md:justify-start md:overflow-visible md:border-r md:border-b-0 md:bg-sidebar"
              aria-label="Settings sections"
            >
              {settingsTabs.map(value => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-11 flex-none justify-start px-3 text-muted-foreground data-active:bg-selected data-active:text-primary data-active:shadow-none md:w-full"
                >
                  {labels[value]}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
              <TabsContent value="profile">
                <ProfileTab googleResult={googleResult} />
              </TabsContent>
              <TabsContent value="password">
                <PasswordTab />
              </TabsContent>
              <TabsContent value="two-factor">
                <TwoFactorTab />
              </TabsContent>
              <TabsContent value="devices">
                <DevicesTab />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="dash-section-title">{title}</h2>
        {description && <p className="dash-meta mt-1">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">{children}</div>;
}

/** Pending and error feedback beside the action that caused it. */
function ActionStatus({ pending, error, pendingText }: { pending?: boolean; error?: string; pendingText?: string }) {
  if (pending)
    return (
      <span role="status" className="dash-meta inline-flex items-center gap-1.5">
        <LoaderIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {pendingText ?? "Saving…"}
      </span>
    );
  if (error)
    return (
      <span role="alert" className="text-[13px] leading-[18px] text-error">
        {error}
      </span>
    );
  return null;
}

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

function useSignedOut() {
  const { setAccount } = useAuth();
  const navigate = useNavigate();
  return (notice: string) => {
    setAccount(null);
    navigate("/login", { replace: true, state: { notice } });
  };
}

const googleMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  linked: { tone: "success", text: "Google is now linked to your account." },
  reauthentication_required: { tone: "error", text: "For your security, sign in again, then link Google within a few minutes." },
  already_linked: { tone: "error", text: "That Google account is linked to a different Catalogue account." },
  cancelled: { tone: "error", text: "Google linking was cancelled." },
};

function ProfileTab({ googleResult }: { googleResult: string | null }) {
  const api = useApi();
  const { account } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!account) return null;
  const result = googleResult ? (googleMessages[googleResult] ?? { tone: "error" as const, text: "We couldn’t link Google. Try again." }) : null;

  async function linkGoogle() {
    setPending(true);
    setError("");
    try {
      // The API checks for a recent sign-in, then sends the browser to Google.
      await api.linkGoogle();
    } catch (failure) {
      setError(message(failure, "We couldn’t start Google linking."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section title="Profile">
      <Row>
        <div className="min-w-0">
          <p className="dash-meta">Email</p>
          <p className="font-medium break-all">{account.email}</p>
        </div>
        {account.emailVerified ? <StatusBadge tone="success">Verified</StatusBadge> : <StatusBadge tone="pending">Not verified</StatusBadge>}
      </Row>
      <Row>
        <div className="min-w-0">
          <p className="font-medium">Google</p>
          <p className="dash-meta">{account.googleLinked ? "You can sign in with Google." : "Link Google to sign in with it."}</p>
          {result && (
            <p role="status" className={result.tone === "success" ? "mt-1 text-[13px] text-success" : "mt-1 text-[13px] text-error"}>
              {result.text}
            </p>
          )}
        </div>
        {account.googleLinked ? (
          <StatusBadge tone="success">Linked</StatusBadge>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <ActionStatus pending={pending} error={error} pendingText="Opening Google…" />
            <Button variant="outline" disabled={pending} onClick={() => void linkGoogle()}>
              Link Google
            </Button>
          </div>
        )}
      </Row>
    </Section>
  );
}

function PasswordTab() {
  const api = useApi();
  const { account } = useAuth();
  const signedOut = useSignedOut();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!account) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next.length < 8) return setError("Use at least 8 characters.");
    setPending(true);
    setError("");
    try {
      await api.changePassword(current, next);
      signedOut("Your password changed. All devices are signed out. Sign in with your new password.");
    } catch (failure) {
      setError(message(failure, "We couldn’t change your password."));
      setPending(false);
    }
  }

  return (
    <Section
      title={account.hasPassword ? "Change password" : "Set a password"}
      description="After the change, every device is signed out, including this one."
    >
      <form noValidate onSubmit={submit} className="max-w-sm">
        <FieldGroup>
          {account.hasPassword && (
            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} />
            </Field>
          )}
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              aria-invalid={Boolean(error)}
              aria-describedby="new-password-help"
              onChange={event => {
                setNext(event.target.value);
                setError("");
              }}
            />
            <FieldDescription id="new-password-help">Use at least 8 characters.</FieldDescription>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              Save password
            </Button>
            <ActionStatus pending={pending} error={error} />
          </div>
        </FieldGroup>
      </form>
    </Section>
  );
}

function CodeField({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange(value: string): void; error?: string }) {
  return (
    <Field data-invalid={Boolean(error) || undefined} className="max-w-56">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className="font-mono tracking-[0.3em] tabular-nums"
        value={value}
        aria-invalid={Boolean(error)}
        onChange={event => onChange(event.target.value.replace(/\D/g, ""))}
      />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

function TwoFactorTab() {
  const api = useApi();
  const { account, refresh } = useAuth();
  // Setup secrets and recovery codes stay in component memory only.
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"start" | "confirm" | "disable" | null>(null);
  const [error, setError] = useState("");
  if (!account) return null;

  async function act(kind: "start" | "confirm" | "disable", action: () => Promise<void>) {
    setPending(kind);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(message(failure, "That didn’t work. Try again."));
    } finally {
      setPending(null);
    }
  }

  if (codes) {
    return (
      <Section title="Save your recovery codes" description="Each code works once. Use one to sign in if you lose your authenticator app. We show these codes only now.">
        <ol className="grid max-w-sm grid-cols-2 gap-2 rounded-lg bg-secondary p-4 font-mono text-sm tabular-nums" aria-label="Recovery codes">
          {codes.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <div>
          <Button onClick={() => setCodes(null)}>I saved my codes</Button>
        </div>
      </Section>
    );
  }

  if (account.twoFactorEnabled) {
    return (
      <Section title="Two-factor authentication" description="We ask for a code from your authenticator app after each sign-in.">
        <Row>
          <div>
            <p className="font-medium">Authenticator app</p>
            <p className="dash-meta tabular-nums">{account.recoveryCodesLeft} recovery codes left</p>
          </div>
          <StatusBadge tone="success">On</StatusBadge>
        </Row>
        <form
          noValidate
          className="flex flex-col gap-3 border-t pt-4"
          onSubmit={event => {
            event.preventDefault();
            void act("disable", async () => {
              await api.disableTwoFactor(code);
              setCode("");
              await refresh();
            });
          }}
        >
          <p className="font-medium">Turn off two-factor authentication</p>
          <CodeField id="disable-code" label="Code from your authenticator app" value={code} onChange={setCode} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline" disabled={pending !== null || code.length !== 6}>
              Turn off
            </Button>
            <ActionStatus pending={pending === "disable"} error={error} pendingText="Turning off…" />
          </div>
        </form>
      </Section>
    );
  }

  if (!setup) {
    return (
      <Section title="Two-factor authentication" description="Add a code from an authenticator app to each sign-in.">
        <Row>
          <div>
            <p className="font-medium">Authenticator app</p>
            <p className="dash-meta">Off</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ActionStatus pending={pending === "start"} error={error} pendingText="Preparing…" />
            <Button disabled={pending !== null} onClick={() => void act("start", async () => setSetup(await api.startTwoFactorSetup()))}>
              Set up
            </Button>
          </div>
        </Row>
      </Section>
    );
  }

  return (
    <Section
      title="Set up two-factor authentication"
      description="Scan this QR code with your authenticator app, such as Google Authenticator, 1Password, or Authy. Then enter the 6-digit code from the app."
    >
      {/* Drawn in the browser. The secret is never sent to another service. */}
      <div role="img" aria-label="QR code for two-factor setup" className="w-fit rounded-lg border bg-white p-3">
        <QRCodeSVG value={setup.otpauthUrl} size={176} level="M" marginSize={0} />
      </div>
      <details className="group text-sm">
        <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Can’t scan the code? Enter a key instead
        </summary>
        <p className="mt-2 text-muted-foreground">In your app, choose to enter a setup key, and type this key. Use a time-based code.</p>
        <p className="mt-2 rounded-lg bg-secondary p-3 font-mono text-sm break-all tabular-nums" aria-label="Setup key">
          {setup.secret.match(/.{1,4}/g)?.join(" ")}
        </p>
      </details>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={event => {
          event.preventDefault();
          void act("confirm", async () => {
            const result = await api.confirmTwoFactor(code);
            setSetup(null);
            setCode("");
            setCodes(result.recoveryCodes);
            await refresh();
          });
        }}
      >
        <CodeField id="setup-code" label="Code from your authenticator app" value={code} onChange={setCode} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending !== null || code.length !== 6}>
            Turn on
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
            Cancel
          </Button>
          <ActionStatus pending={pending === "confirm"} error={error} pendingText="Checking code…" />
        </div>
      </form>
    </Section>
  );
}

function DevicesTab() {
  const api = useApi();
  const signedOut = useSignedOut();
  const sessions = useAsync(() => api.listSessions(), "sessions");
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmAll, setConfirmAll] = useState(false);

  async function revoke(session: SessionInfo) {
    setPending(session.id);
    setErrors({});
    try {
      await api.revokeSession(session.id);
      if (session.current) return signedOut("You signed out of this device.");
      await sessions.reload();
    } catch (failure) {
      setErrors({ [session.id]: message(failure, "Couldn’t sign out this device.") });
    } finally {
      setPending(null);
    }
  }

  async function revokeAll() {
    setPending("all");
    setErrors({});
    try {
      await api.revokeAllSessions();
      signedOut("You signed out of all devices.");
    } catch (failure) {
      setErrors({ all: message(failure, "Couldn’t sign out of all devices.") });
      setPending(null);
    }
  }

  return (
    <Section title="Devices" description="Devices that are signed in to your account.">
      {!sessions.data && sessions.error ? <RetryAlert error={sessions.error} onRetry={sessions.reload} title="Couldn’t load your devices" /> : null}
      {!sessions.data && !sessions.error && <p className="dash-meta">Loading devices…</p>}
      {sessions.data && (
        <ul className="divide-y rounded-xl border">
          {sessions.data.map(session => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <MonitorIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {session.device}
                    {session.current && <StatusBadge tone="accent">This device</StatusBadge>}
                  </p>
                  <p className="dash-meta">
                    Last active <time dateTime={session.lastSeenAt}>{dateTime(session.lastSeenAt)}</time>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ActionStatus pending={pending === session.id} error={errors[session.id]} pendingText="Signing out…" />
                <Button variant="outline" disabled={pending !== null} onClick={() => void revoke(session)}>
                  Sign out
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3 border-t pt-4">
        {confirmAll ? (
          <>
            <p className="font-medium">Sign out of every device, including this one?</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="destructive" disabled={pending !== null} onClick={() => void revokeAll()}>
                Sign out everywhere
              </Button>
              <Button variant="ghost" disabled={pending === "all"} onClick={() => setConfirmAll(false)}>
                Cancel
              </Button>
              <ActionStatus pending={pending === "all"} error={errors.all} pendingText="Signing out…" />
            </div>
          </>
        ) : (
          <div>
            <Button variant="outline" onClick={() => setConfirmAll(true)}>
              Sign out of all devices
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
