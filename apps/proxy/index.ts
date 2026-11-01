interface Bindings {
  ORIGIN: string;
  PROXY_SECRET: string;
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    const origin = new URL(env.ORIGIN);
    url.protocol = origin.protocol;
    url.host = origin.host;
    const headers = new Headers(request.headers);
    headers.set("X-Analytica-Proxy-Secret", env.PROXY_SECRET);
    headers.set(
      "X-Analytica-Client-IP",
      request.headers.get("CF-Connecting-IP") || "unknown",
    );
    return fetch(
      new Request(new Request(url, request), { headers, redirect: "manual" }),
    );
  },
} satisfies ExportedHandler<Bindings>;
