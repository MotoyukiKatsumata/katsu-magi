import type { Timeouts } from "../config.js";
import type { Logger } from "../logger.js";
import { BaseAdapter } from "./BaseAdapter.js";

export class ClaudeAdapter extends BaseAdapter {
  constructor(timeouts: Timeouts, log: Logger) {
    super("claude", timeouts, log);
  }

  protected override async typePrompt(prompt: string): Promise<void> {
    const input = await this.locate("input");
    await input.click({ timeout: 5_000 });
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
    await this.page.keyboard.insertText(prompt);
  }
}
