import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { Role, Workspace } from "../../packages/contracts";
import type { AppEnv, Bindings, Principal } from "./env";

const COOKIE = "analytica_session";
const SESSION_MS = 7 * 86_400_000;
const CHALLENGE_MS = 5 * 60_000;
const encoder = new TextEncoder();
const algorithms = [-7, -257];
type Purpose = "setup" | "login" | "recovery" | "passkey" | "invite";
interface Challenge {
  id: string;
  challenge: string;
  purpose: Purpose;
  data: string;
  expires_at: number;
  consumed_token: string | null;
}
interface ChallengeData {
  origin: string;
  rpID: string;
  userId?: string;
  sessionId?: string;
  name?: string;
  workspaceId?: string;
  workspaceName?: string;
  secretHash?: string;
  recoveryHash?: string;
  inviteHash?: string;
  role?: "admin" | "viewer";
}
interface CredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string;
  rp_id: string;
}

const fail = (
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
  message: string,
): never => {
  throw new HTTPException(status, { message });
};
const randomToken = (size = 32) =>
  b64(crypto.getRandomValues(new Uint8Array(size)));
function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
function validSecret(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length >= 32 &&
    v.length <= 256 &&
    !/replace|change.me|placeholder|example/i.test(v)
  );
}
export function secretsReady(
  env: Pick<Bindings, "APP_SECRET" | "SETUP_TOKEN">,
  configured = false,
): boolean {
  return (
    validSecret(env.APP_SECRET) &&
    (configured ||
      (validSecret(env.SETUP_TOKEN) && env.APP_SECRET !== env.SETUP_TOKEN))
  );
}
async function digest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  );
}
async function equalSecret(
  a: string,
  b: string,
  secret: string,
): Promise<boolean> {
  const [x, y] = await Promise.all([digest(secret, a), digest(secret, b)]);
  let mismatch = x.length ^ y.length;
  for (let i = 0; i < x.length; i++)
    mismatch |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return mismatch === 0;
}

function configuration(c: Context<AppEnv>): { origin: string; rpID: string } {
  let url: URL;
  try {
    url = new URL(c.env.APP_ORIGIN || new URL(c.req.url).origin);
  } catch {
    return fail(503, "Configure a valid application origin.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return fail(503, "The application origin must be an HTTPS origin.");
  }
  return { origin: url.origin, rpID: url.hostname };
}
export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const { origin } = configuration(c);
    if (c.req.header("Origin") !== origin)
      return c.json(
        { error: "This action requires the application origin." },
        403,
      );
  }
  await next();
};

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return {};
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16_384) {
      await reader.cancel();
      return fail(413, "Request is too large.");
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(all));
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail(400, "Expected a JSON object.");
    return value as Record<string, unknown>;
  } catch {
    return fail(400, "Expected a JSON object.");
  }
}
const cleanName = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : fallback;

async function limit(
  c: Context<AppEnv>,
  action: string,
  max = 12,
): Promise<void> {
  const now = Date.now();
  const window = Math.floor(now / 60_000);
  // Small request-driven cleanup prevents expired challenge/limit rows from accumulating
  // faster than a free-tier scheduled invocation can safely remove them.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM auth_challenges WHERE id IN (SELECT id FROM auth_challenges WHERE expires_at<? LIMIT 8)",
    ).bind(now),
    c.env.DB.prepare(
      "DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE expires_at<? LIMIT 8)",
    ).bind(now),
  ]);
  const global = await c.env.DB.prepare(
    `INSERT INTO auth_rate_limits (key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=MIN(count+1,1000) RETURNING count`,
  )
    .bind(`global:${action}:${window}`, (window + 2) * 60_000)
    .first<{ count: number }>();
  if (!global || global.count > 300)
    return fail(429, "Authentication is busy. Try again in one minute.");
  const client = await digest(
    c.env.APP_SECRET,
    c.req.header("CF-Connecting-IP") || "local",
  );
  const key = `${action}:${window}:${client}`;
  const row = await c.env.DB.prepare(
    `INSERT INTO auth_rate_limits (key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count = MIN(count + 1, 1000) RETURNING count`,
  )
    .bind(key, (window + 2) * 60_000)
    .first<{ count: number }>();
  if (!row || row.count > max)
    return fail(429, "Too many attempts. Try again in one minute.");
}

