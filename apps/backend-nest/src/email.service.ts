import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

@Injectable()
export class EmailService {
  assertConfigured() {
    if (!String(process.env.SMTP_USER || "").trim() || !String(process.env.SMTP_APP_PASSWORD || "").trim()) {
      throw new ServiceUnavailableException("Email delivery is not configured. Set SMTP_USER and SMTP_APP_PASSWORD.");
    }
  }

  async send(to: string, subject: string, html: string) {
    this.assertConfigured();
    const user = String(process.env.SMTP_USER).trim();
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user, pass: String(process.env.SMTP_APP_PASSWORD) }
    });
    await transporter.sendMail({ from: `Muziki <${user}>`, to, replyTo: user, subject, html });
  }
}
