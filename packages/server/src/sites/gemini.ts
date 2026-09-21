import type { Timeouts } from "../config.js";
import type { Logger } from "../logger.js";
import { BaseAdapter } from "./BaseAdapter.js";

export class GeminiAdapter extends BaseAdapter {
  constructor(timeouts: Timeouts, log: Logger) {
    super("gemini", timeouts, log);
  }

  /** Gemini's Quill editor ignores fill(); type through the keyboard. */
  protected override async typePrompt(prompt: string): Promise<void> {
    const input = await this.locate("input");
    await input.click({ timeout: 5_000 });
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
    await this.page.keyboard.insertText(prompt);
  }

  /** The send button is disabled until Angular registers the input; wait for it to become enabled. */
  protected override async submit(): Promise<void> {
    const button = await this.locate("sendButton");
    await button.waitFor({ state: "visible", timeout: 5_000 });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await button.isEnabled().catch(() => false)) break;
      await this.page.waitForTimeout(100);
    }
    await button.click({ timeout: 5_000 });
  }
}
