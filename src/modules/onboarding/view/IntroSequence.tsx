import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../ui/button';
import { DelionBotBrand } from '../../settings/view';
import { OnboardingWindowBar } from './onboarding-window-bar';

export function IntroSequence({ onStart }: { onStart: () => void }) {
  return (
    <div
      className="flex h-dvh flex-col bg-page text-ink"
      data-density="product"
      data-onboarding-intro=""
    >
      <OnboardingWindowBar />
      <main className="grid min-h-0 flex-1 content-center overflow-y-auto p-app">
        <section className="mx-auto grid w-full max-w-reading gap-app-gap rounded-card bg-surface p-card-ui shadow-card">
          <DelionBotBrand className="size-12" />
          <h1 className="text-ui-large-title">欢迎使用 Delion Bot</h1>
          <p className="max-w-measure text-ui-body text-ink-2">
            在本机管理项目、文件和待办，也可以连接模型服务开展对话。
          </p>
          <Button className="justify-self-end" onClick={onStart} variant="accent">
            开始设置
            <ArrowRightIcon />
          </Button>
        </section>
      </main>
    </div>
  );
}
