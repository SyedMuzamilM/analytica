import { test, expect } from "@playwright/test";

test("project dropdown shows icons and names and supports keyboard selection", async ({
  page,
}) => {
  await page.goto("/demo");
  const project = page.getByRole("combobox", { name: "Project", exact: true });
  await expect(project).toContainText("Orbit");
  await expect(project.locator(".project-symbol")).toBeVisible();
  await project.press("Enter");
  const fieldnotes = page.getByRole("option", { name: /Fieldnotes/ });
  await expect(fieldnotes).toContainText("fieldnotes.example");
  await expect(fieldnotes.locator(".project-symbol")).toBeVisible();
  await page.screenshot({
    path: "output/playwright/project-dropdown-desktop.png",
  });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(project).toContainText("Fieldnotes");
  await expect(page).toHaveURL(/site=demo-fieldnotes/);
  await expect(project).toBeFocused();
  await project.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(project).toContainText("Fieldnotes");

  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await project.click();
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    if (!bounds) throw new Error("Project menu is missing.");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `output/playwright/project-dropdown-${width}.png`,
    });
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("custom dropdown works inside a native modal without dismissing the form", async ({
  page,
}) => {
  await page.goto("/demo?view=settings");
  await expect(
    page.getByRole("combobox", { name: "Timezone", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  const timezone = dialog.getByRole("combobox", {
    name: "Reporting timezone",
    exact: true,
  });
  await timezone.click();
  await expect(
    page.getByRole("option", { name: "UTC", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: "UTC", exact: true }).click();
  await expect(timezone).toContainText("UTC");
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 660 });
  await timezone.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.screenshot({
    path: "output/playwright/timezone-dropdown-mobile.png",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
