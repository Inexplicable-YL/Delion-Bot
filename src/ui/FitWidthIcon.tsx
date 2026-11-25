import type { SVGProps } from 'react';

export function FitWidthIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M3.75 5.25v13.5M20.25 5.25v13.5" />
      <path d="M7.5 12h9M10.125 9.375 7.5 12l2.625 2.625M13.875 9.375 16.5 12l-2.625 2.625" />
    </svg>
  );
}
