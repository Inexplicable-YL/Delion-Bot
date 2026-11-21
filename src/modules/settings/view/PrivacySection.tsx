import privacy from '../../../../docs/privacy.md?raw';
import { LegalDocument } from './LegalDoc';

export function PrivacySection() {
  return <LegalDocument markdown={privacy} settingId="privacy" title="隐私条款" />;
}
