import { onboardingClient } from './client';

// 冒烟与自动化由 main 或各 smoke 脚本在页面 URL 上注入该参数，整个引导直接短路。
export const isSmokeTest = new URLSearchParams(window.location.search).has('smoke-test');

// 开发时用 `VITE_REPLAY_ONBOARDING=1 pnpm dev` 每次启动都完整重播引导，不读本机记录。
const replayOnboarding = import.meta.env.DEV && import.meta.env.VITE_REPLAY_ONBOARDING === '1';

const freshInstall = { completed: false };

export function readOnboardingState() {
  if (replayOnboarding) return Promise.resolve(freshInstall);
  return onboardingClient.state().catch(() => freshInstall);
}
