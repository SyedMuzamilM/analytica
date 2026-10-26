import { useState, type FormEvent } from "react";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { ArrowRight, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import type { AuthStatus } from "../../packages/contracts";
import { friendlyError, post } from "./api";

type RegistrationOptions = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];
type Flow = "login" | "setup" | "recovery" | "invite";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M6 17v-4m6 4V8m6 9V4" />
        </svg>
      </span>
      <span>
        analytica<span className="brand-period">.</span>
      </span>
    </span>
  );
}

export function AuthScreen({
  status,
  onSuccess,
}: {
  status: AuthStatus;
  onSuccess: (codes?: string[]) => void;
}) {
  const [flow, setFlow] = useState<Flow>(status.configured ? "login" : "setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");

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
        const endpoint =
          flow === "setup"
            ? "setup"
            : flow === "invite"
              ? "invite"
              : "recovery";
        const payload =
          flow === "setup"
            ? { token, name: name.trim(), workspaceName: workspaceName.trim() }
            : flow === "invite"
              ? { token, name: name.trim() }
              : { code: code.trim() };
        const data = await post<{
          challengeId: string;
          options: RegistrationOptions;
        }>(`/api/auth/${endpoint}/options`, payload);
        const response = await startRegistration({ optionsJSON: data.options });
        const result = await post<{ recoveryCodes?: string[] }>(
          `/api/auth/${endpoint}/verify`,
          { challengeId: data.challengeId, response },
        );
        setToken("");
        setCode("");
        onSuccess(result.recoveryCodes);
      }
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "The passkey request was canceled. Try again when you are ready."
          : friendlyError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  const unavailable = status.secretsReady === false;
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand />
        <a href="/demo" className="subtle-link">
          Explore the demo <ArrowRight size={15} />
        </a>
      </header>
      <main className="auth-layout">
        <section className="auth-story">
          <span className="auth-story-line" />
          <h1>
            A clearer view of
            <br />
            what brings people in.
          </h1>
          <p>
            Your traffic, the paths people take, and the actions that matter.
            All in one place.
          </p>
          <div className="auth-trust">
            <ShieldCheck size={19} />
            <span>Your installation. Your data.</span>
          </div>
          <div className="story-chart" aria-hidden="true">
            <svg viewBox="0 0 440 170">
              <defs>
                <linearGradient id="storyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#315bd8" stopOpacity=".15" />
                  <stop offset="1" stopColor="#315bd8" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 145L25 136L50 140L75 118L100 124L125 104L150 109L175 90L200 96L225 74L250 78L275 58L300 64L325 37L350 45L375 20L400 26L440 5V170H0Z"
                fill="url(#storyFill)"
              />
              <path
                d="M0 145L25 136L50 140L75 118L100 124L125 104L150 109L175 90L200 96L225 74L250 78L275 58L300 64L325 37L350 45L375 20L400 26L440 5"
                fill="none"
                stroke="#315bd8"
                strokeWidth="2.5"
              />
            </svg>
          </div>
        </section>
        <section className="auth-card" aria-labelledby="auth-title">
          <span className="auth-icon">
            <Fingerprint size={27} />
          </span>
          <h2 id="auth-title">
            {unavailable
              ? "Finish configuring this installation"
              : flow === "setup"
                ? "Make this workspace yours"
                : flow === "recovery"
                  ? "Recover your access"
                  : flow === "invite"
                    ? "Join your workspace"
                    : "Welcome back"}
          </h2>
          <p>
            {unavailable
              ? "The installation needs its application secret and owner setup token before accounts can be created."
              : flow === "setup"
                ? "Create your owner account with a passkey. You will need the private setup token from your installation."
                : flow === "recovery"
                  ? "Use one of your saved recovery codes to register a replacement passkey."
                  : flow === "invite"
                    ? "Enter the invitation token shared by your workspace owner."
                    : "Use your fingerprint, face, or device lock to sign in securely."}
          </p>
          {unavailable ? (
            <div className="setup-guidance">
              <code>APP_SECRET</code>
              <code>SETUP_TOKEN</code>
              <p>
                Set two different random values of at least 32 characters in
                your Cloudflare Worker secrets. Replace all example values, then
                reload this page.
              </p>
              <button
                className="button primary"
                onClick={() => window.location.reload()}
              >
                Check configuration
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              {(flow === "setup" || flow === "invite") && (
                <>
                  <label>
                    Your name
                    <input
                      name="name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                      required
                      placeholder="Alex Morgan"
                    />
                  </label>
                  {flow === "setup" && (
                    <label>
                      Workspace name
                      <input
                        name="workspace"
                        autoComplete="organization"
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        maxLength={80}
                        required
                        placeholder="Your team or company"
                      />
                    </label>
                  )}
                  <label>
                    {flow === "setup"
                      ? "Private setup token"
                      : "Invitation token"}
                    <input
                      name="token"
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                      placeholder={
                        flow === "setup"
                          ? "From your installation secrets"
                          : "From your workspace owner"
                      }
                    />
                  </label>
                </>
              )}
              {flow === "recovery" && (
                <label>
                  Recovery code
                  <input
                    name="recovery-code"
                    type="password"
                    autoComplete="off"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    placeholder="Enter one unused recovery code"
                  />
                </label>
              )}
              {error && (
                <div className="inline-error" role="alert">
                  {error}
                </div>
              )}
              <button
                disabled={busy}
                className="button primary auth-submit"
                type="submit"
              >
                <Fingerprint size={18} />
                {busy
                  ? "Waiting for your passkey…"
                  : flow === "login"
                    ? "Sign in with a passkey"
                    : flow === "recovery"
                      ? "Create replacement passkey"
                      : "Create your passkey"}
              </button>
              <span className="auth-note">
                Your passkey stays protected by your device.
              </span>
            </form>
          )}
          {!unavailable && (
            <div className="auth-alternatives">
              {flow !== "login" && status.configured && (
                <button
                  className="text-button"
                  onClick={() => {
                    setFlow("login");
                    setError("");
                  }}
                >
                  Back to sign in
                </button>
              )}
              {flow === "login" && (
                <>
                  <button
                    className="text-button"
                    onClick={() => {
                      setFlow("recovery");
                      setError("");
                    }}
                  >
                    <KeyRound size={14} />
                    Use a recovery code
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setFlow("invite");
                      setError("");
                    }}
                  >
                    Have an invitation?
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      </main>
      <footer className="auth-footer">
        A little less guesswork. A lot more perspective.
      </footer>
    </div>
  );
}
