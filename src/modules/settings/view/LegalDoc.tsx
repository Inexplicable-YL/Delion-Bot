import { LegalMarkdown } from './LegalMarkdown';
import { SectionHeader } from './SectionHeader';

const articleClass = 'max-w-168 text-ui-body text-ink-2';

export function LegalDocument({
  markdown,
  settingId,
  title,
}: {
  markdown: string;
  settingId: string;
  title: string;
}) {
  return (
    <div className="grid gap-10" data-setting-id={settingId}>
      <SectionHeader title={title} />
      <article className={articleClass}>
        <LegalMarkdown markdown={markdown} />
      </article>
    </div>
  );
}
