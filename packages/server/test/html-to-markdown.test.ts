import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/sites/html-to-markdown.js";

describe("htmlToMarkdown", () => {
  it("keeps the code fence language", () => {
    const md = htmlToMarkdown('<pre><code class="language-ts">const a = 1;\n</code></pre>');
    expect(md).toBe("```ts\nconst a = 1;\n```");
  });

  it("drops ChatGPT-style pre chrome and keeps only the code", () => {
    const html =
      '<pre><div class="header"><span>python</span><button>Copy code</button></div><code class="language-python">print(1)</code></pre>';
    expect(htmlToMarkdown(html)).toBe("```python\nprint(1)\n```");
  });

  it("converts GFM tables", () => {
    const html = "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
    const md = htmlToMarkdown(html);
    expect(md).toMatch(/\| a\s+\| b\s+\|/);
    expect(md).toMatch(/\| 1\s+\| 2\s+\|/);
  });

  it("converts lists and emphasis", () => {
    const md = htmlToMarkdown("<p>Hi <strong>there</strong></p><ul><li>one</li><li>two</li></ul>");
    expect(md).toBe("Hi **there**\n\n- one\n- two");
  });

  it("recovers the language from a ChatGPT-style header when the code has no class", () => {
    const html = '<pre><div class="header"><span>python</span><button>Copy</button></div><code>print(7)</code></pre>';
    expect(htmlToMarkdown(html)).toBe("```python\nprint(7)\n```");
  });

  it("folds a Gemini-style language label paragraph into the fence", () => {
    const html = "<p>Hi</p><div class=\"label\">Python</div><pre><code>print(7)</code></pre>";
    expect(htmlToMarkdown(html)).toBe("Hi\n\n```python\nprint(7)\n```");
  });

  it("drops a Claude-style label when the fence already has a language", () => {
    const html = '<div>python</div><pre><code class="language-python">print(7)</code></pre>';
    expect(htmlToMarkdown(html)).toBe("```python\nprint(7)\n```");
  });

  it("keeps an ordinary one-word paragraph before a code block", () => {
    const html = "<p>Result</p><pre><code>ok</code></pre>";
    expect(htmlToMarkdown(html)).toBe("Result\n\n```\nok\n```");
  });

  it("numbers ordered lists", () => {
    expect(htmlToMarkdown("<ol><li>x</li><li>y</li></ol>")).toBe("1. x\n2. y");
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToMarkdown("  ")).toBe("");
  });
});
