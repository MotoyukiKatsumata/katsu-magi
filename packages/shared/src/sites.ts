import { z } from "zod";

export const SITE_IDS = ["chatgpt", "gemini", "claude"] as const;
export type SiteId = (typeof SITE_IDS)[number];

export const siteIdSchema = z.enum(SITE_IDS);

/** Per-site lifecycle state. Lives here, not in protocol.ts, because history records it too. */
export const siteStatusSchema = z.enum([
  "starting",
  "idle",
  "needs-login",
  "blocked",
  "typing",
  "streaming",
  "done",
  "rate-limited",
  "error",
]);
export type SiteStatus = z.infer<typeof siteStatusSchema>;

export const SITE_LABELS: Record<SiteId, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};

export function isSiteId(v: unknown): v is SiteId {
  return typeof v === "string" && (SITE_IDS as readonly string[]).includes(v);
}
