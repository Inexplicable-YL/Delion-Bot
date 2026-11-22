import { cn } from '../cn';

const rays = Array.from({ length: 8 }, (_, index) => index);

export function ThinkingMark() {
  return (
    <span className="relative size-4 animate-thinking-spin motion-reduce:animate-none">
      {rays.map((index) => (
        <span
          key={index}
          className="absolute inset-x-0 top-0 mx-auto h-1/2 w-0.5 origin-bottom"
          style={{ rotate: `${index * 45}deg` }}
        >
          <span
            className={cn(
              'absolute inset-x-0 origin-bottom animate-thinking-ray rounded-pill bg-current motion-reduce:animate-none',
              index % 2 === 0 ? 'top-0 h-2/3' : 'top-1/6 h-1/2 opacity-70',
            )}
            style={{ animationDelay: `${index * -0.2}s` }}
          />
        </span>
      ))}
    </span>
  );
}
