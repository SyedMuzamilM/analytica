import worker from "./index";
import type { Bindings } from "./env";
import { timingSafeEqual } from "node:crypto";

type ProxyBindings = Bindings & { PROXY_SECRET: string };

export default {
  ...worker,
  async fetch(request: Request, env: ProxyBindings, ctx: ExecutionContext) {
    const supplied = request.headers.get("X-Analytica-Proxy-Secret");
    if (
      !supplied &&
      env.APP_ORIGIN &&
      ["GET", "HEAD"].includes(request.method)
    ) {
      const url = new URL(request.url);
      const destination = new URL(env.APP_ORIGIN);
      destination.pathname = url.pathname;
      destination.search = url.search;
      return Response.redirect(destination, 308);
    }
    if (!env.PROXY_SECRET || !supplied || supplied.length > 256)
      return new Response("Forbidden", { status: 403 });
    const encoder = new TextEncoder();
    const [expectedHash, suppliedHash] = await Promise.all(
      [env.PROXY_SECRET, supplied].map((value) =>
        crypto.subtle.digest("SHA-256", encoder.encode(value)),
      ),
    );
    if (
      !timingSafeEqual(
        new Uint8Array(expectedHash),
        new Uint8Array(suppliedHash),
      )
    )
      return new Response("Forbidden", { status: 403 });
    const headers = new Headers(request.headers);
    headers.set(
      "CF-Connecting-IP",
      headers.get("X-Analytica-Client-IP") || "unknown",
    );
    headers.delete("X-Analytica-Proxy-Secret");
    headers.delete("X-Analytica-Client-IP");
    return worker.fetch(new Request(request, { headers }), env, ctx);
  },
} satisfies ExportedHandler<ProxyBindings>;
