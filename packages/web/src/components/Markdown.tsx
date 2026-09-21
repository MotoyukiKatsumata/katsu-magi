import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const isFavicon = (src: unknown) => typeof src === "string" && /favicon/i.test(src);
// ChatGPT's source citations link with ?utm_source=chatgpt.com and contain a favicon + domain.
const isChatGptCitation = (href: unknown) => typeof href === "string" && /[?&]utm_source=chatgpt\.com/.test(href);

const components: Components = {
  // Links open in a new tab: navigating this tab away would drop the conversation shown here.
  a: ({ node: _node, href, className: _c, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        isChatGptCitation(href)
          ? "mx-0.5 inline-flex! items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 align-middle text-xs font-normal! text-zinc-700 no-underline! hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          : undefined
      }
    />
  ),
  // Favicons (source icons) render as small inline icons instead of block images.
  img: ({ node: _node, src, alt, className: _c, ...props }) =>
    isFavicon(src) ? (
      <img {...props} src={src} alt={alt ?? ""} loading="lazy" className="my-0! inline! h-3.5 w-3.5 rounded-sm align-[-2px]" />
    ) : (
      <img {...props} src={src} alt={alt ?? ""} loading="lazy" className="max-w-full rounded-md" />
    ),
};

/** Renders answer markdown. Raw HTML is not rendered (react-markdown default), which keeps this safe. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words dark:prose-invert prose-pre:whitespace-pre-wrap prose-pre:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
