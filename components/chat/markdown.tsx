"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { CodeBlock } from "./code-block";
import { SkillSaveCard } from "@/components/skills/skill-save-card";
import { AgentSaveCard } from "@/components/agents/agent-save-card";

// XSS guard: rehypeRaw parses raw HTML in model/user-supplied markdown, so it
// MUST be followed by a sanitizer or any <script>/onerror/javascript: payload
// renders live. The schema extends GitHub's default to keep the classNames the
// pipeline itself depends on: `language-*` fences (incl. forge-skill /
// forge-agent), and remark-math's `math-inline` / `math-display` markers that
// rehype-katex (which runs AFTER sanitizing) transforms.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []).filter((a) => !Array.isArray(a) || a[0] !== "className"), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
    div: [...(defaultSchema.attributes?.div ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
  },
};

const components: Components = {
  // Unwrap <pre> so CodeBlock provides its own chrome (no nested <pre>).
  pre: ({ children }) => <>{children}</>,
  code({ className, children, ...props }) {
    const text = String(children ?? "").replace(/\n$/, "");
    const match = /language-([\w+#-]+)/.exec(className || "");
    const lang = match?.[1] ?? "";
    // /skill-creator emits a `forge-skill` block → render a save card.
    if (lang === "forge-skill") {
      return <SkillSaveCard json={text} />;
    }
    // /agent-creator emits a `forge-agent` block → render an agent save card.
    if (lang === "forge-agent") {
      return <AgentSaveCard json={text} />;
    }
    const isBlock = Boolean(match) || text.includes("\n");
    if (isBlock) {
      return <CodeBlock code={text} lang={lang} />;
    }
    return (
      <code className="inline" {...props}>
        {children}
      </code>
    );
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
