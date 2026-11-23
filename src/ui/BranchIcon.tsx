import type { SVGProps } from 'react';

export function BranchIcon(props: SVGProps<SVGSVGElement>) {
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
      <circle cx={6.75} cy={5.25} r={2.25} />
      <circle cx={17.25} cy={5.25} r={2.25} />
      <circle cx={6.75} cy={18.75} r={2.25} />
      <path d="M6.75 7.5v9" />
      <path d="M17.25 7.5v1.5a3 3 0 0 1-3 3h-4.5a3 3 0 0 0-3 3" />
    </svg>
  );
}
