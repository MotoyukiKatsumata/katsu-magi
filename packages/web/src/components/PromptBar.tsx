import { useState, type KeyboardEvent } from "react";

interface Props {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}

export function PromptBar({ busy, disabled, onSend, onCancel }: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    onSend(t);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={disabled ? "Enable at least one site to send a prompt" : "Ask all enabled sites... (Ctrl+Enter to send)"}
        disabled={disabled}
        className="min-h-[3rem] flex-1 resize-y rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-zinc-700"
      />
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
  );
}
