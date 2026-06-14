import { marked, type Tokens } from "marked";
import DOMPurify from "dompurify";

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

// DOMPurify 配置：只允许基本的文本格式化标签，禁止 script、事件处理器等
export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, {
    gfm: true,
    breaks: true,
    renderer: safeRenderer,
  }) as string;

  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "u", "s", "del", "ins",
      "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
      "pre", "code", "hr", "span", "div",
    ],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
  });
}
