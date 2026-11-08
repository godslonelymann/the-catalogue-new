import { motion, useReducedMotion } from "motion/react";
import { Children, useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { useApi, useSampleTools } from "../api/ApiContext";
import { ApiError } from "../api/client";
import type { SignInResult } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { SkipLink, Wordmark } from "../components/Layout";
import { DURATION, SPRING, reveal, stagger } from "../components/landing/motion";
import { useToast } from "../components/Toast";

interface LocationState {
  from?: string;
  notice?: string;
}

/**
 * The shell for every auth page, in the light landing style.
 * `topLink` sits at the right of the top bar. `aside` turns on the split layout:
 * the form on the left and a dark product panel on the right (1024 px and wider).
 */
function AuthBox({
  title,
  description,
  topLink,
  aside,
  icon,
  children,
}: {
  title: string;
  description: ReactNode;
  topLink?: ReactNode;
  aside?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion() ?? false;
  const item = reveal(reduced);
  useEffect(() => {
    document.title = `${title} · The Catalogue`;
    heading.current?.focus({ preventScroll: true });
  }, [title]);

  const top = (
    <header className="l-wrap auth-top">
      <Wordmark to="/" />
      {topLink && <p className="auth-top-link">{topLink}</p>}
    </header>
  );

  const box = (
    <main className="auth-main" id="main" tabIndex={-1}>
      <motion.section
        className={"auth-box " + (aside ? "plain" : "card")}
        aria-labelledby="auth-title"
        variants={stagger()}
        initial="hidden"
        animate="shown"
      >
        <motion.header variants={item}>
          {icon}
          <h1 id="auth-title" tabIndex={-1} ref={heading}>
            {title}
          </h1>
          <p className="muted">{description}</p>
        </motion.header>
        {Children.toArray(children).map((child, i) => (
          <motion.div key={i} variants={item}>
            {child}
          </motion.div>
        ))}
      </motion.section>
    </main>
  );

  return (
    <div className="public auth-shell landing-theme">
      <SkipLink />
      {aside ? (
        <div className="auth-split">
          <div className="auth-split-form">
            {top}
            {box}
          </div>
          {aside}
        </div>
      ) : (
        <>
          {top}
          {box}
        </>
      )}
    </div>
  );
}

/** The dark product panel beside the sign-up form. Decorative, so hidden from screen readers. */
function SignupPanel() {
  const reduced = useReducedMotion() ?? false;
  return (
    <aside className="auth-panel" aria-hidden>
      <motion.ul
        className="auth-panel-points"
        variants={stagger(0.08, reduced ? 0 : 0.3)}
        initial="hidden"
        animate="shown"
      >
        {["Track up to 10 Shopify brands.", "See every price drop.", "Get one email when your size returns."].map(point => (
          <motion.li key={point} variants={reveal(reduced)}>
            <Icon name="check" /> {point}
          </motion.li>
        ))}
      </motion.ul>
    </aside>
  );
}

/** The message for a failed auth request. */
function failureMessage(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === "rate_limited") return "Too many tries. Wait a minute, then try again.";
  if (failure instanceof Error && failure.message) return failure.message;
  return "Something went wrong. Try again.";
}

/** Sends a signed-in visitor straight to My Stores. */
function useSignedInRedirect(): ReactNode {
  const { account, loading } = useAuth();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from;
  if (!loading && account) return <Navigate to={from ?? "/stores"} replace />;
  return null;
}

function useFinishSignIn() {
  const { setAccount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? "/stores";
  return (result: SignInResult) => {
    if (result.status === "two_factor_required") {
      navigate("/two-factor", { state: { from } });
    } else {
      setAccount(result.account);
      navigate(from, { replace: true });
    }
  };
}

function GoogleButton({ label }: { label: string }) {
  const api = useApi();
  const finish = useFinishSignIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn google"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            finish(await api.startGoogleSignIn());
          } catch (failure) {
            setError(failureMessage(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <span className="spinner" aria-hidden /> : <Icon name="google" />} {label}
      </button>
      {error && (
        <p className="form-alert google-alert" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function Field({ ref, ...props }: {
  id: string;
  label: string;
  type?: string;
  autoComplete: string;
  value: string;
  error?: string;
  onChange(value: string): void;
  placeholder?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        ref={ref}
        id={props.id}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={props.value}
        aria-invalid={Boolean(props.error)}
        aria-describedby={props.id + "-error"}
        onChange={event => props.onChange(event.target.value)}
      />
      <p className="error" id={props.id + "-error"} aria-live="polite">
        {props.error}
      </p>
    </div>
  );
}

/** Messages for the Google sign-in redirects, which can only pass a code in the URL. */
const notices: Record<string, string> = {
  google_account_exists:
    "An account already uses this Google email. Sign in with your password, then link Google in Settings.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in didn’t work. Try again.",
  google_email_unverified: "Your Google email isn’t verified. Verify it with Google, or sign up with email.",
  sign_in_to_link: "Sign in first, then link Google in Settings.",
};
const noticeFromCode = (code: string | null) => (code ? notices[code] : undefined);

const validEmail = (email: string) => /^\S+@\S+\.\S+$/.test(email.trim());

export function LoginPage() {
  const api = useApi();
  const location = useLocation();
  const finish = useFinishSignIn();
  const redirect = useSignedInRedirect();
  const [params] = useSearchParams();
  const notice = (location.state as LocationState | null)?.notice ?? noticeFromCode(params.get("notice"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  if (redirect) return redirect;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      email: validEmail(email) ? undefined : "Enter a valid email address.",
      password: password ? undefined : "Enter your password.",
    };
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      finish(await api.signIn(email, password));
    } catch (failure) {
      setErrors({ form: failure instanceof Error ? failure.message : "We couldn’t sign you in." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthBox
      title="Welcome back"
      description="Sign in to see your stores, updates, and alerts."
      topLink={<>New here? <Link className="text-link" to="/signup">Create an account</Link></>}
    >
      {notice && <p className="form-alert" role="status" style={{ marginBottom: 16 }}>{notice}</p>}
      <GoogleButton label="Continue with Google" />
      <p className="divider">or</p>
      <form className="stack" noValidate onSubmit={submit}>
        <Field id="email" label="Email" type="email" autoComplete="email" value={email} error={errors.email} onChange={setEmail} placeholder="alex@example.com" />
        <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} error={errors.password} onChange={setPassword} />
        {errors.form && <p className="form-alert" role="alert">{errors.form}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="switch muted">
        <Link className="text-link" to="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="switch muted">
        New to The Catalogue? <Link className="text-link" to="/signup">Create an account</Link>
      </p>
      {api.mode === "mock" && <p className="auth-note muted">Sample build. Any email and a password of 8 or more characters sign you in.</p>}
    </AuthBox>
  );
}

export function SignupPage() {
  const api = useApi();
  const navigate = useNavigate();
  const redirect = useSignedInRedirect();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  if (redirect) return redirect;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validEmail(email)) {
      setError("Enter a valid email address.");
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await api.requestSignup(email);
      navigate("/signup/sent", { state: { email: email.trim() } });
    } catch (failure) {
      setFormError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const logIn = (
    <>
      Already have an account? <Link className="text-link" to="/login">Log in</Link>
    </>
  );

  return (
    <AuthBox
      title="Create your account"
      description="Confirm your email, then set a password."
      topLink={logIn}
      aside={<SignupPanel />}
    >
      <GoogleButton label="Sign up with Google" />
      <p className="divider">or</p>
      <form className="stack" noValidate onSubmit={submit}>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          error={error}
          ref={emailRef}
          onChange={value => {
            setEmail(value);
            setError("");
            setFormError("");
          }}
          placeholder="alex@example.com"
        />
        {formError && (
          <p className="form-alert" role="alert">
            {formError}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy && <span className="spinner" aria-hidden />}
          {busy ? "Sending link…" : "Send confirmation link"}
        </button>
      </form>
      <p className="switch muted">{logIn}</p>
    </AuthBox>
  );
}

function SampleLink({ to, label }: { to: string; label: string }) {
  const sample = useSampleTools();
  const token = sample?.signupToken();
  if (!sample || !token) return null;
  return (
    <p className="auth-note muted">
      Sample build: no email is sent.{" "}
      <Link className="text-link" to={`${to}?token=${encodeURIComponent(token)}`}>
        {label}
      </Link>
    </p>
  );
}

/** A mail icon in a 56 px circle that springs in. */
function SentIcon() {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className="auth-sent-icon"
      aria-hidden
      initial={{ scale: reduced ? 1 : 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={reduced ? { duration: DURATION.feedback } : SPRING}
    >
      <Icon name="mail" />
    </motion.span>
  );
}

export function SignupSentPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;
  return (
    <AuthBox
      title="Check your email"
      description={<>If {email ?? "this address"} can be used, we sent a confirmation link to it. The link expires in 30 minutes.</>}
      icon={<SentIcon />}
    >
      <p className="muted">Open the link on this device to set your password.</p>
      <p className="switch muted">
        <Link className="text-link" to="/signup">Use a different email</Link>
      </p>
      <SampleLink to="/verify-email" label="Open the sample confirmation link" />
    </AuthBox>
  );
}

function NewPasswordForm({ withName, submitLabel, onSubmit }: { withName: boolean; submitLabel: string; onSubmit(name: string, password: string): Promise<void> }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    setBusy(true);
    try {
      await onSubmit(name, password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form className="stack" noValidate onSubmit={submit}>
      {withName && <Field id="name" label="Name (optional)" autoComplete="name" value={name} onChange={setName} />}
      <Field id="password" label="Password" type="password" autoComplete="new-password" value={password} error={error} onChange={value => { setPassword(value); setError(""); }} placeholder="At least 8 characters" />
      <button className="btn primary" type="submit" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  );
}

export function VerifyEmailPage() {
  const api = useApi();
  const [params] = useSearchParams();
  const { setAccount } = useAuth();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  return (
    <AuthBox title="Set your password" description="Your email is confirmed. Set a password to finish your account.">
      <NewPasswordForm
        withName
        submitLabel="Create account"
        onSubmit={async (name, password) => {
          setAccount(await api.completeSignup(token, name, password));
          navigate("/stores", { replace: true });
        }}
      />
    </AuthBox>
  );
}

export function TwoFactorPage() {
  const api = useApi();
  const { setAccount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? "/stores";
  return (
    <AuthBox title="Two-factor check" description="Your account uses two-factor authentication.">
      <CodeForm
        titleId="tfa-title"
        title="Enter your code"
        description="Use the 6-digit code from your authenticator app, or one of your recovery codes."
        submitLabel="Continue"
        allowRecovery
        onSubmit={async code => {
          setAccount(await api.verifyTwoFactor(code));
          navigate(from, { replace: true });
        }}
      />
      <p className="switch muted">
        <Link className="text-link" to="/login">Use a different account</Link>
      </p>
    </AuthBox>
  );
}

export function ForgotPasswordPage() {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validEmail(email)) return setError("Enter a valid email address.");
    await api.requestPasswordReset(email);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthBox title="Check your email" description="If an account uses this address, we sent a link to reset the password. The link expires in 30 minutes.">
        <Link className="btn full" to="/login">Back to sign in</Link>
        <SampleLink to="/reset-password" label="Open the sample reset link" />
      </AuthBox>
    );
  }

  return (
    <AuthBox title="Reset your password" description="Enter your email. We will send you a reset link.">
      <form className="stack" noValidate onSubmit={submit}>
        <Field id="email" label="Email" type="email" autoComplete="email" value={email} error={error} onChange={value => { setEmail(value); setError(""); }} />
        <button className="btn primary" type="submit">Send reset link</button>
      </form>
      <p className="switch muted">
        <Link className="text-link" to="/login">Back to sign in</Link>
      </p>
    </AuthBox>
  );
}

export function ResetPasswordPage() {
  const api = useApi();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { setAccount } = useAuth();
  const token = params.get("token") ?? "";
  return (
    <AuthBox title="Choose a new password" description="After the reset, every device is signed out. Two-factor authentication stays on.">
      <NewPasswordForm
        withName={false}
        submitLabel="Reset password"
        onSubmit={async (_name, password) => {
          await api.resetPassword(token, password);
          setAccount(null);
          toast("Your password changed.");
          navigate("/login", { replace: true, state: { notice: "Your password changed. Sign in with your new password." } });
        }}
      />
    </AuthBox>
  );
}

export function CodeForm({
  titleId,
  title,
  description,
  submitLabel,
  allowRecovery = false,
  onSubmit,
  onCancel,
}: {
  titleId: string;
  title: string;
  description: ReactNode;
  submitLabel: string;
  allowRecovery?: boolean;
  onSubmit(code: string): Promise<void>;
  onCancel?(): void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(code);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That code didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" noValidate onSubmit={submit}>
      <h2 id={titleId}>{title}</h2>
      <div className="muted">{description}</div>
      <div className="field">
        <label htmlFor="code">{allowRecovery ? "Authenticator code or recovery code" : "Authenticator code"}</label>
        <input
          id="code"
          className="code-input"
          inputMode={allowRecovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoCapitalize="none"
          maxLength={allowRecovery ? 11 : 6}
          value={code}
          data-autofocus
          aria-invalid={Boolean(error)}
          aria-describedby="code-error"
          onChange={event => setCode(event.target.value)}
        />
        <p id="code-error" className="error" aria-live="polite">
          {error}
        </p>
      </div>
      <div className="row dialog-actions">
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn primary" disabled={busy || code.trim().length < 6}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
