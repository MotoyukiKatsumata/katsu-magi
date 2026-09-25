/** The key hint shown in the prompt box, matching whichever mode is active. */
export function sendHint(enterMakesNewline: boolean): string {
  return enterMakesNewline ? "Ctrl+Enter で送信、Enter で改行" : "Enter で送信、Shift+Enter で改行";
}

export type EnterAction = "send" | "newline" | "ignore";

/** The parts of a keydown event the decision depends on. */
export interface EnterKeyEvent {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode?: number | undefined;
}

/**
 * What an Enter keypress in the prompt box should do.
 *
 * - "send": submit the prompt
 * - "newline": insert a line break ourselves (the browser would not)
 * - "ignore": leave the event alone, so the textarea does whatever it normally does
 *
 * Ctrl/Cmd+Enter always sends, in both modes, so the habit from earlier versions keeps working.
 *
 * While an IME is composing, Enter confirms the conversion; sending then would fire in the middle
 * of typing Japanese. `isComposing` covers it, and keyCode 229 catches browsers that report the
 * composing key without setting the flag.
 */
export function decideEnterAction(e: EnterKeyEvent, enterMakesNewline: boolean): EnterAction {
  if (e.key !== "Enter") return "ignore";
  if (e.isComposing || e.keyCode === 229) return "ignore";
  if (e.ctrlKey || e.metaKey) return "send";
  // Shift+Enter already inserts a line break; Alt+Enter does nothing, so we insert one.
  if (e.altKey) return "newline";
  if (e.shiftKey) return "ignore";
  return enterMakesNewline ? "ignore" : "send";
}
