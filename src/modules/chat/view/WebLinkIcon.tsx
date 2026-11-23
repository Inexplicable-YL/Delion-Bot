import { GlobeAltIcon } from '@heroicons/react/24/outline';
import {
  siBilibili,
  siGithub,
  siGitlab,
  siNpm,
  siStackoverflow,
  siWikipedia,
  siX,
  siYoutube,
  siZhihu,
  type SimpleIcon,
} from 'simple-icons';
import { cn } from '../../../ui/cn';

const siteIcons: [domains: string[], icon: SimpleIcon][] = [
  [['github.com', 'github.io'], siGithub],
  [['gitlab.com'], siGitlab],
  [['zhihu.com'], siZhihu],
  [['bilibili.com', 'b23.tv'], siBilibili],
  [['youtube.com', 'youtu.be'], siYoutube],
  [['x.com', 'twitter.com'], siX],
  [['wikipedia.org'], siWikipedia],
  [['npmjs.com', 'npmjs.org'], siNpm],
  [['stackoverflow.com'], siStackoverflow],
];

export function siteIcon(url: string): SimpleIcon | undefined {
  const host = URL.parse(url)?.hostname.toLowerCase() ?? '';
  return siteIcons.find(([domains]) =>
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  )?.[1];
}

export function WebLinkIcon({ url, className }: { url: string; className?: string }) {
  const icon = siteIcon(url);
  if (!icon) return <GlobeAltIcon aria-hidden className={cn('size-4', className)} />;
  return (
    <svg aria-hidden className={cn('size-4', className)} fill="currentColor" viewBox="-2 -2 28 28">
      <path d={icon.path} />
    </svg>
  );
}
