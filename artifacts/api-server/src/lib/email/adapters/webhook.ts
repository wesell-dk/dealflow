import { createHmac, randomUUID } from "node:crypto";
import type { AdapterContext, AdapterResult, EmailAdapter, EmailMessage } from "../types";

interface WebhookConfig {
  url: string;
  signingHeader?: string;
  /** Optional override for the signature scheme prefix (default: sha256=). */
  signaturePrefix?: string;
}

interface WebhookCredentials {
  signingSecret: string;
}

function readConfig(ctx: AdapterContext): { config: WebhookConfig; creds: WebhookCredentials } {
  const cfg = ctx.channel.config as Partial<WebhookConfig>;
  if (!cfg.url || typeof cfg.url !== "string") {
    throw new Error("webhook adapter: config.url missing");
  }
  // Reject non-https unless explicitly allowed by the test env. The webhook
  // ships PII (recipient addresses) and a HMAC secret, so http-in-prod is a
  // foot-gun we don't want to enable by accident.
  const url = cfg.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("webhook adapter: config.url must be an http(s) URL");
  }
  if (
    process.env["NODE_ENV"] === "production"
    && !url.startsWith("https://")
  ) {
    throw new Error("webhook adapter: only https URLs are allowed in production");
  }
  const creds = (ctx.channel.credentials ?? {}) as Partial<WebhookCredentials>;
  if (!creds.signingSecret || typeof creds.signingSecret !== "string") {
    throw new Error("webhook adapter: credentials.signingSecret missing");
  }
  return {
    config: {
      url,
      signingHeader: cfg.signingHeader || "X-DealFlow-Signature",
      signaturePrefix: cfg.signaturePrefix || "sha256=",
    },
    creds: { signingSecret: creds.signingSecret },
  };
}

export const webhookAdapter: EmailAdapter = {
  type: "webhook",
  async send(message: EmailMessage, ctx: AdapterContext): Promise<AdapterResult> {
    const { config, creds } = readConfig(ctx);
    const id = randomUUID();
    const payload = {
      id,
      tenantId: ctx.tenantId,
      channelId: ctx.channel.id,
      from: { email: ctx.channel.fromEmail, name: ctx.channel.fromName ?? undefined },
      to: message.to,
      cc: message.cc ?? [],
      bcc: message.bcc ?? [],
      replyTo: message.replyTo ?? ctx.channel.replyTo ?? null,
      subject: message.subject,
      html: message.html,
      text: message.text,
      tags: message.tags ?? {},
      attachments: (message.attachments ?? []).map((a) => ({
        filename: a.filename,
        contentType: a.contentType ?? "application/octet-stream",
        contentBase64: a.content.toString("base64"),
        sizeBytes: a.content.length,
      })),
    };
    const body = JSON.stringify(payload);
    const sig = createHmac("sha256", creds.signingSecret).update(body).digest("hex");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-dealflow-message-id": id,
      "x-dealflow-tenant-id": ctx.tenantId,
      [config.signingHeader!.toLowerCase()]: `${config.signaturePrefix}${sig}`,
    };
    const res = await fetch(config.url, { method: "POST", headers, body });
    if (!res.ok) {
      // Don't echo the response body — it could contain reflected payload.
      throw new Error(`webhook adapter: HTTP ${res.status}`);
    }
    return { providerMessageId: id, providerInfo: { status: res.status } };
  },
};
