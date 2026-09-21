/**
 * Maintenance CLI:  pnpm katsu-magi <command> [...]
 *
 *   login                                  open all sites in the katsu-magi Chrome profile and wait
 *   adapter:test <site> "<prompt>" [--new] [--then "<follow-up>"]
 *   selectors:check <site>                 which selector candidates match on the live page
 *   selectors:probe <site>                 list editors / labelled buttons / custom elements on the live page
 *   selectors:dump <site>                  save the last assistant message HTML to test/fixtures
 *   inspect <site>                         open the site and pause in the Playwright Inspector
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { isSiteId, SITE_IDS, type SiteId } from "@katsu-magi/shared";
import { BrowserManager } from "./browser/BrowserManager.js";
import { findRepoRoot, loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createAdapter } from "./sites/registry.js";
import { ALL_SELECTOR_KEYS, loadSelectors, REQUIRED_SELECTOR_KEYS } from "./sites/selectors.js";
import { isAdapterError } from "./sites/types.js";


function usage(): never {
  console.error(`usage:
  pnpm katsu-magi login
  pnpm katsu-magi adapter:test <site> "<prompt>" [--new] [--then "<follow-up>"]
  pnpm katsu-magi selectors:check <site>
  pnpm katsu-magi selectors:probe <site> [conversation-url]
  pnpm katsu-magi selectors:dump <site> [conversation-url]
  pnpm katsu-magi inspect <site>
sites: ${SITE_IDS.join(", ")}`);
  process.exit(2);
}

function requireSite(v: string | undefined): SiteId {
  if (!isSiteId(v)) usage();
  return v;
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(prompt);
  rl.close();
}

async function withBrowser<T>(fn: (browser: BrowserManager) => Promise<T>): Promise<T> {
  const cfg = loadConfig();
  const browser = new BrowserManager(cfg.browser, logger.child({ component: "browser" }));
  await browser.start();
  try {
    return await fn(browser);
  } finally {
    await browser.stop();
  }
}

async function cmdLogin(): Promise<void> {
  await withBrowser(async (browser) => {
    for (const site of SITE_IDS) {
      const page = await browser.getPage(site);
      const adapter = createAdapter(site, loadConfig(), logger);
      await adapter.attach(page);
    }
    console.log("\nLog in to each site in the Chrome window (ChatGPT, Gemini, Claude).");
    await waitForEnter("Press Enter here when you are done... ");
    for (const site of SITE_IDS) {
      const adapter = createAdapter(site, loadConfig(), logger);
      await adapter.attach(await browser.getPage(site));
      const r = await adapter.ensureReady();
      console.log(`${site.padEnd(8)} ${r.state}${"url" in r ? `  (${r.url})` : ""}`);
    }
  });
}

async function cmdAdapterTest(site: SiteId, prompt: string, opts: { new?: boolean; then?: string }): Promise<void> {
  const cfg = loadConfig();
  await withBrowser(async (browser) => {
    const adapter = createAdapter(site, cfg, logger);
    await adapter.attach(await browser.getPage(site));
    if (opts.new) await adapter.newConversation();

    const run = async (p: string) => {
      console.log(`\n>>> ${site}: ${p}\n`);
      let last = "";
      const started = Date.now();
      try {
        for await (const chunk of adapter.send(p, new AbortController().signal)) {
          if (chunk.done) {
            process.stdout.write(`\n\n--- final markdown (${((Date.now() - started) / 1000).toFixed(1)}s) ---\n${chunk.text}\n`);
          } else {
            const delta = chunk.text.startsWith(last) ? chunk.text.slice(last.length) : `\n[rewrite]\n${chunk.text}`;
            process.stdout.write(delta);
            last = chunk.text;
          }
        }
      } catch (err) {
        if (isAdapterError(err)) {
          console.error(`\n!!! ${err.code}: ${err.message}`, err.detail);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    };

    await run(prompt);
    if (opts.then) await run(opts.then);
    console.log(`\nconversation url: ${adapter.conversationUrl() ?? "(none)"}`);
  });
}

async function cmdSelectorsCheck(site: SiteId): Promise<void> {
  const sel = loadSelectors(site);
  await withBrowser(async (browser) => {
    const page = await browser.getPage(site);
    const adapter = createAdapter(site, loadConfig(), logger);
    await adapter.attach(page);
    await page.waitForTimeout(2000);
    console.log(`\n${site}  ${page.url()}\n`);

    // The send button only appears once the composer has text on most sites, so type a draft
    // character before checking and remove it afterwards.
    const inputSel = sel.input.join(", ");
    let typed = false;
    if ((await page.locator(inputSel).count()) > 0) {
      try {
        await page.locator(inputSel).first().click({ timeout: 3000 });
        await page.keyboard.insertText("x");
        // Angular (Gemini) takes a moment to swap the mic button for the send button.
        await page.locator(sel.sendButton.join(", ")).first().waitFor({ state: "visible", timeout: 4000 }).catch(() => undefined);
        typed = true;
      } catch {
        // fine, check without a draft
      }
    }

    let failed = false;
    for (const key of ALL_SELECTOR_KEYS) {
      const candidates = sel[key];
      if (candidates.length === 0) continue;
      let matched: string | undefined;
      let count = 0;
      for (const c of candidates) {
        const n = await page.locator(c).count().catch(() => 0);
        if (n > 0) {
          matched = c;
          count = n;
          break;
        }
      }
      const required = REQUIRED_SELECTOR_KEYS.includes(key);
      if (!matched && required) failed = true;
      const mark = matched ? "OK " : required ? "MISSING" : "-  ";
      const hint = !matched && key === "assistantMessage" ? "(only matches once an answer is on screen)" : !matched && key === "stopButton" ? "(only visible while generating)" : "";
      console.log(`${mark.padEnd(8)} ${key.padEnd(18)} ${matched ? `${matched}  (${count})` : `no candidate matched ${hint}`}`);
    }
    if (typed) {
      await page.keyboard.press("Control+A").catch(() => undefined);
      await page.keyboard.press("Backspace").catch(() => undefined);
    }
    if (failed) {
      console.error("\nRequired selectors are missing. Use `pnpm katsu-magi inspect " + site + "` to find new ones and edit the JSON.");
      process.exitCode = 1;
    }
  });
}

const PROBE_SCRIPT = `(() => {
  const visible = (el) => el.getClientRects().length > 0;
  const attrs = (el) => ["id", "class", "aria-label", "placeholder", "data-testid", "role", "type", "name", "href"]
    .map((k) => [k, el.getAttribute(k)])
    .filter(([, v]) => v)
    .map(([k, v]) => k + '="' + String(v).slice(0, 70) + '"')
    .join(" ");
  const line = (el) => (visible(el) ? "[v]" : "[h]") + " <" + el.tagName.toLowerCase() + " " + attrs(el) + ">";
  const all = Array.from(document.querySelectorAll("*"));
  const editors = Array.from(document.querySelectorAll("textarea, [contenteditable='true'], [contenteditable='']"));
  const inSidebar = (el) => !!el.closest("nav, aside, [class*='sidebar'], [class*='sidenav'], bard-sidenav, side-navigation-v2, [data-testid*='history']");
  const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
    .filter((b) => (b.getAttribute("aria-label") || b.getAttribute("data-testid")) && !inSidebar(b));
  const messages = Array.from(document.querySelectorAll(
    "[data-message-author-role], [data-is-streaming], model-response, message-content, [data-testid*='message'], [class*='message-content'], [class*='markdown']"
  )).slice(0, 20);
  const custom = Array.from(new Set(all.map((e) => e.tagName.toLowerCase()).filter((t) => t.includes("-"))));
  const dataAttrs = Array.from(new Set(all.flatMap((e) => Array.from(e.attributes).map((a) => a.name))
    .filter((n) => /^data-(message|is-|testid|author|role|streaming)/.test(n))));
  const links = Array.from(document.querySelectorAll("a[href]"))
    .filter((a) => /login|signin|sign-in|auth|accounts\\.google/i.test(a.getAttribute("href") || "")).slice(0, 10);
  return {
    editors: editors.map(line),
    buttons: buttons.slice(0, 60).map(line),
    messages: messages.map(line),
    customElements: custom.slice(0, 80),
    dataAttributes: dataAttrs,
    loginLinks: links.map(line),
  };
})()`;

/** List the elements on the live page that are likely to be the composer, buttons and messages. */
async function cmdSelectorsProbe(site: SiteId, url?: string): Promise<void> {
  await withBrowser(async (browser) => {
    const page = await browser.getPage(site);
    const adapter = createAdapter(site, loadConfig(), logger);
    await adapter.attach(page);
    if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    console.log(`\n${site}  ${page.url()}\n`);
    // Passed as a string: tsx/esbuild "keepNames" would otherwise inject a __name helper into a
    // serialized function, which does not exist inside the page.
    const report = (await page.evaluate(PROBE_SCRIPT)) as {
      editors: string[];
      buttons: string[];
      messages: string[];
      customElements: string[];
      dataAttributes: string[];
      loginLinks: string[];
    };
    const section = (title: string, rows: string[]) => {
      console.log(`--- ${title} (${rows.length})`);
      for (const r of rows) console.log("  " + r);
    };
    section("editors (textarea / contenteditable)", report.editors);
    section("buttons with aria-label / data-testid (outside sidebars)", report.buttons);
    section("message-ish elements", report.messages);
    section("login-ish links", report.loginLinks);
    section("data-* attributes of interest", report.dataAttributes);
    section("custom elements", report.customElements);
  });
}

