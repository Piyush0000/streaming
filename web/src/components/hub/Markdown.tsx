import { memo, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../../lib/markdown';
import { cx } from '../../lib/format';

function renderInline(nodes: Inline[], keyPrefix = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.t) {
      case 'text':
        return n.v;
      case 'br':
        return <br key={key} />;
      case 'b':
        return <strong key={key}>{renderInline(n.c, `${key}.`)}</strong>;
      case 'i':
        return <em key={key}>{renderInline(n.c, `${key}.`)}</em>;
      case 'code':
        return (
          <code key={key} className="rounded bg-black/40 px-1 py-0.5 font-mono text-[0.85em] text-accent">
            {n.v}
          </code>
        );
      case 'a':
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="break-words text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {renderInline(n.c, `${key}.`)}
          </a>
        );
      default:
        return null;
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'p':
      return <p key={i}>{renderInline(b.c)}</p>;
    case 'code':
      return (
        <pre key={i} className="overflow-x-auto rounded-lg border border-border bg-black/40 p-3 font-mono text-xs leading-relaxed">
          <code>{b.v}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote key={i} className="border-l-2 border-accent/50 pl-3 text-text-secondary">
          {renderInline(b.c)}
        </blockquote>
      );
    case 'ul':
      return (
        <ul key={i} className="list-disc space-y-0.5 pl-5">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i} className="list-decimal space-y-0.5 pl-5">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    default:
      return null;
  }
}

/** Renders markdown-lite as React nodes. Never uses innerHTML; links limited to http(s) by the parser. */
function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  if (blocks.length === 0) return null;
  return <div className={cx('space-y-2 break-words text-sm leading-relaxed', className)}>{blocks.map(renderBlock)}</div>;
}

export default memo(Markdown);
