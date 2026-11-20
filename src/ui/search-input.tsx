import { MagnifyingGlassIcon as Search } from '@heroicons/react/24/outline';
import type * as React from 'react';
import { cn } from './cn';
import { Input } from './input';

function SearchInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <div className={cn('relative min-w-0', className)} data-slot="search-input">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2"
      />
      <Input className="pl-9" {...props} />
    </div>
  );
}

export { SearchInput };
