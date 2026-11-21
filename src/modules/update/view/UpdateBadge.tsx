import { ArrowUpCircleIcon as CircleArrowUp } from '@heroicons/react/24/outline';
import { useUpdateState, pendingUpdate } from './update';
import { IconButton } from '../../../ui/IconButton';

export function UpdateBadge({ onOpen }: { onOpen: () => void }) {
  const snapshot = useUpdateState((state) => state.snapshot);
  if (!snapshot || !pendingUpdate(snapshot)) return null;

  return (
    <IconButton
      className="[-webkit-app-region:no-drag] ml-2 text-success hover:text-success"
      aria-label="有可用的更新"
      onClick={onOpen}
      title="有可用的更新"
    >
      <CircleArrowUp />
    </IconButton>
  );
}
