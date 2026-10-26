import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { app as worker } from "../apps/worker/index";
import { Hono } from "hono";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  authRoutes,
  requireAuth,
  requireWorkspace,
  secretsReady,
  registerVerifiedCredential,
} from "../apps/worker/auth";
import type { AppEnv, Bindings } from "../apps/worker/env";

const origin = "https://analytica.test";
const encoder = new TextEncoder();
const app = new Hono<AppEnv>().route("/api/auth", authRoutes);
const b64 = (v: Uint8Array) =>
  btoa(String.fromCharCode(...v))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64 = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
};
async function hash(v: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(v)),
  );
}
async function request(
  path: string,
  data?: object,
  cookie?: string,
  bindings = env as Bindings,
) {
  return app.request(
    `${origin}/api/auth${path}`,
    {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
    bindings,
  );
}
async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

/** An in-process ES256 authenticator. Real cryptographic WebAuthn verification stays enabled. */
async function authenticator(challenge: string, suppliedOrigin = origin) {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const id = crypto.getRandomValues(new Uint8Array(32));
  const cose = isoCBOR.encode(
    new Map<number, any>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, unb64(jwk.x!)],
      [-3, unb64(jwk.y!)],
    ]),
  );
  const authData = concat(
    await hash("analytica.test"),
    new Uint8Array([0x45, 0, 0, 0, 0]),
    new Uint8Array(16),
    new Uint8Array([0, id.length]),
    id,
    cose,
  );
  const response: RegistrationResponseJSON = {
    id: b64(id),
    rawId: b64(id),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(
        encoder.encode(
          JSON.stringify({
            type: "webauthn.create",
            challenge,
            origin: suppliedOrigin,
          }),
        ),
      ),
      attestationObject: b64(
        isoCBOR.encode(
          new Map<string, any>([
            ["fmt", "none"],
            ["attStmt", new Map()],
            ["authData", authData],
          ]),
        ),
      ),
      transports: ["internal"],
    },
  };
  return { response, keys, id: b64(id) };
}
function derSignature(raw: Uint8Array) {
  const integer = (part: Uint8Array) => {
    let offset = 0;
    while (offset < part.length - 1 && part[offset] === 0) offset++;
    let p = part.slice(offset);
    if (p[0] & 0x80) p = concat(new Uint8Array([0]), p);
    return concat(new Uint8Array([2, p.length]), p);
  };
  const pair = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(new Uint8Array([0x30, pair.length]), pair);
}
async function assertion(
  auth: Awaited<ReturnType<typeof authenticator>>,
  challenge: string,
  counter = 1,
) {
  const clientData = encoder.encode(
    JSON.stringify({ type: "webauthn.get", challenge, origin }),
  );
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, counter);
  const authData = concat(
    await hash("analytica.test"),
    new Uint8Array([5]),
    count,
  );
  const signed = concat(
    authData,
    new Uint8Array(await crypto.subtle.digest("SHA-256", clientData)),
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      auth.keys.privateKey,
      signed,
    ),
  );
  return {
    id: auth.id,
    rawId: auth.id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      authenticatorData: b64(authData),
      clientDataJSON: b64(clientData),
      signature: b64(derSignature(sig)),
    },
  };
}
async function setup(name = "Owner") {
  const r = await request("/setup/options", {
    token: env.SETUP_TOKEN,
    name,
    workspaceName: "Test workspace",
  });
  expect(r.status).toBe(200);
  const options = await json(r);
  const auth = await authenticator(options.options.challenge);
  const verify = await request("/setup/verify", {
    challengeId: options.challengeId,
    response: auth.response,
  });
  expect(verify.status, await verify.clone().text()).toBe(200);
  const cookie = verify.headers.get("set-cookie")!.split(";")[0];
  return { cookie, auth, verification: await json(verify), options };
}

