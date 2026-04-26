import nodemailer, { type Transporter } from "nodemailer";
import type { AdapterContext, AdapterResult, EmailAdapter, EmailMessage } from "../types";

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  requireTls?: boolean;
}

interface SmtpCredentials {
  password: string;
}

function readConfig(ctx: AdapterContext): { config: SmtpConfig; creds: SmtpCredentials } {
  const cfg = ctx.channel.config as Partial<SmtpConfig>;
  if (!cfg.host || typeof cfg.host !== "string") {
    throw new Error("smtp adapter: config.host missing");
  }
  if (typeof cfg.port !== "number" || !Number.isFinite(cfg.port)) {
    throw new Error("smtp adapter: config.port missing");
  }
  if (typeof cfg.user !== "string" || !cfg.user.trim()) {
    throw new Error("smtp adapter: config.user missing");
  }
  const creds = (ctx.channel.credentials ?? {}) as Partial<SmtpCredentials>;
  if (!creds.password || typeof creds.password !== "string") {
    throw new Error("smtp adapter: credentials.password missing");
  }
  return {
    config: {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure === true,
      user: cfg.user,
      requireTls: cfg.requireTls === true,
    },
    creds: { password: creds.password },
  };
}

function buildTransport(config: SmtpConfig, creds: SmtpCredentials): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    auth: { user: config.user, pass: creds.password },
  });
}

function fromHeader(name: string | null, email: string): string {
  if (name && name.trim()) {
    const cleaned = name.replace(/[\r\n"]/g, "").trim();
    return `${cleaned} <${email}>`;
  }
  return email;
}

export const smtpAdapter: EmailAdapter = {
  type: "smtp",
  async send(message: EmailMessage, ctx: AdapterContext): Promise<AdapterResult> {
    const { config, creds } = readConfig(ctx);
    const transport = buildTransport(config, creds);
    try {
      const info = await transport.sendMail({
        from: fromHeader(ctx.channel.fromName, ctx.channel.fromEmail),
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: message.replyTo ?? ctx.channel.replyTo ?? undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      return {
        providerMessageId: info.messageId ?? null,
        providerInfo: { accepted: info.accepted?.length ?? 0, rejected: info.rejected?.length ?? 0 },
      };
    } finally {
      transport.close();
    }
  },
};
