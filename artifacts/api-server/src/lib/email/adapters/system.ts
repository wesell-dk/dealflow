import { sendEmail } from "../../email";
import type { AdapterContext, AdapterResult, EmailAdapter, EmailMessage } from "../types";
import { toLegacySendInput } from "../types";

/**
 * System adapter: routes through the legacy Resend-or-log helper. This is
 * the default fallback when no per-tenant channel is configured, which keeps
 * existing call sites working without any further setup.
 */
export const systemAdapter: EmailAdapter = {
  type: "system",
  async send(message: EmailMessage, ctx: AdapterContext): Promise<AdapterResult> {
    const result = await sendEmail(
      toLegacySendInput(message, {
        email: ctx.channel.fromEmail,
        name: ctx.channel.fromName,
        replyTo: ctx.channel.replyTo,
      }),
    );
    if (!result.ok) {
      throw new Error(result.error ?? "system adapter send failed");
    }
    return {
      providerMessageId: result.messageId ?? null,
      providerInfo: { provider: result.provider },
    };
  },
};
