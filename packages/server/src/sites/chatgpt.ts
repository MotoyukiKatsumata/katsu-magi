import type { Timeouts } from "../config.js";
import type { Logger } from "../logger.js";
import { BaseAdapter } from "./BaseAdapter.js";

export class ChatGptAdapter extends BaseAdapter {
  constructor(timeouts: Timeouts, log: Logger) {
    super("chatgpt", timeouts, log);
  }

  /** ChatGPT's ProseMirror editor accepts fill(), but multi-line prompts need insertText to keep line breaks. */
  protected override async typePrompt(prompt: string): Promise<void> {
    const input = await this.locate("input");
    await input.click({ timeout: 5_000 });
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
    await this.page.keyboard.insertText(prompt);
  }
}
