import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../../ui/DropdownMenu';
import { SearchInput } from '../../../ui/SearchInput';
import { appCategories } from '../contract';

export type AppCategory = (typeof appCategories)[number];

const inlineCount = 4;

export function ConnectorFilterBar({
  query,
  category,
  onQueryChange,
  onCategoryChange,
}: {
  query: string;
  category: AppCategory | null;
  onQueryChange: (query: string) => void;
  onCategoryChange: (category: AppCategory | null) => void;
}) {
  const overflow = appCategories.slice(inlineCount);
  const overflowSelected = category !== null && overflow.includes(category);
  const chip = (label: string, value: AppCategory | null) => (
    <Button
      aria-pressed={category === value}
      key={label}
      onClick={() => onCategoryChange(value)}
      size="sm"
      variant={category === value ? 'default' : 'secondary'}
    >
      {label}
    </Button>
  );
  return (
    <div className="grid gap-3">
      <SearchInput
        aria-label="搜索应用"
        placeholder="搜索应用"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div aria-label="应用分类" className="flex flex-wrap gap-2" role="group">
        {chip('全部', null)}
        {appCategories.slice(0, inlineCount).map((item) => chip(item, item))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-pressed={overflowSelected}
              size="sm"
              variant={overflowSelected ? 'default' : 'secondary'}
            >
              {overflowSelected ? category : 'More'}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={category ?? ''}
              onValueChange={(value) => onCategoryChange(value as AppCategory)}
            >
              {overflow.map((item) => (
                <DropdownMenuRadioItem key={item} value={item}>
                  {item}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
