import type { SVGProps } from 'react';

/** 侧栏开关：按 Heroicons 的 24 网格与 1.5 描边画一个面板外框，左侧一道短竖线示意侧栏。 */
export function SidebarIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect height={13.5} rx={2.25} width={16.5} x={3.75} y={5.25} />
      <path d="M8.25 9.75v4.5" />
    </svg>
  );
}
