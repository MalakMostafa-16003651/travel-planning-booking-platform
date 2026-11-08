import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { readMailConfiguration } from './mail.config';

@Injectable()
export class MailService {
  private readonly transport?: Transporter;
  private readonly from?: string;
  constructor(config: ConfigService) {
    const settings = readMailConfiguration(config);
    if (!settings) return;
    this.from = settings.from;
    this.transport = createTransport({
      host: settings.host, port: settings.port, secure: settings.port === 465,
      requireTLS: true, auth: { user: settings.user, pass: settings.pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    });
  }
  assertConfigured(): void {
    if (!this.transport) throw new ServiceUnavailableException('Password recovery is not configured');
  }
  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.assertConfigured();
    // Callers cannot override the trusted sender, transport, attachments or envelope.
    await this.transport!.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
  }
}
