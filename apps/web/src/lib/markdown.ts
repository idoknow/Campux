import { marked, type Tokens } from "marked";

// Custom marked extension: ++underline++
const underlineExtension = {
  extensions: [
    {
      name: "underline",
      level: "inline" as const,
      start(src: string) {
        return src.indexOf("++");
      },
      tokenizer(this: unknown, src: string): Tokens.Generic | undefined {
        const match = src.match(/^\+\+(.+?)\+\+/);
        if (!match) return;
        return {
          type: "underline",
          raw: match[0],
          text: match[1]?.trim() ?? "",
        };
      },
      renderer(token: Tokens.Generic) {
        return `<u>${token.text}</u>`;
      },
    },
  ],
};

marked.use(underlineExtension);

export function renderMarkdown(text: string): string {
  return marked.parse(text, { gfm: true, breaks: true }) as string;
}
