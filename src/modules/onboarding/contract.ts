import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export const onboardingContract = defineContract('onboarding', {
  state: { input: z.undefined(), output: z.object({ completed: z.boolean() }) },
  complete: { input: z.undefined(), output: z.void() },
});
