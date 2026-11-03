import { createTransport, type Transporter } from "nodemailer";

// Outgoing mail through the company relay. It accepts mail from the internal
// network without a login; SMTP_USER/SMTP_PASSWORD are only for a relay that
// wants one. STARTTLS is used when the server offers it.
const SMTP_HOST = process.env.SMTP_HOST ?? "mrelay.softdesign.dk";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 25);
const SMTP_FROM = process.env.SMTP_FROM ?? "GIS Converter <noreply@softdesign.dk>";

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  transporter ??= createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function sendMail(message: { to: string; subject: string; text: string }) {
  await getTransporter().sendMail({ from: SMTP_FROM, ...message });
}
