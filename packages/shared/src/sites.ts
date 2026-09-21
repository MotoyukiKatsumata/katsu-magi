export const SITE_IDS = ["chatgpt", "gemini", "claude"] as const;
export type SiteId = (typeof SITE_IDS)[number];

export const SITE_LABELS: Record<SiteId, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};

export function isSiteId(v: unknown): v is SiteId {
  return typeof v === "string" && (SITE_IDS as readonly string[]).includes(v);
}
