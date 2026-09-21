import { describe, expect, it } from "vitest";
import { clientMsgSchema, serverMsgSchema } from "../src/protocol.js";

describe("protocol schemas", () => {
  it("accepts a valid prompt message", () => {
    const msg = { type: "prompt", requestId: "r1", text: "hi", sites: ["chatgpt", "claude"] };
    expect(clientMsgSchema.parse(msg)).toEqual(msg);
  });

  it("rejects unknown site ids", () => {
    const msg = { type: "prompt", requestId: "r1", text: "hi", sites: ["bing"] };
    expect(() => clientMsgSchema.parse(msg)).toThrow();
  });

  it("rejects an empty prompt", () => {
    expect(() => clientMsgSchema.parse({ type: "prompt", requestId: "r", text: "", sites: ["gemini"] })).toThrow();
  });

  it("round-trips a state message", () => {
    const msg = {
      type: "state",
      sites: {
        chatgpt: { enabled: true, status: "idle" },
        gemini: { enabled: false, status: "needs-login", message: "please log in" },
        claude: { enabled: true, status: "streaming" },
      },
      browser: { running: true, visible: true },
    };
    expect(serverMsgSchema.parse(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
  });
});
