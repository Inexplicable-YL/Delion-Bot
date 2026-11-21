import terms from '../../../../docs/terms.md?raw';
import { LegalDocument } from './LegalDoc';

export function TermsSection() {
  return <LegalDocument markdown={terms} settingId="terms" title="使用条款" />;
}
