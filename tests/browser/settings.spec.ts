import { test, expect } from "@playwright/test";

test("project dialogs stay centered and close only when dismissed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/demo?view=settings");
  const trigger = page
    .getByRole("button", { name: "Add project", exact: true })
    .first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error("Project dialog has no visible bounds.");
  expect(Math.abs(bounds.x + bounds.width / 2 - 720)).toBeLessThan(2);
  expect(Math.abs(bounds.y + bounds.height / 2 - 500)).toBeLessThan(2);
  await page.screenshot({ path: "output/playwright/modal-desktop.png" });
  await dialog.click({ position: { x: 8, y: 8 } });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(8, 8);
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 660 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  const mobile = await dialog.boundingBox();
  if (!mobile) throw new Error("Mobile project dialog has no visible bounds.");
  expect(mobile.x).toBeGreaterThanOrEqual(15);
  expect(mobile.y).toBeGreaterThanOrEqual(15);
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(375);
  expect(mobile.y + mobile.height).toBeLessThanOrEqual(645);
  await page.screenshot({ path: "output/playwright/modal-mobile.png" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("website settings keep related panels together on desktop and mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/demo?view=settings");
  await expect(
    page.getByRole("heading", { name: "Website settings", exact: true }),
  ).toBeVisible();
  const identity = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Project identity", exact: true }),
  });
  const tracker = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Install the tracker",
      exact: true,
    }),
  });
  const identityBounds = await identity.boundingBox();
  const trackerBounds = await tracker.boundingBox();
  if (!identityBounds || !trackerBounds)
    throw new Error("Settings panels are missing.");
  expect(Math.abs(trackerBounds.x - identityBounds.x)).toBeLessThan(2);
  expect(
    trackerBounds.y - identityBounds.y - identityBounds.height,
  ).toBeLessThanOrEqual(25);
  await page.screenshot({
    path: "output/playwright/settings-desktop.png",
    fullPage: true,
  });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByLabel("Website name", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Copy snippet", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Copy snippet", exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: "output/playwright/settings-mobile.png",
    fullPage: true,
  });
});
