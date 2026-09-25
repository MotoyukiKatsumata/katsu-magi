import { z } from "zod";
import { siteIdSchema, siteStatusSchema } from "./sites.js";

export const storedAnswerSchema = z.object({
  text: z.string(),
  status: siteStatusSchema,
  error: z.string().optional(),
});
export type StoredAnswer = z.infer<typeof storedAnswerSchema>;

// partialRecord, not record: with an enum key, zod v4's record requires every site to be present,
// and a turn only holds answers from the sites that were enabled.
export const storedTurnSchema = z.object({
  requestId: z.string(),
  prompt: z.string(),
  createdAt: z.string(),
  answers: z.partialRecord(siteIdSchema, storedAnswerSchema),
});
export type StoredTurn = z.infer<typeof storedTurnSchema>;

/** What the history sidebar lists. Cheap to load: no turn bodies. */
export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turnCount: z.number().int().nonnegative(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/** The stored record. `turnCount` is not part of it: the summary derives that from `turns`. */
export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turns: z.array(storedTurnSchema),
  /** Per-site chat URL, used to put the tabs back on this conversation when resuming. */
  conversationUrls: z.partialRecord(siteIdSchema, z.string()),
});
export type Session = z.infer<typeof sessionSchema>;
