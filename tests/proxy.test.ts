import { describe, expect, it, vi } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import origin from "../apps/worker/proxied";
import proxy from "../apps/proxy/index";

const secret = "test-only-proxy-secret-with-at-least-32-characters";
const bindings = () => ({ ...env, PROXY_SECRET: secret });

describe("authenticated forwarding", () => {
  it("preserves POST bodies, cookies, origin, paths and redirects while replacing forged proxy headers", async () => {
    const upstream = new Response(null, {
      status: 302,
      headers: { Location: "/signin" },
    });
    const outgoing = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
    try {
      const response = await proxy.fetch(
        new Request("https://analytica.test/api/auth/setup/options?test=1", {
          method: "POST",
          headers: {
            Origin: "https://analytica.test",
            Cookie: "analytica_session=test-session",
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.10",
            "X-Analytica-Client-IP": "forged-ip",
            "X-Analytica-Proxy-Secret": "forged-secret",
          },
          body: JSON.stringify({ token: "setup-token" }),
        }),
        { ORIGIN: "https://origin.test", PROXY_SECRET: secret },
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/signin");
      const [request] = outgoing.mock.calls[0];
      if (!(request instanceof Request))
        throw new Error("Expected an upstream request");
      expect(request.url).toBe(
        "https://origin.test/api/auth/setup/options?test=1",
      );
      expect(request.method).toBe("POST");
      expect(await request.json()).toEqual({ token: "setup-token" });
      expect(request.headers.get("Origin")).toBe("https://analytica.test");
      expect(request.headers.get("Cookie")).toBe(
        "analytica_session=test-session",
      );
      expect(request.headers.get("X-Analytica-Client-IP")).toBe("192.0.2.10");
      expect(request.headers.get("X-Analytica-Proxy-Secret")).toBe(secret);
      expect(request.redirect).toBe("manual");
    } finally {
      outgoing.mockRestore();
    }
  });

  it("blocks direct origin access and forged forwarding credentials", async () => {
    for (const supplied of [undefined, "wrong-secret"]) {
      const headers = new Headers({ "X-Analytica-Client-IP": "192.0.2.1" });
      if (supplied) headers.set("X-Analytica-Proxy-Secret", supplied);
      const response = await origin.fetch(
        new Request("https://origin.test/healthz", { headers }),
        bindings(),
        createExecutionContext(),
      );
      expect(response.status).toBe(supplied ? 403 : 308);
    }
  });

  it("serves the application through the authenticated proxy", async () => {
    const response = await origin.fetch(
      new Request("https://origin.test/healthz", {
        headers: { "X-Analytica-Proxy-Secret": secret },
      }),
      bindings(),
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "analytica",
      version: "0.1.0",
    });
  });

  it("keeps separate visitors in separate rate-limit buckets", async () => {
    const used = new Set<string>();
    const configured = {
      ...bindings(),
      EDGE_RATE_LIMIT: {
        async limit({ key }: { key: string }) {
          const success = !used.has(key);
          used.add(key);
          return { success };
        },
      },
    };
    const statuses = [];
    for (const ip of ["192.0.2.1", "192.0.2.2", "192.0.2.1"]) {
      const response = await origin.fetch(
        new Request("https://origin.test/v1/collect", {
          method: "POST",
          headers: {
            "CF-Connecting-IP": "2a06:98c0:3600::103",
            "X-Analytica-Client-IP": ip,
            "X-Analytica-Proxy-Secret": secret,
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
        configured,
        createExecutionContext(),
      );
      statuses.push(response.status);
      await response.body?.cancel();
    }
    expect(statuses[0]).not.toBe(429);
    expect(statuses[1]).not.toBe(429);
    expect(statuses[2]).toBe(429);
  });
});
