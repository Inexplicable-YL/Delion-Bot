import type { SVGProps } from 'react';

/** Heroicons 没有书架图形：按其 24 网格与 1.5 描边补一个，一本斜放、三本竖放。 */
export function LibraryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="m2.5 19.5 4-15M10.5 4.5v15M14.5 4.5v15M18.5 4.5v15" />
    </svg>
  );
}
