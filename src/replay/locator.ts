import type { Locator, Page } from "@playwright/test";
import type { Target } from "../artifact/schema.js";

export function resolveTarget(page: Page, target: Target): Locator {
  return resolveLocator(page, target.primary);
}

export async function resolveVisibleTarget(page: Page, target: Target, timeoutMs: number): Promise<Locator> {
  const locators = [target.primary, ...target.fallbacks];

  for (const locatorSpec of locators) {
    const locator = resolveLocator(page, locatorSpec).first();
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return locator;
    } catch {
      // Try the next recorded targeting strategy before failing the step.
    }
  }

  throw new Error(`No visible target found. Tried: ${locators.map((locator) => `${locator.kind}:${locator.value}`).join(", ")}`);
}

export function resolveLocator(page: Page, locatorSpec: Target["primary"]): Locator {
  switch (locatorSpec.kind) {
    case "role":
      return page.getByRole("button", { name: locatorSpec.value });
    case "label":
      return page.getByLabel(locatorSpec.value);
    case "text":
      return page.getByText(locatorSpec.value, { exact: true });
    case "css":
      return page.locator(locatorSpec.value);
    case "xpath":
      return page.locator(`xpath=${locatorSpec.value}`);
    case "accessibility":
      return page.getByText(locatorSpec.value);
    case "coordinates":
      throw new Error("Coordinate locators are not supported by the web replay adapter yet.");
  }
}
