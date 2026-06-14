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

/** Override renderer to strip images, code blocks, and inline code. */
const safeRenderer = new marked.Renderer();
safeRenderer.image = (token: Tokens.Image): string => {
  // Strip image, keep alt text only
  return token.text || "";
};
safeRenderer.code = (_token: Tokens.Code): string => {
  // Strip code blocks entirely
  return "";
};
safeRenderer.codespan = (token: Tokens.Codespan): string => {
  // Strip inline code formatting, keep raw text
  return token.text;
};

export function renderMarkdown(text: string): string {
  return marked.parse(text, {
    gfm: true,
    breaks: true,
    renderer: safeRenderer,
  }) as string;
}
