import { Resend } from "resend";
import type { ReactElement } from "react";
import { log } from "./log";

const logger = log.child("email");

// Singleton Resend client
let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set");
    }
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  react: ReactElement;
  from?: string;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Send an email via Resend.
 * No-op in test environment — returns a mock success result.
 */
export async function sendEmail(
  options: SendEmailOptions
): Promise<SendEmailResult> {
  // Never send emails in test environment
  if (process.env.NODE_ENV === "test") {
    return { success: true, id: "test-email-skipped" };
  }

  try {
    const resend = getResend();
    const result = await resend.emails.send({
      from: options.from ?? "IziPilot <notifications@izipilote.com>",
      to: options.to,
      subject: options.subject,
      react: options.react,
    });

    if (result.error) {
      logger.error("resend api error", { subject: options.subject }, result.error);
      return { success: false, error: result.error.message };
    }

    return { success: true, id: result.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("send failed", { subject: options.subject }, err);
    return { success: false, error: message };
  }
}
