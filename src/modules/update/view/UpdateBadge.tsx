import { ArrowUpCircleIcon as CircleArrowUp } from '@heroicons/react/24/outline';
import { useUpdateState, pendingUpdate } from './update';
import { IconButton } from '../../../ui/icon-button';

/** 排在标题栏左侧一组的最右端：状态提示，插进前进/后退中间会拆散导航按钮。 */
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