describe("passkey authentication", () => {
  it("fails closed for missing, placeholder, reused secrets and cross-origin requests", async () => {
    expect(
      secretsReady({ APP_SECRET: "a".repeat(40), SETUP_TOKEN: "b".repeat(40) }),
    ).toBe(true);
    expect(
      secretsReady({ APP_SECRET: "a".repeat(40), SETUP_TOKEN: "a".repeat(40) }),
    ).toBe(false);
    const bad = await request(
      "/setup/options",
      { token: "anything" },
      undefined,
      { ...env, APP_SECRET: "REPLACE_WITH_A_SECRET_".repeat(3) },
    );
    expect(bad.status).toBe(503);
    const hostile = await app.request(
      `${origin}/api/auth/login/options`,
      { method: "POST", headers: { Origin: "https://evil.test" } },
      env,
    );
    expect(hostile.status).toBe(403);
    const absent = await app.request(
      `${origin}/api/auth/login/options`,
      { method: "POST" },
      env,
    );
    expect(absent.status).toBe(403);
    expect(
      (await request("/setup/options", { token: "incorrect" })).status,
    ).toBe(401);
  });

  it("verifies real ES256 passkeys, issues revocable opaque sessions and rejects challenge reuse", async () => {
    const { cookie, auth, options, verification } = await setup();
    expect(verification.recoveryCodes).toHaveLength(8);
    expect(
      (await json(await request("/status", undefined, cookie))).authenticated,
    ).toBe(true);
    expect(
      (
        await request("/setup/verify", {
          challengeId: options.challengeId,
          response: auth.response,
        })
      ).status,
    ).toBe(409);
    expect(
      (await request("/setup/options", { token: env.SETUP_TOKEN })).status,
    ).toBe(409);
    const challenge = await json(await request("/login/options", {}));
    const response = await assertion(auth, challenge.options.challenge);
    const login = await request("/login/verify", {
      challengeId: challenge.challengeId,
      response,
    });
    expect(login.status, await login.clone().text()).toBe(200);
    const secondCookie = login.headers.get("set-cookie")!.split(";")[0];
    expect(
      (
        await request("/login/verify", {
          challengeId: challenge.challengeId,
          response,
        })
      ).status,
    ).toBe(401);
    await request("/sessions/revoke", {}, cookie);
    expect(
      (await json(await request("/status", undefined, cookie))).authenticated,
    ).toBe(false);
    expect(
      (await json(await request("/status", undefined, secondCookie)))
        .authenticated,
    ).toBe(false);
  });

  it("allows removing the bootstrap token after setup without breaking sessions or passkey login", async () => {
    const withoutToken = { ...env, SETUP_TOKEN: undefined };
    expect(
      (await request("/login/options", {}, undefined, withoutToken)).status,
    ).toBe(503);
    expect(
      (await json(await request("/status", undefined, undefined, withoutToken)))
        .secretsReady,
    ).toBe(false);
    const owner = await setup();
    const status = await json(
      await request("/status", undefined, owner.cookie, withoutToken),
    );
    expect(status.authenticated).toBe(true);
    expect(status.secretsReady).toBe(true);
    const login = await request("/login/options", {}, undefined, withoutToken);
    expect(login.status).toBe(200);
    const challenge = await json(login);
    const verified = await request(
      "/login/verify",
      {
        challengeId: challenge.challengeId,
        response: await assertion(owner.auth, challenge.options.challenge),
      },
      undefined,
      withoutToken,
    );
    expect(verified.status).toBe(200);
    expect(
      (
        await request(
          "/setup/options",
          { token: env.SETUP_TOKEN },
          undefined,
          withoutToken,
        )
      ).status,
    ).toBe(409);
    expect(
      (await request("/setup/verify", {}, undefined, withoutToken)).status,
    ).toBe(409);
    const unavailable = await request("/login/options", {}, undefined, {
      ...withoutToken,
      APP_SECRET: "REPLACE_APP_SECRET",
    });
    expect(unavailable.status).toBe(503);
    expect(
      (
        await json(
          await request("/status", undefined, owner.cookie, {
            ...withoutToken,
            APP_SECRET: "REPLACE_APP_SECRET",
          }),
        )
      ).authenticated,
    ).toBe(false);
  });

  it("rejects setup verification if the bootstrap token changes or disappears before owner registration", async () => {
    const options = await json(
      await request("/setup/options", { token: env.SETUP_TOKEN }),
    );
    const auth = await authenticator(options.options.challenge);
    const proof = { challengeId: options.challengeId, response: auth.response };
    expect(
      (
        await request("/setup/verify", proof, undefined, {
          ...env,
          SETUP_TOKEN: "rotated-safe-bootstrap-token-which-is-long-enough",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/setup/verify", proof, undefined, {
          ...env,
          SETUP_TOKEN: undefined,
        })
      ).status,
    ).toBe(503);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM setup_state").first("n"),
    ).toBe(0);
  });

  it("locks every auth mutation during restore while preserving passkey login and owner journal replay", async () => {
    const owner = await setup();
    const status = await json(
      await request("/status", undefined, owner.cookie),
    );
    const wid = status.workspaces[0].id;
    const locked = { ...env, RESTORE_LOCK: "true" };
    const call = (path: string, method = "POST", body: object = {}) =>
      worker.request(
        `${origin}${path}`,
        {
          method,
          headers: {
            Origin: origin,
            Cookie: owner.cookie,
            "Content-Type": "application/json",
          },
          body: method === "GET" ? undefined : JSON.stringify(body),
        },
        locked,
      );
    for (const path of [
      "/setup/options",
      "/setup/verify",
      "/passkeys/options",
      "/passkeys/verify",
      "/recovery/options",
      "/recovery/verify",
      "/recovery-codes/regenerate",
      "/invites",
      "/invite/options",
      "/invite/verify",
      "/workspaces",
      "/sessions/revoke",
    ]) {
      const response = await call(`/api/auth${path}`);
      expect(response.status, path).toBe(503);
      expect(await response.json()).toEqual({ error: "restore_in_progress" });
    }
    expect(
      (await call(`/api/auth/workspaces/${wid}/members/member`, "DELETE"))
        .status,
    ).toBe(503);
    expect((await call(`/api/workspaces/${wid}/sites`, "GET")).status).toBe(
      503,
    );
    expect((await call("/v1/collect")).status).toBe(503);
    expect(
      (await call(`/api/workspaces/${wid}/deletion-journal`, "GET")).status,
    ).toBe(200);
    // An empty replay checks completion without adding deletion targets.
    const replay = await call(
      `/api/workspaces/${wid}/deletion-journal/reapply`,
      "POST",
      { records: [] },
    );
    expect(replay.status).toBe(202);
    const anonymous = await worker.request(
      `${origin}/api/workspaces/${wid}/deletion-journal`,
      {},
      locked,
    );
    expect(anonymous.status).toBe(401);
    expect(
      (
        await call(
          `/api/workspaces/${wid}/sites/deletion-journal-suffix`,
          "GET",
        )
      ).status,
    ).toBe(503);
    const restoredStatus = await call("/api/auth/status", "GET");
    expect((await json(restoredStatus)).authenticated).toBe(true);
    const challenge = await json(await call("/api/auth/login/options"));
    const login = await call("/api/auth/login/verify", "POST", {
      challengeId: challenge.challengeId,
      response: await assertion(owner.auth, challenge.options.challenge),
    });
    expect(login.status).toBe(200);
    expect((await call("/api/auth/logout")).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM passkeys").first("n"),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM workspaces").first("n"),
    ).toBe(1);
  });

  it("limits authenticated reports and exports once per request with a separate recovery bucket", async () => {
    const owner = await setup();
    const status = await json(
      await request("/status", undefined, owner.cookie),
    );
    const wid = status.workspaces[0].id;
    await env.DB.prepare(
      "INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        "site-limit",
        wid,
        "Reports",
        "reports.test",
        "UTC",
        "aggregate",
        "active",
        Date.now(),
      )
      .run();
    const keys: string[] = [];
    let allowReads = true;
    const bindings = {
      ...env,
      EDGE_RATE_LIMIT: {
        async limit({ key }: { key: string }) {
          keys.push(key);
          return {
            success: !key.startsWith("authenticated:reads:") || allowReads,
          };
        },
      },
    };
    const call = (path: string, cookie = owner.cookie) =>
      worker.request(
        `${origin}/api/workspaces/${wid}${path}`,
        { headers: { Cookie: cookie, "CF-Connecting-IP": "192.0.2.1" } },
        bindings,
      );
    expect((await call("/sites/site-limit/report")).status).toBe(200);
    expect(keys).toEqual([`authenticated:reads:${status.user.id}`]);
    allowReads = false;
    for (const path of [
      "/sites/site-limit/export",
      "/sites/site-limit/revenue",
      "/sites/site-limit/funnels",
      "/sites/site-limit/journeys",
    ]) {
      const response = await call(path);
      expect(response.status, path).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
    }
    expect(keys).toHaveLength(5);
    expect(
      keys.every((key) => key === `authenticated:reads:${status.user.id}`),
    ).toBe(true);
    expect((await call("/deletion-journal")).status).toBe(200);
    expect(keys.at(-1)).toBe(`authenticated:recovery:${status.user.id}`);
    const before = keys.length;
    expect(
      (await call("/sites/site-limit/report", "analytica_session=forged"))
        .status,
    ).toBe(401);
    expect(keys).toHaveLength(before);
  });

  it("rejects altered origins inside a signed registration response", async () => {
    const options = await json(
      await request("/setup/options", { token: env.SETUP_TOKEN }),
    );
    const auth = await authenticator(
      options.options.challenge,
      "https://evil.test",
    );
    const response = await request("/setup/verify", {
      challengeId: options.challengeId,
      response: auth.response,
    });
    expect(response.status).toBe(400);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM users").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });

  it("atomically admits only one owner across different simultaneous setup claims", async () => {
    const first = await json(
      await request("/setup/options", {
        token: env.SETUP_TOKEN,
        name: "First",
      }),
    );
    const second = await json(
      await request("/setup/options", {
        token: env.SETUP_TOKEN,
        name: "Second",
      }),
    );
    const [a, b] = await Promise.all([
      authenticator(first.options.challenge),
      authenticator(second.options.challenge),
    ]);
    const results = await Promise.all([
      request("/setup/verify", {
        challengeId: first.challengeId,
        response: a.response,
      }),
      request("/setup/verify", {
        challengeId: second.challengeId,
        response: b.response,
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const counts = await env.DB.batch(
      [
        "users",
        "workspaces",
        "memberships",
        "setup_state",
        "passkeys",
        "auth_sessions",
      ].map((table) => env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`)),
    );
    expect(counts.map((r) => (r.results[0] as { n: number }).n)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it("rolls back bootstrap and challenge consumption when a derived credential insert fails", async () => {
    const options = await json(
      await request("/setup/options", { token: env.SETUP_TOKEN }),
    );
    const row = await env.DB.prepare("SELECT * FROM auth_challenges WHERE id=?")
      .bind(options.challengeId)
      .first<any>();
    const data = JSON.parse(row.data);
    await env.DB.prepare(
      "CREATE TRIGGER fail_credential BEFORE INSERT ON passkeys BEGIN SELECT RAISE(ABORT,'test constraint failure'); END",
    ).run();
    await expect(
      registerVerifiedCredential(env.DB, env, row, data, {
        id: "test-credential",
        publicKey: new Uint8Array([1]),
        counter: 0,
      }),
    ).rejects.toThrow();
    await env.DB.prepare("DROP TRIGGER fail_credential").run();
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM users").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    expect(
      (
        await env.DB.prepare(
          "SELECT consumed_token FROM auth_challenges WHERE id=?",
        )
          .bind(row.id)
          .first<{ consumed_token: string | null }>()
      )?.consumed_token,
    ).toBeNull();
  });

  it("requires authoritative membership for workspace roles and blocks disabled users", async () => {
    const { cookie } = await setup();
    const status = await json(await request("/status", undefined, cookie));
    const secured = new Hono<AppEnv>();
    secured.get(
      "/workspaces/:wid",
      requireAuth,
      requireWorkspace("owner"),
      (c) => c.json(c.get("workspace")),
    );
    expect(
      (
        await secured.request(
          `${origin}/workspaces/${status.workspaces[0].id}`,
          { headers: { Cookie: cookie } },
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await secured.request(
          `${origin}/workspaces/not-owned`,
          { headers: { Cookie: cookie } },
          env,
        )
      ).status,
    ).toBe(403);
    await env.DB.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?")
      .bind(status.user.id)
      .run();
    expect(
      (
        await secured.request(
          `${origin}/workspaces/${status.workspaces[0].id}`,
          { headers: { Cookie: cookie } },
          env,
        )
      ).status,
    ).toBe(403);
    await env.DB.prepare("UPDATE users SET disabled_at=? WHERE id=?")
      .bind(Date.now(), status.user.id)
      .run();
    expect(
      (await json(await request("/status", undefined, cookie))).authenticated,
    ).toBe(false);
  });

  it("consumes recovery once, revokes old credentials and sessions, and rejects disabled accounts", async () => {
    const owner = await setup();
    const code = owner.verification.recoveryCodes[0];
    const first = await json(await request("/recovery/options", { code }));
    const second = await json(await request("/recovery/options", { code }));
    const [a, b] = await Promise.all([
      authenticator(first.options.challenge),
      authenticator(second.options.challenge),
    ]);
    const recovery = await Promise.all([
      request("/recovery/verify", {
        challengeId: first.challengeId,
        response: a.response,
      }),
      request("/recovery/verify", {
        challengeId: second.challengeId,
        response: b.response,
      }),
    ]);
    expect(recovery.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM passkeys").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
    expect(
      (await json(await request("/status", undefined, owner.cookie)))
        .authenticated,
    ).toBe(false);
    expect((await request("/recovery/options", { code })).status).toBe(401);
    const winning = recovery.find((r) => r.status === 200)!;
    const newCodes = (await json(winning)).recoveryCodes;
    await env.DB.prepare("UPDATE users SET disabled_at=?")
      .bind(Date.now())
      .run();
    expect(
      (await request("/recovery/options", { code: newCodes[0] })).status,
    ).toBe(401);
  });

  it("one-use invitations create scoped members and cannot be consumed twice", async () => {
    const owner = await setup();
    const status = await json(
      await request("/status", undefined, owner.cookie),
    );
    const invite = await json(
      await request(
        "/invites",
        { workspaceId: status.workspaces[0].id, role: "viewer" },
        owner.cookie,
      ),
    );
    const options = await json(
      await request("/invite/options", {
        token: invite.token,
        name: "Colleague",
      }),
    );
    const auth = await authenticator(options.options.challenge);
    const result = await request("/invite/verify", {
      challengeId: options.challengeId,
      response: auth.response,
    });
    expect(result.status, await result.clone().text()).toBe(200);
    const memberCookie = result.headers.get("set-cookie")!.split(";")[0];
    const member = await json(
      await request("/status", undefined, memberCookie),
    );
    expect(member.workspaces).toEqual([
      { ...status.workspaces[0], role: "viewer" },
    ]);
    expect(
      (
        await request(
          "/invites",
          { workspaceId: status.workspaces[0].id, role: "admin" },
          memberCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request("/invite/options", { token: invite.token })).status,
    ).toBe(401);
  });

  it("creates independent bounded workspaces and immediately revokes a removed membership", async () => {
    const owner = await setup();
    const workspace = await request(
      "/workspaces",
      { name: "Independent workspace" },
      owner.cookie,
    );
    expect(workspace.status).toBe(201);
    const created = await json(workspace);
    const invite = await json(
      await request(
        "/invites",
        { workspaceId: created.id, role: "admin" },
        owner.cookie,
      ),
    );
    const options = await json(
      await request("/invite/options", {
        token: invite.token,
        name: "Analyst",
      }),
    );
    const auth = await authenticator(options.options.challenge);
    const joined = await request("/invite/verify", {
      challengeId: options.challengeId,
      response: auth.response,
    });
    const memberCookie = joined.headers.get("set-cookie")!.split(";")[0];
    const member = await json(
      await request("/status", undefined, memberCookie),
    );
    expect(member.workspaces).toEqual([
      { id: created.id, name: created.name, role: "admin" },
    ]);
    const revoke = await app.request(
      `${origin}/api/auth/workspaces/${created.id}/members/${member.user.id}`,
      {
        method: "DELETE",
        headers: { Origin: origin, Cookie: owner.cookie },
      },
      env,
    );
    expect(revoke.status).toBe(200);
    expect(
      (await json(await request("/status", undefined, memberCookie)))
        .workspaces,
    ).toEqual([]);
    const ownerStatus = await json(
      await request("/status", undefined, owner.cookie),
    );
    const selfRemoval = await app.request(
      `${origin}/api/auth/workspaces/${created.id}/members/${ownerStatus.user.id}`,
      {
        method: "DELETE",
        headers: { Origin: origin, Cookie: owner.cookie },
      },
      env,
    );
    expect(selfRemoval.status).toBe(404);
    for (let i = 0; i < 3; i++)
      expect(
        (await request("/workspaces", { name: "Extra" }, owner.cookie)).status,
      ).toBe(201);
    expect(
      (await request("/workspaces", { name: "Above limit" }, owner.cookie))
        .status,
    ).toBe(429);
  });

  it("rejects expired challenges and recovery completion after account revocation", async () => {
    const options = await json(
      await request("/setup/options", { token: env.SETUP_TOKEN }),
    );
    const auth = await authenticator(options.options.challenge);
    await env.DB.prepare("UPDATE auth_challenges SET expires_at=? WHERE id=?")
      .bind(Date.now() - 1, options.challengeId)
      .run();
    expect(
      (
        await request("/setup/verify", {
          challengeId: options.challengeId,
          response: auth.response,
        })
      ).status,
    ).toBe(401);
    const owner = await setup();
    const recovery = await json(
      await request("/recovery/options", {
        code: owner.verification.recoveryCodes[0],
      }),
    );
    const replacement = await authenticator(recovery.options.challenge);
    await env.DB.prepare("UPDATE users SET disabled_at=?")
      .bind(Date.now())
      .run();
    expect(
      (
        await request("/recovery/verify", {
          challengeId: recovery.challengeId,
          response: replacement.response,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM passkeys").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });

  it("requires recent authentication to add passkeys or regenerate recovery codes", async () => {
    const owner = await setup();
    const newCodes = await request(
      "/recovery-codes/regenerate",
      {},
      owner.cookie,
    );
    expect(newCodes.status).toBe(200);
    expect((await json(newCodes)).recoveryCodes).toHaveLength(8);
    expect(
      (
        await request("/recovery/options", {
          code: owner.verification.recoveryCodes[0],
        })
      ).status,
    ).toBe(401);
    await env.DB.prepare("UPDATE auth_sessions SET created_at=?")
      .bind(Date.now() - 10 * 60_000)
      .run();
    expect((await request("/passkeys/options", {}, owner.cookie)).status).toBe(
      401,
    );
    expect(
      (await request("/recovery-codes/regenerate", {}, owner.cookie)).status,
    ).toBe(401);
  });

  it("bounds challenge creation before storing unlimited authentication attempts", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++)
      statuses.push((await request("/login/options", {})).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(12);
    expect(statuses.slice(12)).toEqual([429, 429]);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM auth_challenges").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(12);
  });
});
