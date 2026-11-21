import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { readSetting, writeSetting } from '../settings';
import { onboardingContract } from './contract';

const completedKey = 'onboarding-completed';

export const onboardingModule = defineModule({
  id: 'onboarding',
  ipc: implement(onboardingContract, {
    state: () => ({ completed: readSetting(completedKey) === '1' }),
    complete: () => writeSetting(completedKey, '1'),
  }),
});
