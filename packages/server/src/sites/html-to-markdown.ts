import TurndownService from "turndown";
// @ts-expect-error - the GFM plugin ships without type declarations
import { gfm } from "@joplin/turndown-plugin-gfm";

let service: TurndownService | undefined;

/** Words that, when they appear alone right before a code block, are the site's language label. */
const LANGUAGE_WORDS = new Set([
  "python", "py", "javascript", "js", "typescript", "ts", "tsx", "jsx", "bash", "sh", "shell", "zsh", "powershell", "ps1",
  "json", "yaml", "yml", "toml", "xml", "html", "css", "scss", "sql", "java", "kotlin", "swift", "go", "golang", "rust",
  "c", "cpp", "c++", "csharp", "c#", "ruby", "php", "perl", "r", "scala", "dart", "lua", "markdown", "md", "text", "plaintext",
  "txt", "dockerfile", "makefile", "diff", "ini", "graphql", "protobuf", "hcl", "terraform", "objective-c", "matlab",
]);

/** Trimmed, non-empty text nodes under `root` that are not inside `exclude`. */
function textNodesOutside(root: Node, exclude: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n === exclude) return;
    if (n.nodeType === 3) {
      const t = (n.textContent ?? "").trim();
      if (t) out.push(t);
      return;
    }
    n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

function normalizeLang(word: string): string {
  const w = word.trim().toLowerCase();
  return w === "c++" ? "cpp" : w === "c#" ? "csharp" : w === "golang" ? "go" : w;
}

function getService(): TurndownService {
  if (service) return service;
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.use(gfm);

  // <pre>…<code class="language-ts">…</code></pre>  ->  ```ts fenced block with the language kept.
  // ChatGPT wraps code blocks in a header bar ("typescript" + copy button) inside the <pre>;
  // taking only the <code> element drops that chrome.
  td.addRule("fencedCodeWithLanguage", {
    filter: (node) => node.nodeName === "PRE" && (node as HTMLElement).querySelector("code") !== null,
    replacement: (_content, node) => {
      const pre = node as HTMLElement;
      const code = pre.querySelector("code") as HTMLElement;
      const cls = `${code.getAttribute("class") ?? ""} ${pre.getAttribute("class") ?? ""}`;
      let lang = /language-([\w+#.-]+)/.exec(cls)?.[1] ?? "";
      if (!lang) {
        // ChatGPT puts the language in a header bar inside the <pre> (possibly nested); look at the
        // text nodes outside the <code> and use the first one that is a known language name.
        const label = textNodesOutside(pre, code).find((t) => LANGUAGE_WORDS.has(t.toLowerCase()));
        if (label) lang = normalizeLang(label);
      }
      const text = code.textContent ?? "";
      const fence = text.includes("```") ? "````" : "```";
      return `\n\n${fence}${lang}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
    },
  });

  // Turndown pads list markers with three spaces ("-   item"); use the conventional single space.
  td.addRule("tightListItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/gm, "\n  ");
      const parent = node.parentNode as HTMLElement | null;
      let prefix = options.bulletListMarker + " ";
      if (parent?.nodeName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + index : index + 1) + ". ";
      }
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });

  service = td;
  return td;
}

/** Convert the answer's HTML (already stripped of UI chrome by the adapter) into GitHub-flavoured markdown. */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  const md = getService().turndown(html);
  return dropLanguageLabels(md)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Gemini and Claude render the language as a label *outside* the <pre>, which survives as a
 * one-word paragraph right before the fence ("Python\n\n```\nprint(7)"). Fold it into the fence.
 */
export function dropLanguageLabels(md: string): string {
  return md.replace(/(^|\n)([A-Za-z][\w+#.-]{0,20})\n+```([\w+#.-]*)\n/g, (m, lead: string, word: string, fenceLang: string) => {
    if (!LANGUAGE_WORDS.has(word.toLowerCase())) return m;
    return `${lead}\`\`\`${fenceLang || normalizeLang(word)}\n`;
  });
}
