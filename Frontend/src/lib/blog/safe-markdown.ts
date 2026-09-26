export type InlineMarkdownToken =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string }
  | { type: "strong"; value: string }
  | { type: "emphasis"; value: string }
  | { type: "strong-emphasis"; value: string };

const inlinePattern = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)|\*\*\*([^*\n]+)\*\*\*|___([^_\n]+)___|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;

export function parseInlineMarkdown(value: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = [];
  let cursor = 0;

  for (const match of value.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ type: "text", value: value.slice(cursor, index) });

    if (match[1] && match[2]) {
      tokens.push({ type: "link", value: match[1], href: match[2] });
    } else if (match[3] || match[4]) {
      tokens.push({
        type: "strong-emphasis",
        value: match[3] ?? match[4],
      });
    } else if (match[5] || match[6]) {
      tokens.push({ type: "strong", value: match[5] ?? match[6] });
    } else {
      tokens.push({
        type: "emphasis",
        value: match[7] ?? match[8] ?? match[0],
      });
    }

    cursor = index + match[0].length;
  }

  if (cursor < value.length) tokens.push({ type: "text", value: value.slice(cursor) });
  return tokens;
}

export function isMarkdownHorizontalRule(value: string) {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(value.trim());
}
