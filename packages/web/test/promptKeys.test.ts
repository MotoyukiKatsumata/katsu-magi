import { describe, expect, it } from "vitest";
import { decideEnterAction, sendHint, type EnterKeyEvent } from "../src/components/promptKeys";

const key = (over: Partial<EnterKeyEvent> = {}): EnterKeyEvent => ({
  key: "Enter",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  ...over,
});

describe("decideEnterAction", () => {
  it("ignores keys other than Enter", () => {
    expect(decideEnterAction(key({ key: "a" }), false)).toBe("ignore");
    expect(decideEnterAction(key({ key: "a" }), true)).toBe("ignore");
  });

  describe("by default, Enter sends", () => {
    it("sends on a bare Enter", () => {
      expect(decideEnterAction(key(), false)).toBe("send");
    });
    it("leaves Shift+Enter to the textarea", () => {
      expect(decideEnterAction(key({ shiftKey: true }), false)).toBe("ignore");
    });
    it("inserts a line break on Alt+Enter", () => {
      expect(decideEnterAction(key({ altKey: true }), false)).toBe("newline");
    });
  });

  describe("with 'Enter inserts a line break' turned on", () => {
    it("leaves a bare Enter to the textarea", () => {
      expect(decideEnterAction(key(), true)).toBe("ignore");
    });
    it("still inserts a line break on Alt+Enter", () => {
      expect(decideEnterAction(key({ altKey: true }), true)).toBe("newline");
    });
    it("leaves Shift+Enter to the textarea", () => {
      expect(decideEnterAction(key({ shiftKey: true }), true)).toBe("ignore");
    });
  });

  it("sends on Ctrl+Enter and Cmd+Enter in both modes", () => {
    for (const mode of [false, true]) {
      expect(decideEnterAction(key({ ctrlKey: true }), mode)).toBe("send");
      expect(decideEnterAction(key({ metaKey: true }), mode)).toBe("send");
    }
  });

  // The hint must name the key that actually sends in the current mode.
  it("describes the active keys", () => {
    expect(sendHint(false)).toContain("Enter で送信");
    expect(sendHint(false)).toContain("Shift+Enter で改行");
    expect(sendHint(true)).toContain("Ctrl+Enter で送信");
    expect(sendHint(true)).toContain("Enter で改行");
  });

  // Typing Japanese ends with Enter to accept the conversion. That must never send.
  describe("while an IME is composing", () => {
    it("ignores Enter reported through isComposing", () => {
      expect(decideEnterAction(key({ isComposing: true }), false)).toBe("ignore");
      expect(decideEnterAction(key({ isComposing: true }), true)).toBe("ignore");
    });
    it("ignores Enter reported only as keyCode 229", () => {
      expect(decideEnterAction(key({ keyCode: 229 }), false)).toBe("ignore");
    });
    it("ignores it even with modifiers held", () => {
      expect(decideEnterAction(key({ isComposing: true, ctrlKey: true }), false)).toBe("ignore");
      expect(decideEnterAction(key({ isComposing: true, altKey: true }), false)).toBe("ignore");
    });
  });
});
