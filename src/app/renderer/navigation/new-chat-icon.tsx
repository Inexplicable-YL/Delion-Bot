import { cn } from '../../../ui/cn';

/** 实心 PlusCircle 的加号随圆一起缩放；自绘以便只放大加号、圆的尺寸不变。 */
export function NewChatIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('text-accent', className)}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx={12} cy={12} fill="currentColor" r={9.75} />
      <path
        className="stroke-on-accent"
        d="M12 7.5v9M7.5 12h9"
        strokeLinecap="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}
