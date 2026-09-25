import { useRef, useState, type KeyboardEvent } from "react";
import { decideEnterAction, sendHint } from "./promptKeys";

const NEWLINE_KEY = "katsu-magi.enterMakesNewline.v1";

interface Props {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}

export function PromptBar({ busy, disabled, onSend, onCancel }: Props) {
  const [text, setText] = useState("");
  const [enterMakesNewline, setEnterMakesNewline] = useState(() => {
    try {
      return localStorage.getItem(NEWLINE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const toggleNewline = (on: boolean) => {
    setEnterMakesNewline(on);
    try {
      localStorage.setItem(NEWLINE_KEY, on ? "1" : "0");
    } catch {
      // a remembered preference is not worth failing over
    }
  };

  const submit = () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    onSend(t);
    setText("");
  };

  /** Alt+Enter: the textarea would do nothing, so put the line break in ourselves. */
  const insertNewline = (el: HTMLTextAreaElement) => {
    const at = el.selectionStart;
    setText(`${el.value.slice(0, at)}\n${el.value.slice(el.selectionEnd)}`);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = at + 1;
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = decideEnterAction(
      {
        key: e.key,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.nativeEvent.keyCode,
      },
      enterMakesNewline,
    );
    if (action === "ignore") return;
    e.preventDefault();
    if (action === "send") submit();
    else insertNewline(e.currentTarget);
  };

  const hint = sendHint(enterMakesNewline);

  return (
    <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={
          disabled ? "送信できません（有効なサイトが無い、サーバー未接続、または過去の会話を表示中）" : `すべてのサイトに質問...（${hint}）`
        }
        disabled={disabled}
        className="min-h-[3rem] flex-1 resize-y rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-zinc-700"
      />

      <div className="flex flex-col items-end gap-1.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 select-none dark:text-zinc-400" title={hint}>
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-indigo-600"
            checked={enterMakesNewline}
            onChange={(e) => toggleNewline(e.target.checked)}
          />
          Enter で改行
        </label>
        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-700"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !text.trim()}
            className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
