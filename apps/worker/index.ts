import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { authRoutes, cleanupAuth } from "./auth";
import { analyticsRoutes, collectRoutes } from "./analytics";
import { runMaintenance } from "./maintenance";
import { revenueRoutes, moneyRoutes, cleanupRevenue } from "./revenue";
import { privacyRoutes, cleanupPrivacy } from "./privacy";
import { funnelRoutes, cleanupFunnels } from "./funnels";
import type { AppEnv, Bindings } from "./env";

const app = new Hono<AppEnv>();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header("X-Request-Id", requestId);
  await next();
  if (c.req.path.startsWith("/api") || c.req.path.startsWith("/v1")) {
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Origin, Cookie");
  }
});

app.use(
  "/api/*",
  bodyLimit({
    maxSize: 65536,
    onError: (c) => c.json({ error: "body_too_large" }, 413),
  }),
);
app.use(
  "/v1/*",
  bodyLimit({
    maxSize: 65536,
    onError: (c) => c.json({ error: "body_too_large" }, 413),
  }),
);
app.use("*", async (c, next) => {
  if (
    c.env.EDGE_RATE_LIMIT &&
    (c.req.path.startsWith("/v1/") || c.req.path.startsWith("/api/auth/"))
  ) {
    const ip = c.req.header("CF-Connecting-IP") || "local";
    const value = new TextEncoder().encode(
      `${c.env.APP_SECRET || "unconfigured"}:${ip}`,
    );
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
    const key = Array.from(hash, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    const { success } = await c.env.EDGE_RATE_LIMIT.limit({ key });
    if (!success) {
      c.header("Retry-After", "60");
      if (c.req.path === "/v1/collect")
        c.header("Access-Control-Allow-Origin", "*");
      return c.json({ error: "rate_limited" }, 429);
    }
  }
  await next();
});
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const expected = c.env.APP_ORIGIN || new URL(c.req.url).origin;
    if (c.req.header("origin") !== expected)
      return c.json({ error: "origin_not_allowed" }, 403);
  }
  await next();
});

app.use("/v1/*", async (c, next) => {
  if (c.env.RESTORE_LOCK === "true")
    return c.json({ error: "restore_in_progress" }, 503);
  await next();
});
app.use("/api/workspaces/*", async (c, next) => {
  if (
    c.env.RESTORE_LOCK === "true" &&
    !c.req.path.includes("/deletion-journal")
  )
    return c.json({ error: "restore_in_progress" }, 503);
  await next();
});

app.get("/healthz", async (c) => {
  try {
    await c.env.DB.prepare("SELECT id FROM workspaces LIMIT 1").all();
    return c.json({ ok: true, service: "analytica", version: "0.1.0" });
  } catch {
    return c.json({ ok: false, error: "schema_unavailable" }, 503);
  }
});

app.route("/api/auth", authRoutes);
app.route("/api", analyticsRoutes);
app.route("/v1", collectRoutes);
app.route("/api", revenueRoutes);
app.route("/v1", moneyRoutes);
app.route("/api", privacyRoutes);
app.route("/api", funnelRoutes);

app.all("/api", (c) => c.json({ error: "not_found" }, 404));
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
app.all("/v1", (c) => c.json({ error: "not_found" }, 404));
app.all("/v1/*", (c) => c.json({ error: "not_found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message || "request_failed" }, error.status);
  if (error instanceof SyntaxError)
    return c.json({ error: "invalid_json" }, 400);
  // Do not log request bodies, query strings, database values or exception messages.
  console.error(
    JSON.stringify({
      event: "request_failed",
      requestId: c.res.headers.get("X-Request-Id"),
      type: error.name,
    }),
  );
  return c.json(
    {
      error: "request_failed",
      message: "The request could not be completed. Try again.",
    },
    500,
  );
});

export { app };
export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    _ctx: ExecutionContext,
  ) {
    await runMaintenance(env);
    await cleanupAuth(env.DB, Date.now());
    await cleanupRevenue(env);
    await cleanupFunnels(env);
    await cleanupPrivacy(env);
  },
} satisfies ExportedHandler<Bindings>;
