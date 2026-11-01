import { expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { app } from "../apps/worker/index";

it("preserves immutable asset responses while adding security and request headers", async () => {
  const response = await app.request(
    "https://analytica.test/index.html",
    {},
    {
      ...env,
      ASSETS: {
        ...env.ASSETS,
        fetch: async () =>
          Response.redirect("https://analytica.test/demo", 307),
      },
    },
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("Location")).toBe("https://analytica.test/demo");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
