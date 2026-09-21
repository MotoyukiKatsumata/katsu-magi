import { z } from "zod";
import { SITE_IDS } from "./sites.js";

export const siteIdSchema = z.enum(SITE_IDS);

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

// ---------------------------------------------------------------- client -> server
export const clientMsgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello") }),
  z.object({
    type: z.literal("prompt"),
    requestId: z.string().min(1),
    text: z.string().min(1),
    sites: z.array(siteIdSchema).min(1),
  }),
  z.object({ type: z.literal("cancel"), requestId: z.string().min(1) }),
  z.object({ type: z.literal("newConversation"), sites: z.array(siteIdSchema).optional() }),
  z.object({ type: z.literal("retry"), site: siteIdSchema }),
  z.object({ type: z.literal("setSiteEnabled"), site: siteIdSchema, enabled: z.boolean() }),
  z.object({ type: z.literal("browser"), action: z.enum(["show", "hide", "restart"]) }),
]);
export type ClientMsg = z.infer<typeof clientMsgSchema>;

// ---------------------------------------------------------------- server -> client
export const siteStateSchema = z.object({
  enabled: z.boolean(),
  status: siteStatusSchema,
  message: z.string().optional(),
});
export type SiteState = z.infer<typeof siteStateSchema>;

export const stateMsgSchema = z.object({
  type: z.literal("state"),
  sites: z.record(siteIdSchema, siteStateSchema),
  browser: z.object({ running: z.boolean(), visible: z.boolean() }),
  busyRequestId: z.string().optional(),
});
export type StateMsg = z.infer<typeof stateMsgSchema>;

export const serverMsgSchema = z.discriminatedUnion("type", [
  stateMsgSchema,
  z.object({
    type: z.literal("siteStatus"),
    site: siteIdSchema,
    status: siteStatusSchema,
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("answer"),
    requestId: z.string(),
    site: siteIdSchema,
    text: z.string(),
    done: z.boolean(),
  }),
  z.object({
    type: z.literal("error"),
    site: siteIdSchema.optional(),
    requestId: z.string().optional(),
    code: z.string(),
    message: z.string(),
    selectorKey: z.string().optional(),
  }),
]);
export type ServerMsg = z.infer<typeof serverMsgSchema>;
