import { useState } from 'react';
import type { ViewDefinition } from '../../../app/module';
import { LlmStep } from './steps/LlmStep';
import { WizardShell } from './WizardShell';
import { CapabilitySetup } from './CapabilitySetup';
import { onboardingClient } from './client';

type OnboardingFlowProps = {
  views: ViewDefinition[];
  onWizardDone: () => void;
};

export function OnboardingFlow({ views, onWizardDone }: OnboardingFlowProps) {
  const wizardSteps = [...views.flatMap((view) => view.onboarding ?? []), LlmStep];
  const [step, setStep] = useState(0);

  const advance = () => setStep(step + 1);
  const back = () => {
    if (step > 0) setStep(step - 1);
  };
  const CurrentStep = wizardSteps[step];
  const capabilityStep = step === wizardSteps.length;
  return (
    <CapabilitySetup
      onDone={() => {
        void onboardingClient.complete().catch(() => {});
        onWizardDone();
      }}
    >
      {(content, footer) => (
        <WizardShell
          onBack={step > 0 ? back : undefined}
          onSkip={capabilityStep ? undefined : advance}
          step={step}
          stepCount={wizardSteps.length + 1}
          footer={capabilityStep ? footer : undefined}
        >
          {capabilityStep ? content : CurrentStep && <CurrentStep onDone={advance} />}
        </WizardShell>
      )}
    </CapabilitySetup>
  );
}
