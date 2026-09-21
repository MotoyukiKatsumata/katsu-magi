import type { BrowserContext, Page } from "playwright-core";

/**
 * Minimize / restore the Chrome window that hosts `page` through the CDP Browser domain.
 * Headless is not an option for these sites (bot detection), so "hide" == minimize.
 */
export async function setWindowState(
  context: BrowserContext,
  page: Page,
  state: "minimized" | "normal",
): Promise<void> {
  const session = await context.newCDPSession(page);
  try {
    const { windowId } = (await session.send("Browser.getWindowForTarget")) as { windowId: number };
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: state } });
    if (state === "normal") await page.bringToFront();
  } finally {
    await session.detach().catch(() => undefined);
  }
}
