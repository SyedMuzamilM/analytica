import { test, expect } from "@playwright/test";
import { createServer } from "vite";

test("development navigation loads the demo and documentation", async ({
  page,
}) => {
  const server = await createServer({
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
  });
  try {
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error("Vite did not publish a local address.");

    await page.goto(url);
    await expect(
      page.getByRole("heading", { name: /Know your traffic/ }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Explore live demo", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /Website overview/ }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /Website overview/ }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Documentation", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your first project.", exact: true }),
    ).toBeVisible();
  } finally {
    await server.close();
  }
});
