import {
  ArchiveBoxIcon,
  BookOpenIcon,
  CodeBracketSquareIcon,
  DocumentTextIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
  PresentationChartBarIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import { cn } from './cn';

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const codeExtensions = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'ipynb',
  'c',
  'h',
  'cpp',
  'java',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'kt',
  'sh',
  'bat',
  'ps1',
  'sql',
  'html',
  'css',
  'scss',
  'vue',
  'svelte',
  'json',
  'jsonc',
  'yml',
  'yaml',
  'toml',
  'xml',
]);

const iconsByExtension = new Map([
  ['pdf', BookOpenIcon],
  ['csv', TableCellsIcon],
  ['tsv', TableCellsIcon],
  ['xls', TableCellsIcon],
  ['xlsx', TableCellsIcon],
  ['ppt', PresentationChartBarIcon],
  ['pptx', PresentationChartBarIcon],
  ['zip', ArchiveBoxIcon],
  ['7z', ArchiveBoxIcon],
  ['rar', ArchiveBoxIcon],
  ['tar', ArchiveBoxIcon],
  ['gz', ArchiveBoxIcon],
  ['mp3', MusicalNoteIcon],
  ['wav', MusicalNoteIcon],
  ['flac', MusicalNoteIcon],
  ['mp4', FilmIcon],
  ['mov', FilmIcon],
  ['mkv', FilmIcon],
  ['webm', FilmIcon],
]);

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  const Icon = imageExtensions.has(extension)
    ? PhotoIcon
    : codeExtensions.has(extension)
      ? CodeBracketSquareIcon
      : (iconsByExtension.get(extension) ?? DocumentTextIcon);
  return <Icon aria-hidden className={cn('size-3.5 shrink-0 text-ink-2', className)} />;
}
