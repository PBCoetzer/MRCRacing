import type { ReactNode } from "react";
import {
  isMarkdownHorizontalRule,
  parseInlineMarkdown,
} from "@/lib/blog/safe-markdown";

function inlineContent(value: string): ReactNode[] {
  return parseInlineMarkdown(value).map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "link") {
      return (
        <a
          key={key}
          href={token.href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-brand-cyan underline underline-offset-4"
        >
          {token.value}
        </a>
      );
    }
    if (token.type === "strong") {
      return <strong key={key} className="font-bold text-white">{token.value}</strong>;
    }
    if (token.type === "emphasis") {
      return <em key={key}>{token.value}</em>;
    }
    if (token.type === "strong-emphasis") {
      return <strong key={key} className="font-bold text-white"><em>{token.value}</em></strong>;
    }
    return token.value;
  });
}

export function SafeMarkdown({ value }: { value: string }) {
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (isMarkdownHorizontalRule(line)) {
      blocks.push(<hr key={`hr-${index}`} className="my-8 border-border/70" />);
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const content = inlineContent(heading[2]);
      blocks.push(heading[1].length === 1
        ? <h2 key={index} className="mt-8 font-heading text-3xl text-white">{content}</h2>
        : heading[1].length === 2
        ? <h3 key={index} className="mt-7 font-heading text-2xl text-white">{content}</h3>
        : <h4 key={index} className="mt-6 text-lg font-semibold text-white">{content}</h4>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="my-5 list-disc space-y-2 pl-6 text-foreground/90">
          {items.map((item, itemIndex) => <li key={itemIndex}>{inlineContent(item)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} className="my-5 list-decimal space-y-2 pl-6 text-foreground/90">
          {items.map((item, itemIndex) => <li key={itemIndex}>{inlineContent(item)}</li>)}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length && lines[index].trim() &&
      !/^(#{1,3})\s+|^[-*]\s+|^\d+\.\s+/.test(lines[index].trim()) &&
      !isMarkdownHorizontalRule(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`p-${index}`} className="my-4 text-base leading-8 text-foreground/88">
        {inlineContent(paragraph.join(" "))}
      </p>,
    );
  }

  return <div>{blocks}</div>;
}
