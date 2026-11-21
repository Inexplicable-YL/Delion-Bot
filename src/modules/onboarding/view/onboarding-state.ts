import { onboardingClient } from './client';

export const isSmokeTest = new URLSearchParams(window.location.search).has('smoke-test');

const replayOnboarding = import.meta.env.DEV && import.meta.env.VITE_REPLAY_ONBOARDING === '1';

const freshInstall = { completed: false };

export function readOnboardingState() {
  if (replayOnboarding) return Promise.resolve(freshInstall);
  return onboardingClient.state().catch(() => freshInstall);
}
