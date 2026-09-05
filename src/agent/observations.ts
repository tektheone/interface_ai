import type { Page } from "@playwright/test";

export type BrowserObservation = {
  url: string;
  title: string;
  visibleText: string;
  controls: ObservedControl[];
};

export type ObservedControl = {
  tag: string;
  text?: string;
  label?: string;
  name?: string;
  href?: string;
  type?: string;
};

export async function observePage(page: Page): Promise<BrowserObservation> {
  const [title, visibleText, controls] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("body").innerText({ timeout: 1_000 }).catch(() => ""),
    page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("a, button, input, select, textarea"));
      return elements.slice(0, 50).map((element) => {
        const htmlElement = element as HTMLElement;
        const input = element as HTMLInputElement;
        const id = htmlElement.getAttribute("id");
        const label = id ? document.querySelector(`label[for='${CSS.escape(id)}']`)?.textContent?.trim() : undefined;
        return {
          tag: element.tagName.toLowerCase(),
          text: htmlElement.innerText?.trim() || htmlElement.textContent?.trim() || undefined,
          label,
          name: input.name || undefined,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          type: input.type || undefined
        };
      });
    }).catch(() => [])
  ]);

  return {
    url: page.url(),
    title,
    visibleText: visibleText.slice(0, 4_000),
    controls
  };
}
