import type { SiteId } from "@katsu-magi/shared";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { ChatGptAdapter } from "./chatgpt.js";
import { ClaudeAdapter } from "./claude.js";
import { GeminiAdapter } from "./gemini.js";
import type { LlmSiteAdapter } from "./types.js";

export function createAdapter(site: SiteId, cfg: Config, log: Logger): LlmSiteAdapter {
  const child = log.child({ site });
  switch (site) {
    case "chatgpt":
      return new ChatGptAdapter(cfg.timeouts, child);
    case "gemini":
      return new GeminiAdapter(cfg.timeouts, child);
    case "claude":
      return new ClaudeAdapter(cfg.timeouts, child);
  }
}

/** One adapter per site listed in the config (enabled or not; enabling is a runtime toggle). */
export function createAdapters(cfg: Config, log: Logger): Map<SiteId, LlmSiteAdapter> {
  const map = new Map<SiteId, LlmSiteAdapter>();
  for (const site of Object.keys(cfg.sites) as SiteId[]) {
    map.set(site, createAdapter(site, cfg, log));
  }
  return map;
}
