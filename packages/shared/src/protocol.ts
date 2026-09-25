import { z } from "zod";
import { sessionSchema, sessionSummarySchema } from "./history.js";
import { siteIdSchema, siteStatusSchema } from "./sites.js";

// ---------------------------------------------------------------- client -> server
export const clientMsgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello") }),
  z.object({
    type: z.literal("prompt"),
    requestId: z.string().min(1),
    text: z.string().min(1),
    sites: z.array(siteIdSchema).min(1),
    /**
     * Continue this stored conversation: the server puts every tab back on it before sending.
     * Set while the user is looking at a past session, so typing into it just works.
     */
    resumeSessionId: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("cancel"), requestId: z.string().min(1) }),
  z.object({ type: z.literal("newConversation"), sites: z.array(siteIdSchema).optional() }),
  z.object({ type: z.literal("retry"), site: siteIdSchema }),
  z.object({ type: z.literal("setSiteEnabled"), site: siteIdSchema, enabled: z.boolean() }),
  z.object({ type: z.literal("browser"), action: z.enum(["show", "hide", "restart"]) }),
  // History
  z.object({ type: z.literal("listSessions") }),
  /** resume: false just shows the stored turns; true also puts every tab back on that chat. */
  z.object({ type: z.literal("openSession"), id: z.string().min(1), resume: z.boolean() }),
  z.object({ type: z.literal("deleteSession"), id: z.string().min(1) }),
  z.object({ type: z.literal("renameSession"), id: z.string().min(1), title: z.string().min(1).max(200) }),
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
  /** The history session the tabs are currently on, so the sidebar can highlight it. */
  sessionId: z.string().optional(),
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
  z.object({ type: z.literal("sessions"), items: z.array(sessionSummarySchema) }),
  /** Answer to openSession. `resumed` tells the UI whether the tabs moved to this conversation. */
  z.object({ type: z.literal("session"), session: sessionSchema.nullable(), resumed: z.boolean() }),
]);
export type ServerMsg = z.infer<typeof serverMsgSchema>;
