import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export function createMailer(smtpUrl: string | undefined, from: string, log: FastifyBaseLogger, isProd: boolean): Mailer {
  if (!smtpUrl) {
    return {
      async send(to, subject, text) {
        // Senza SMTP i messaggi non lasciano il server. In sviluppo si registrano nel log per il collaudo.
        if (isProd) log.warn({ subject }, 'SMTP non configurato: email non inviata');
        else log.info({ to, subject, text }, 'EMAIL (sviluppo, non inviata)');
      },
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}
