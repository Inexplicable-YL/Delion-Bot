import type { MailServerConfig } from '../contract';
import { hostPorts } from '../../../core/ports';

interface ServerRow {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
}

export function storedMailServer(): MailServerConfig | null {
  const row = hostPorts()
    .database()
    .prepare('SELECT imap_host, imap_port, smtp_host, smtp_port FROM mail_accounts LIMIT 1')
    .get() as ServerRow | undefined;
  if (!row) return null;
  return {
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
  };
}
