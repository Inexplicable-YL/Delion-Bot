import { Streamdown, type Components } from 'streamdown';
import { Card } from '../../../ui/card';

const components: Components = {
  h1: () => null,
  h2: ({ children }) => <h2 className="mt-10 text-ui-title-3 text-ink first:mt-0">{children}</h2>,
  p: ({ children }) => <p className="mt-3">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="mt-3 grid list-disc gap-1.5 pl-4">{children}</ul>,
  blockquote: ({ children }) => (
    <Card asChild className="text-ink [&_p]:mt-0" variant="inset">
      <blockquote>{children}</blockquote>
    </Card>
  ),
  // 站外链接由主进程的 will-navigate / setWindowOpenHandler 交给系统浏览器。
  a: ({ children, href }) => (
    <a
      className="rounded-chip text-ink underline underline-offset-4 transition-colors ease-out-strong hover:text-ink-2"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mt-3 w-full overflow-x-auto">
      <table className="w-full border-collapse text-ui-subhead">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line px-2 py-1 text-left font-medium text-ink">{children}</th>
  ),
  td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
};

export function LegalMarkdown({ markdown }: { markdown: string }) {
  return (
    <Streamdown
      className="space-y-0"
      components={components}
      controls={false}
      mode="static"
      skipHtml
    >
      {markdown}
    </Streamdown>
  );
}
