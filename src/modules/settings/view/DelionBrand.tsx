import blackLogo from '../../../../assets/DelionBot_black_bg.svg';
import whiteLogo from '../../../../assets/DelionBot_white_bg.svg';
import { cn } from '../../../ui/cn';

export function DelionBotBrand({
  alt = 'Delion Bot',
  className,
}: {
  alt?: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-grid', className)}>
      <img
        alt={alt}
        className="delion-brand-light col-start-1 row-start-1 h-full w-auto"
        src={whiteLogo}
      />
      <img
        alt=""
        aria-hidden="true"
        className="delion-brand-dark col-start-1 row-start-1 h-full w-auto"
        src={blackLogo}
      />
    </span>
  );
}