async function principal(c: Context<AppEnv>): Promise<Principal | null> {
  if (!validSecret(c.env.APP_SECRET)) return null;
  const token = getCookie(c, COOKIE);
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sessionId, u.id AS userId, u.name FROM auth_sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled_at IS NULL`,
  )
    .bind(await digest(c.env.APP_SECRET, `session:${token}`), Date.now())
    .first<Principal>();
  return row;
}
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authenticated = c.get("principal");
  const user = authenticated || (await principal(c));
  if (!user) return c.json({ error: "Sign in to continue." }, 401);
  // Shared route modules can run this middleware more than once. Charge once,
  // using the verified account rather than a cookie string or a shared NAT IP.
  if (!authenticated && c.env.EDGE_RATE_LIMIT) {
    const recovery =
      /^\/api\/workspaces\/[^/]+\/deletion-journal(?:\/reapply)?$/.test(
        c.req.path,
      );
    const group = recovery
      ? "recovery"
      : c.req.method === "GET"
        ? "reads"
        : "account";
    const { success } = await c.env.EDGE_RATE_LIMIT.limit({
      key: `authenticated:${group}:${user.userId}`,
    });
    if (!success) {
      c.header("Retry-After", "60");
      return c.json({ error: "rate_limited" }, 429);
    }
  }
  c.set("principal", user);
  await next();
};
const requireRecentAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("principal");
  const recent = await c.env.DB.prepare(
    "SELECT 1 FROM auth_sessions WHERE id=? AND user_id=? AND created_at>? AND expires_at>?",
  )
    .bind(user.sessionId, user.userId, Date.now() - CHALLENGE_MS, Date.now())
    .first();
  if (!recent)
    return c.json(
      {
        error:
          "Sign in again with your passkey before changing account security.",
      },
      401,
    );
  await next();
};
const rank: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };
export function requireWorkspace(minRole: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("principal");
    if (!user) return c.json({ error: "Sign in to continue." }, 401);
    const row = await c.env.DB.prepare(
      `SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
      JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.workspace_id=? AND u.disabled_at IS NULL`,
    )
      .bind(user.userId, c.req.param("wid"))
      .first<Workspace>();
    if (!row || rank[row.role] < rank[minRole])
      return c.json({ error: "Workspace access denied." }, 403);
    c.set("workspace", row);
    await next();
  };
}

async function challenge(
  c: Context<AppEnv>,
  purpose: Purpose,
  value: string,
  data: ChallengeData,
) {
  const id = randomToken();
  const result = await c.env.DB.prepare(
    `INSERT INTO auth_challenges(id,challenge,purpose,data,expires_at)
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM auth_challenges)<2000`,
  )
    .bind(id, value, purpose, JSON.stringify(data), Date.now() + CHALLENGE_MS)
    .run();
  if (!result.meta.changes)
    return fail(429, "Authentication is busy. Try again shortly.");
  return id;
}
async function loadChallenge(
  c: Context<AppEnv>,
  id: unknown,
  purpose: Purpose,
): Promise<{ row: Challenge; data: ChallengeData }> {
  if (typeof id !== "string" || !/^[\w-]{43}$/.test(id))
    return fail(400, "Invalid authentication challenge.");
  const row = await c.env.DB.prepare(
    "SELECT * FROM auth_challenges WHERE id=? AND purpose=? AND expires_at>? AND consumed_token IS NULL",
  )
    .bind(id, purpose, Date.now())
    .first<Challenge>();
  if (!row)
    return fail(
      401,
      "Authentication expired or was already used. Start again.",
    );
  const data = JSON.parse(row.data) as ChallengeData;
  const conf = configuration(c);
  if (data.origin !== conf.origin || data.rpID !== conf.rpID)
    return fail(401, "The application origin changed. Start again.");
  return { row, data };
}
async function registrationOptions(
  c: Context<AppEnv>,
  purpose: Exclude<Purpose, "login">,
  data: ChallengeData,
) {
  const options = await generateRegistrationOptions({
    rpName: "Analytica",
    rpID: data.rpID,
    userName: data.name || "Analytica member",
    userDisplayName: data.name,
    userID: encoder.encode(data.userId!),
    attestationType: "none",
    supportedAlgorithmIDs: algorithms,
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    timeout: CHALLENGE_MS,
  });
  return c.json({
    challengeId: await challenge(c, purpose, options.challenge, data),
    options,
  });
}
const markerSql =
  "EXISTS(SELECT 1 FROM auth_challenges WHERE id=? AND consumed_token=?)";

/** Persists a credential only after WebAuthn verification. SQL gates preserve one-use proof across concurrent requests. */
export async function registerVerifiedCredential(
  db: D1Database,
  env: Pick<Bindings, "APP_SECRET">,
  ch: Challenge,
  data: ChallengeData,
  credential: WebAuthnCredential,
  now = Date.now(),
): Promise<{ token: string; recoveryCodes: string[] }> {
  const marker = randomToken();
  const userId = data.userId!;
  const token = randomToken();
  const recoveryCodes =
    ch.purpose === "passkey"
      ? []
      : Array.from({ length: 8 }, () => randomToken(24));
  const recoveryHashes = await Promise.all(
    recoveryCodes.map((code) => digest(env.APP_SECRET, `recovery:${code}`)),
  );
  const tokenHash = await digest(env.APP_SECRET, `session:${token}`);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "UPDATE auth_challenges SET consumed_token=? WHERE id=? AND consumed_token IS NULL AND expires_at>?",
      )
      .bind(marker, ch.id, now),
  ];
  let admission = markerSql;
  let admissionParams: unknown[] = [ch.id, marker];
  if (ch.purpose === "setup") {
    admission += " AND NOT EXISTS(SELECT 1 FROM setup_state)";
    statements.push(
      db
        .prepare(
          `INSERT INTO users(id,name,created_at) SELECT ?,?,? WHERE ${admission}`,
        )
        .bind(userId, data.name, now, ...admissionParams),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO workspaces(id,name,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)`,
        )
        .bind(data.workspaceId, data.workspaceName, now, userId),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO memberships(user_id,workspace_id,role) SELECT ?,?,'owner' WHERE EXISTS(SELECT 1 FROM users WHERE id=?)`,
        )
        .bind(userId, data.workspaceId, userId),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO setup_state(id,user_id,completed_at) SELECT 1,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)`,
        )
        .bind(userId, now, userId),
    );
    admission = `${markerSql} AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL)`;
    admissionParams = [ch.id, marker, userId];
  } else if (ch.purpose === "recovery") {
    statements.push(
      db
        .prepare(
          `UPDATE recovery_codes SET used_at=?,claim_token=? WHERE code_hash=? AND user_id=? AND used_at IS NULL
      AND ${markerSql} AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL)`,
        )
        .bind(now, marker, data.recoveryHash, userId, ch.id, marker, userId),
    );
    admission = `${markerSql} AND EXISTS(SELECT 1 FROM recovery_codes WHERE code_hash=? AND claim_token=?) AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL)`;
    admissionParams = [ch.id, marker, data.recoveryHash, marker, userId];
    statements.push(
      db
        .prepare(`DELETE FROM auth_sessions WHERE user_id=? AND ${admission}`)
        .bind(userId, ...admissionParams),
    );
    statements.push(
      db
        .prepare(`DELETE FROM passkeys WHERE user_id=? AND ${admission}`)
        .bind(userId, ...admissionParams),
    );
    // Invalidate every older unused recovery code. Keep the claimed receipt until this transaction completes.
    statements.push(
      db
        .prepare(
          `UPDATE recovery_codes SET used_at=? WHERE user_id=? AND used_at IS NULL AND ${admission}`,
        )
        .bind(now, userId, ...admissionParams),
    );
  } else if (ch.purpose === "invite") {
    statements.push(
      db
        .prepare(
          `UPDATE auth_invites SET used_at=?,claim_token=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?
      AND ${markerSql} AND EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.workspace_id=auth_invites.workspace_id AND m.user_id=auth_invites.created_by AND m.role='owner' AND u.disabled_at IS NULL)`,
        )
        .bind(now, marker, data.inviteHash, now, ch.id, marker),
    );
    admission = `${markerSql} AND EXISTS(SELECT 1 FROM auth_invites WHERE token_hash=? AND claim_token=?)`;
    admissionParams = [ch.id, marker, data.inviteHash, marker];
    statements.push(
      db
        .prepare(
          `INSERT INTO users(id,name,created_at) SELECT ?,?,? WHERE ${admission}`,
        )
        .bind(userId, data.name, now, ...admissionParams),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO memberships(user_id,workspace_id,role) SELECT ?,?,? WHERE ${admission}`,
        )
        .bind(userId, data.workspaceId, data.role, ...admissionParams),
    );
    admission +=
      " AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL)";
    admissionParams.push(userId);
  } else {
    admission +=
      " AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL)";
    admissionParams.push(userId);
    if (ch.purpose === "passkey") {
      admission +=
        " AND EXISTS(SELECT 1 FROM auth_sessions WHERE id=? AND user_id=? AND expires_at>? AND created_at>?)";
      admissionParams.push(data.sessionId, userId, now, now - CHALLENGE_MS);
    }
  }
  const insert = db
    .prepare(
      `INSERT INTO passkeys(id,user_id,public_key,counter,transports,rp_id,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${admission} AND (SELECT COUNT(*) FROM passkeys WHERE user_id=?)<20`,
    )
    .bind(
      credential.id,
      userId,
      b64(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports || []),
      data.rpID,
      now,
      ...admissionParams,
      userId,
    );
  const credentialIndex = statements.length;
  statements.push(insert);
  for (const hash of recoveryHashes) {
    statements.push(
      db
        .prepare(
          `INSERT INTO recovery_codes(code_hash,user_id,created_at) SELECT ?,?,? WHERE ${admission}`,
        )
        .bind(hash, userId, now, ...admissionParams),
    );
  }
  if (ch.purpose !== "passkey") {
    statements.push(
      db
        .prepare(
          `DELETE FROM auth_sessions WHERE id IN (
      SELECT id FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 19
    ) AND ${admission}`,
        )
        .bind(userId, ...admissionParams),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at) SELECT ?,?,?,?,? WHERE ${admission}`,
        )
        .bind(
          crypto.randomUUID(),
          tokenHash,
          userId,
          now,
          now + SESSION_MS,
          ...admissionParams,
        ),
    );
  }
  if (ch.purpose === "recovery") {
    // Old codes are invalid after recovery, including the just-consumed receipt.
    // Their removal is last so they remain available as the transaction's admission proof.
    statements.push(
      db
        .prepare(
          `DELETE FROM recovery_codes WHERE user_id=? AND used_at IS NOT NULL AND ${admission}`,
        )
        .bind(userId, ...admissionParams),
    );
  }
  const result = await db.batch(statements);
  if (result[credentialIndex].meta.changes !== 1)
    return fail(
      409,
      "This setup, invitation or recovery proof was already used. Start again.",
    );
  return { token, recoveryCodes };
}

function sessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: configuration(c).origin.startsWith("https:"),
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}
async function verifyRegistration(
  c: Context<AppEnv>,
  purpose: Exclude<Purpose, "login">,
) {
  await limit(c, "verify", 30);
  const b = await body(c);
  const { row, data } = await loadChallenge(c, b.challengeId, purpose);
  if (purpose === "passkey" && (await principal(c))?.userId !== data.userId)
    return fail(401, "Sign in to add a passkey.");
  if (
    purpose === "setup" &&
    data.secretHash !==
      (await digest(c.env.APP_SECRET, `setup:${c.env.SETUP_TOKEN}`))
  )
    return fail(401, "The setup token changed. Start again.");
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: b.response as RegistrationResponseJSON,
      expectedChallenge: row.challenge,
      expectedOrigin: data.origin,
      expectedRPID: data.rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: algorithms,
    });
  } catch {
    return fail(400, "The passkey could not be verified. Start again.");
  }
  if (!verified.verified)
    return fail(400, "The passkey could not be verified.");
  let result;
  try {
    result = await registerVerifiedCredential(
      c.env.DB,
      c.env,
      row,
      data,
      verified.registrationInfo.credential,
    );
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return fail(
      409,
      "The credential or registration proof is already in use. Start again.",
    );
  }
  if (purpose !== "passkey") sessionCookie(c, result.token);
  return c.json({
    ok: true,
    ...(result.recoveryCodes.length
      ? { recoveryCodes: result.recoveryCodes }
      : {}),
  });
}

