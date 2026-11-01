import { useState, type FormEvent } from "react";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import {
  ArrowRight,
  Check,
  Fingerprint,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import type { AuthStatus } from "../../packages/contracts";
import { friendlyError, post } from "./api";
import { Brand } from "./Brand";

type RegistrationOptions = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];
type Flow = "login" | "signup" | "setup" | "recovery" | "invite";

export function AuthScreen({
  status,
  onSuccess,
}: {
  status: AuthStatus;
  onSuccess: (codes?: string[]) => void;
}) {
  const [flow, setFlow] = useState<Flow>(() =>
    status.publicSignup
      ? window.location.pathname === "/signup"
        ? "signup"
        : "login"
      : status.configured
        ? "login"
        : "setup",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const unavailable = status.secretsReady === false;
  const creating = flow === "signup" || flow === "setup";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (flow === "login") {
        const data = await post<{
          challengeId: string;
          options: AuthenticationOptions;
        }>("/api/auth/login/options");
        const response = await startAuthentication({
          optionsJSON: data.options,
        });
        await post("/api/auth/login/verify", {
          challengeId: data.challengeId,
          response,
        });
        onSuccess();
      } else {
        const payload =
          flow === "signup"
            ? { name: name.trim(), workspaceName: workspaceName.trim() }
            : flow === "setup"
              ? {
                  token,
                  name: name.trim(),
                  workspaceName: workspaceName.trim(),
                }
              : flow === "invite"
                ? { token, name: name.trim() }
                : { code: code.trim() };
        const data = await post<{
          challengeId: string;
          options: RegistrationOptions;
        }>(`/api/auth/${flow}/options`, payload);
        const response = await startRegistration({ optionsJSON: data.options });
        const result = await post<{ recoveryCodes?: string[] }>(
          `/api/auth/${flow}/verify`,
          { challengeId: data.challengeId, response },
        );
        setToken("");
        setCode("");
        onSuccess(result.recoveryCodes);
      }
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "The passkey request was canceled. Try again, or use another device or password manager."
          : friendlyError(err),
      );
    } finally {
      setBusy(false);
    }
  }
  function choose(next: Flow) {
    setFlow(next);
    setError("");
  }
  return (
    <div className="account-entry">
      <header className="public-header">
        <a href="/" aria-label="Analytica home">
          <Brand />
        </a>
        <div>
          <a href="/docs">Need a hand?</a>
          <LinkButton href="/demo" variant="secondary">
            Explore the demo <ArrowRight size={14} />
          </LinkButton>
        </div>
      </header>
      <main className="account-entry-layout">
        <section className="account-entry-story">
          <h1>
            Your next idea,
            <br />
            understood.
          </h1>
          <p>
            Bring your websites, apps and product events into a workspace that
            stays yours.
          </p>
          <ul>
            <li>
              <Check size={17} />
              Separate projects for every product
            </li>
            <li>
              <Check size={17} />
              Traffic, conversions and revenue
            </li>
            <li>
              <Check size={17} />
              Export and delete your own data
            </li>
          </ul>
          <div className="account-story-note">
            <ShieldCheck size={21} />
            <span>
              Sign in with a passkey.
              <br />
              <small>Your passkey stays with your device.</small>
            </span>
          </div>
        </section>
        <section className="account-entry-form" aria-labelledby="auth-title">
          {new URLSearchParams(window.location.search).get("deleted") ===
            "1" && (
            <div className="deletion-success" role="status">
              Your account has been deleted. Owned project data is queued for
              cleanup.
            </div>
          )}
          <div className="account-form-icon">
            <Fingerprint size={26} />
          </div>
          <h2 id="auth-title">
            {unavailable
              ? "Account access is temporarily unavailable"
              : flow === "signup"
                ? "Create your account"
                : flow === "setup"
                  ? "Set up your installation"
                  : flow === "recovery"
                    ? "Recover your account"
                    : flow === "invite"
                      ? "Join your team"
                      : "Log in to Analytica"}
          </h2>
          <p>
            {unavailable
              ? "The service needs its account configuration completed. Please try again later."
              : creating
                ? "Create a passkey with your fingerprint, face, device lock or password manager. Save the recovery codes shown next."
                : flow === "recovery"
                  ? "Use one saved recovery code to create a replacement passkey. Your older passkeys will be revoked."
                  : flow === "invite"
                    ? "Enter the invitation shared by your workspace owner."
                    : "Use the passkey you created on this device, another device or your password manager."}
          </p>
          {unavailable ? (
            <Button onClick={() => window.location.reload()}>Try again</Button>
          ) : (
            <form onSubmit={submit}>
              {(creating || flow === "invite") && (
                <>
                  <Input
                    label="Your name"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={80}
                    placeholder="Your name"
                    size="lg"
                  />
                  {creating && (
                    <Input
                      label="Workspace name"
                      name="workspace"
                      autoComplete="organization"
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      required
                      maxLength={80}
                      placeholder="Your team or company"
                      size="lg"
                    />
                  )}
                </>
              )}
              {(flow === "setup" || flow === "invite") && (
                <Input
                  label={
                    flow === "setup"
                      ? "Private setup token"
                      : "Invitation token"
                  }
                  name="token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  size="lg"
                />
              )}
              {flow === "recovery" && (
                <Input
                  label="Recovery code"
                  name="recovery-code"
                  type="password"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  size="lg"
                />
              )}
              {error && (
                <div className="inline-error" role="alert">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={busy}
                className="account-submit"
              >
                <Fingerprint size={18} />
                {busy
                  ? "Waiting for your passkey…"
                  : flow === "login"
                    ? "Sign in with a passkey"
                    : flow === "recovery"
                      ? "Create replacement passkey"
                      : "Create your passkey"}
              </Button>
              <span className="account-passkey-note">
                No passwords to remember. Keep your recovery codes private.
              </span>
            </form>
          )}
          {!unavailable && (
            <div className="account-alternatives">
              {flow === "login" ? (
                <>
                  <Button variant="ghost" onClick={() => choose("recovery")}>
                    <KeyRound size={14} />
                    Use a recovery code
                  </Button>
                  <Button variant="ghost" onClick={() => choose("invite")}>
                    Have an invitation?
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => choose("login")}>
                  Back to sign in
                </Button>
              )}
              {status.publicSignup && (
                <p>
                  {flow === "signup" ? (
                    <>
                      Already have an account? <a href="/login">Log in</a>
                    </>
                  ) : (
                    <>
                      New to Analytica?{" "}
                      <a href="/signup">
                        Create an account <ArrowRight size={13} />
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>
          )}
          <p className="account-privacy-link">
            By continuing, you acknowledge our{" "}
            <a href="/privacy">privacy and data information</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