async function cmdSelectorsDump(site: SiteId, url?: string): Promise<void> {
  const sel = loadSelectors(site);
  await withBrowser(async (browser) => {
    const page = await browser.getPage(site);
    const adapter = createAdapter(site, loadConfig(), logger);
    await adapter.attach(page);
    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
    }
    const messages = page.locator(sel.assistantMessage.join(", "));
    const n = await messages.count();
    if (n === 0) {
      console.error("no assistant message on the page; open a conversation with at least one answer first");
      process.exitCode = 1;
      return;
    }
    const html = await messages.nth(n - 1).evaluate((el) => el.outerHTML);
    const dir = path.join(findRepoRoot(), "packages", "server", "test", "fixtures");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${site}-${new Date().toISOString().slice(0, 10)}.html`);
    writeFileSync(file, html);
    console.log(`saved ${html.length} bytes to ${file}`);
  });
}

async function cmdInspect(site: SiteId): Promise<void> {
  await withBrowser(async (browser) => {
    const page = await browser.getPage(site);
    const adapter = createAdapter(site, loadConfig(), logger);
    await adapter.attach(page);
    console.log("Playwright Inspector is open. Use 'Pick locator' to find selectors; press Resume to finish.");
    await page.pause();
  });
}

async function main(): Promise<void> {
  // `pnpm katsu-magi ...` forwards a literal "--" which would stop option parsing; drop it.
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { new: { type: "boolean" }, then: { type: "string" } },
  });
  const [cmd, a, b] = positionals;
  switch (cmd) {
    case "login":
      return cmdLogin();
    case "adapter:test":
      if (!b) usage();
      return cmdAdapterTest(requireSite(a), b, { ...(values.new ? { new: true } : {}), ...(values.then ? { then: values.then } : {}) });
    case "selectors:check":
      return cmdSelectorsCheck(requireSite(a));
    case "selectors:probe":
      return cmdSelectorsProbe(requireSite(a), b);
    case "selectors:dump":
      return cmdSelectorsDump(requireSite(a), b);
    case "inspect":
      return cmdInspect(requireSite(a));
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