export const authRoutes = new Hono<AppEnv>();
authRoutes.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  return c.json({ error: "Authentication is unavailable. Try again." }, 503);
});
authRoutes.use("*", requireSameOrigin);
authRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (c.req.path.endsWith("/status")) return next();
  const configured = !!(await c.env.DB.prepare(
    "SELECT 1 FROM setup_state WHERE id=1",
  ).first());
  const setup = c.req.path.startsWith("/api/auth/setup/");
  if (setup && configured)
    return c.json(
      { error: "This installation already has an owner. Sign in instead." },
      409,
    );
  if (!secretsReady(c.env, configured))
    return c.json(
      {
        error: configured
          ? "Configure a random application secret, at least 32 characters."
          : "Configure two different random application and setup secrets, at least 32 characters each.",
      },
      503,
    );
  await next();
});
authRoutes.get("/status", async (c) => {
  const configured = !!(await c.env.DB.prepare(
    "SELECT 1 FROM setup_state WHERE id=1",
  ).first());
  const user = await principal(c);
  const workspaces = user
    ? (
        await c.env.DB.prepare(
          `SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
    WHERE m.user_id=? ORDER BY w.created_at`,
        )
          .bind(user.userId)
          .all<Workspace>()
      ).results
    : undefined;
  c.header("Cache-Control", "no-store");
  return c.json({
    configured,
    authenticated: !!user,
    secretsReady: secretsReady(c.env, configured),
    mode: c.env.MODE || "self-hosted",
    ...(user ? { user: { id: user.userId, name: user.name }, workspaces } : {}),
  });
});
authRoutes.post("/setup/options", async (c) => {
  await limit(c, "setup", 10);
  const b = await body(c);
  if (await c.env.DB.prepare("SELECT 1 FROM setup_state").first())
    return fail(
      409,
      "This installation already has an owner. Sign in instead.",
    );
  if (
    typeof b.token !== "string" ||
    b.token.length > 256 ||
    !(await equalSecret(b.token, c.env.SETUP_TOKEN!, c.env.APP_SECRET))
  )
    return fail(401, "The setup token is incorrect.");
  return registrationOptions(c, "setup", {
    ...configuration(c),
    userId: crypto.randomUUID(),
    name: cleanName(b.name, "Owner"),
    workspaceId: crypto.randomUUID(),
    workspaceName: cleanName(b.workspaceName, "My workspace"),
    secretHash: await digest(c.env.APP_SECRET, `setup:${c.env.SETUP_TOKEN}`),
  });
});
authRoutes.post("/setup/verify", (c) => verifyRegistration(c, "setup"));
authRoutes.post("/login/options", async (c) => {
  await limit(c, "login");
  const conf = configuration(c);
  const options = await generateAuthenticationOptions({
    rpID: conf.rpID,
    userVerification: "required",
    timeout: CHALLENGE_MS,
  });
  return c.json({
    challengeId: await challenge(c, "login", options.challenge, conf),
    options,
  });
});
authRoutes.post("/login/verify", async (c) => {
  await limit(c, "verify", 30);
  const b = await body(c);
  const { row, data } = await loadChallenge(c, b.challengeId, "login");
  const response = b.response as AuthenticationResponseJSON | undefined;
  if (!response || typeof response.id !== "string" || response.id.length > 2048)
    return fail(400, "Invalid passkey response.");
  const credential = await c.env.DB.prepare(
    `SELECT p.* FROM passkeys p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.rp_id=? AND u.disabled_at IS NULL`,
  )
    .bind(response.id, data.rpID)
    .first<CredentialRow>();
  if (!credential)
    return fail(401, "This passkey is not registered for this installation.");
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: row.challenge,
      expectedOrigin: data.origin,
      expectedRPID: data.rpID,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: bytes(credential.public_key),
        counter: credential.counter,
        transports: JSON.parse(credential.transports),
      },
    });
  } catch {
    return fail(401, "The passkey could not be verified. Start again.");
  }
  if (!verified.verified)
    return fail(401, "The passkey could not be verified.");
  const now = Date.now();
  const marker = randomToken();
  const token = randomToken();
  const updatedCounter = verified.authenticationInfo.newCounter;
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE auth_challenges SET consumed_token=? WHERE id=? AND consumed_token IS NULL AND expires_at>?
      AND EXISTS(SELECT 1 FROM passkeys p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.counter=? AND u.disabled_at IS NULL)`,
    ).bind(marker, row.id, now, credential.id, credential.counter),
    c.env.DB.prepare(
      `UPDATE passkeys SET counter=? WHERE id=? AND counter=? AND ${markerSql}`,
    ).bind(updatedCounter, credential.id, credential.counter, row.id, marker),
    c.env.DB.prepare(
      `DELETE FROM auth_sessions WHERE id IN (
      SELECT id FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 19
    ) AND ${markerSql}`,
    ).bind(credential.user_id, row.id, marker),
    c.env.DB.prepare(
      `INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at) SELECT ?,?,?,?,?
      WHERE ${markerSql} AND EXISTS(SELECT 1 FROM passkeys p JOIN users u ON u.id=p.user_id
        WHERE p.id=? AND p.counter=? AND u.disabled_at IS NULL)`,
    ).bind(
      crypto.randomUUID(),
      await digest(c.env.APP_SECRET, `session:${token}`),
      credential.user_id,
      now,
      now + SESSION_MS,
      row.id,
      marker,
      credential.id,
      updatedCounter,
    ),
  ]);
  if (result[3].meta.changes !== 1)
    return fail(401, "The authentication proof expired or was already used.");
  sessionCookie(c, token);
  return c.json({ ok: true });
});
authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token)
    await c.env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
      .bind(await digest(c.env.APP_SECRET, `session:${token}`))
      .run();
  deleteCookie(c, COOKIE, {
    path: "/",
    secure: configuration(c).origin.startsWith("https:"),
    sameSite: "Strict",
  });
  return c.json({ ok: true });
});
authRoutes.post("/sessions/revoke", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?")
    .bind(c.get("principal").userId)
    .run();
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});
authRoutes.post(
  "/passkeys/options",
  requireAuth,
  requireRecentAuth,
  async (c) => {
    await limit(c, "passkey");
    const user = c.get("principal");
    return registrationOptions(c, "passkey", {
      ...configuration(c),
      userId: user.userId,
      name: user.name,
      sessionId: user.sessionId,
    });
  },
);
authRoutes.post("/passkeys/verify", requireAuth, requireRecentAuth, (c) =>
  verifyRegistration(c, "passkey"),
);
authRoutes.post(
  "/recovery-codes/regenerate",
  requireAuth,
  requireRecentAuth,
  async (c) => {
    await limit(c, "recovery-codes", 3);
    const user = c.get("principal");
    const codes = Array.from({ length: 8 }, () => randomToken(24));
    const hashes = await Promise.all(
      codes.map((code) => digest(c.env.APP_SECRET, `recovery:${code}`)),
    );
    const now = Date.now();
    const admitted =
      "EXISTS(SELECT 1 FROM auth_sessions WHERE id=? AND user_id=? AND created_at>? AND expires_at>?)";
    const args = [user.sessionId, user.userId, now - CHALLENGE_MS, now];
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM recovery_codes WHERE user_id=? AND ${admitted}`,
      ).bind(user.userId, ...args),
      ...hashes.map((hash) =>
        c.env.DB.prepare(
          `INSERT INTO recovery_codes(code_hash,user_id,created_at) SELECT ?,?,? WHERE ${admitted}`,
        ).bind(hash, user.userId, now, ...args),
      ),
    ]);
    if (results[1].meta.changes !== 1)
      return fail(401, "Sign in again before changing recovery codes.");
    return c.json({ recoveryCodes: codes });
  },
);
authRoutes.post("/recovery/options", async (c) => {
  await limit(c, "recovery", 6);
  const b = await body(c);
  if (typeof b.code !== "string" || !/^[\w-]{32}$/.test(b.code))
    return fail(401, "Recovery code is invalid or was already used.");
  const hash = await digest(c.env.APP_SECRET, `recovery:${b.code}`);
  const code = await c.env.DB.prepare(
    `SELECT r.user_id,u.name FROM recovery_codes r JOIN users u ON u.id=r.user_id
    WHERE r.code_hash=? AND r.used_at IS NULL AND u.disabled_at IS NULL`,
  )
    .bind(hash)
    .first<{ user_id: string; name: string }>();
  if (!code) return fail(401, "Recovery code is invalid or was already used.");
  return registrationOptions(c, "recovery", {
    ...configuration(c),
    userId: code.user_id,
    name: code.name,
    recoveryHash: hash,
  });
});
authRoutes.post("/recovery/verify", (c) => verifyRegistration(c, "recovery"));
authRoutes.post("/invites", requireAuth, async (c) => {
  await limit(c, "invite", 10);
  const b = await body(c);
  if (
    typeof b.workspaceId !== "string" ||
    !["admin", "viewer"].includes(String(b.role))
  )
    return fail(400, "Choose a workspace and an admin or viewer role.");
  const owner = await c.env.DB.prepare(
    `SELECT 1 FROM memberships WHERE user_id=? AND workspace_id=? AND role='owner'`,
  )
    .bind(c.get("principal").userId, b.workspaceId)
    .first();
  if (!owner) return fail(403, "Only the workspace owner can invite members.");
  const token = randomToken();
  const expiresAt = Date.now() + 86_400_000;
  const result = await c.env.DB.prepare(
    `INSERT INTO auth_invites(token_hash,workspace_id,role,created_by,expires_at)
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM auth_invites WHERE workspace_id=?)<100 AND (SELECT COUNT(*) FROM auth_invites)<1000`,
  )
    .bind(
      await digest(c.env.APP_SECRET, `invite:${token}`),
      b.workspaceId,
      b.role,
      c.get("principal").userId,
      expiresAt,
      b.workspaceId,
    )
    .run();
  if (!result.meta.changes)
    return fail(
      429,
      "There are too many pending invitations. Wait for old invitations to expire.",
    );
  return c.json({ token, expiresAt });
});
authRoutes.post("/workspaces", requireAuth, async (c) => {
  await limit(c, "workspace", 5);
  const b = await body(c);
  const name = cleanName(b.name, "My workspace");
  const id = crypto.randomUUID();
  const user = c.get("principal");
  const now = Date.now();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO workspaces(id,name,created_at) SELECT ?,?,?
      WHERE (SELECT COUNT(*) FROM memberships WHERE user_id=? AND role='owner')<5
      AND (SELECT COUNT(*) FROM workspaces)<100
      AND EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.disabled_at IS NULL)`,
    ).bind(id, name, now, user.userId, user.sessionId, user.userId, now),
    c.env.DB.prepare(
      `INSERT INTO memberships(user_id,workspace_id,role) SELECT ?,?,'owner' WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=?)`,
    ).bind(user.userId, id, id),
  ]);
  if (!result[0].meta.changes)
    return fail(
      429,
      "The workspace limit for this account or installation has been reached.",
    );
  return c.json({ id, name, role: "owner" as const }, 201);
});
authRoutes.post("/invite/options", async (c) => {
  await limit(c, "join", 10);
  const b = await body(c);
  if (typeof b.token !== "string" || !/^[\w-]{43}$/.test(b.token))
    return fail(401, "The invitation is invalid or expired.");
  const hash = await digest(c.env.APP_SECRET, `invite:${b.token}`);
  const invite = await c.env.DB.prepare(
    `SELECT workspace_id,role FROM auth_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?`,
  )
    .bind(hash, Date.now())
    .first<{ workspace_id: string; role: "admin" | "viewer" }>();
  if (!invite) return fail(401, "The invitation is invalid or expired.");
  return registrationOptions(c, "invite", {
    ...configuration(c),
    userId: crypto.randomUUID(),
    name: cleanName(b.name, "Member"),
    workspaceId: invite.workspace_id,
    role: invite.role,
    inviteHash: hash,
  });
});
authRoutes.post("/invite/verify", (c) => verifyRegistration(c, "invite"));
authRoutes.get(
  "/workspaces/:wid/members",
  requireAuth,
  requireWorkspace("owner"),
  async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT u.id AS userId,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.workspace_id=? AND u.disabled_at IS NULL ORDER BY u.created_at LIMIT 100`,
    )
      .bind(c.get("workspace").id)
      .all();
    return c.json(rows.results);
  },
);
authRoutes.delete(
  "/workspaces/:wid/members/:uid",
  requireAuth,
  requireWorkspace("owner"),
  async (c) => {
    const result = await c.env.DB.prepare(
      `DELETE FROM memberships WHERE workspace_id=? AND user_id=? AND role!='owner'
    AND EXISTS(SELECT 1 FROM memberships caller WHERE caller.workspace_id=? AND caller.user_id=? AND caller.role='owner')`,
    )
      .bind(
        c.get("workspace").id,
        c.req.param("uid"),
        c.get("workspace").id,
        c.get("principal").userId,
      )
      .run();
    if (!result.meta.changes)
      return fail(
        404,
        "Member not found or cannot remove the workspace owner.",
      );
    return c.json({ ok: true });
  },
);

export async function cleanupAuth(
  db: D1Database,
  now = Date.now(),
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "DELETE FROM auth_challenges WHERE id IN (SELECT id FROM auth_challenges WHERE expires_at<? LIMIT 100)",
      )
      .bind(now),
    db
      .prepare(
        "DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions WHERE expires_at<? LIMIT 100)",
      )
      .bind(now),
    db
      .prepare(
        "DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE expires_at<? LIMIT 100)",
      )
      .bind(now),
    db
      .prepare(
        "DELETE FROM auth_invites WHERE token_hash IN (SELECT token_hash FROM auth_invites WHERE expires_at<? LIMIT 100)",
      )
      .bind(now),
  ]);
}
