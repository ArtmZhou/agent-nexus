import type { ReactNode } from "react";

type MarkdownLiteProps = {
  text: string;
};

type Segment =
  | { type: "code"; language: string; value: string }
  | { type: "paragraph"; value: string };

export function MarkdownLite({ text }: MarkdownLiteProps) {
  const segments = splitSegments(text);

  return (
    <div className="markdown-lite">
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          return (
            <pre className="code-block" key={`${segment.type}-${index}`}>
              {segment.language && <span className="code-language">{segment.language}</span>}
              <code>{segment.value}</code>
            </pre>
          );
        }

        return <p key={`${segment.type}-${index}`}>{renderInlineCode(segment.value)}</p>;
      })}
    </div>
  );
}

function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const fencePattern = /```([A-Za-z0-9_-]*)\r?\n([\s\S]*?)```/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index).trim();
    if (before) segments.push(...paragraphs(before));
    segments.push({
      type: "code",
      language: match[1] ?? "",
      value: (match[2] ?? "").replace(/\s+$/u, "")
    });
    cursor = match.index + match[0].length;
  }

  const after = text.slice(cursor).trim();
  if (after) segments.push(...paragraphs(after));
  return segments.length > 0 ? segments : [{ type: "paragraph", value: "" }];
}

function paragraphs(text: string): Segment[] {
  return text
    .split(/\n{2,}/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({ type: "paragraph", value }));
}

function renderInlineCode(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/u).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }

    return <span key={index}>{part}</span>;
  });
}
