type DesktopOnlyNoticeProps = {
  title: string;
  description: string;
};

export function DesktopOnlyNotice({ title, description }: DesktopOnlyNoticeProps) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="grid w-full max-w-md gap-2">
        <p className="text-ui-subhead text-ink-2">浏览器预览</p>
        <h2 className="text-ui-title-2">{title}</h2>
        <p className="text-ui-body text-ink-2">{description}</p>
      </div>
    </div>
  );
}
