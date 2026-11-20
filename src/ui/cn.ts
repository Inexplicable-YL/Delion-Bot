import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// 自定义的圆角、阴影、缓动、层级与时长 token 要登记进来，否则 twMerge 认不出它们的类别，
// 会把同类的两个类名都留下。
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['chip', 'control', 'card', 'panel', 'window'],
      shadow: [
        'hairline',
        'hairline-strong',
        'focus',
        'invalid',
        'tooltip',
        'thumb',
        'inset-highlight',
        'btn',
        'card',
        'raised',
        'overlay',
      ],
      ease: ['out-strong', 'spring'],
    },
    classGroups: {
      'font-size': [{ text: [(value: string) => value.startsWith('ui-')] }],
      'font-weight': [{ font: ['medium', 'semibold'] }],
      z: [{ z: ['drawer', 'scrim', 'overlay', 'takeover', 'nav', 'popover', 'toast', 'tooltip'] }],
      duration: [{ duration: ['press', 'fast', 'base', 'slow', 'slower'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
