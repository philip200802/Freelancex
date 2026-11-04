import nodemailer from "nodemailer";
import { passwordResetEmail, verificationEmail, welcomeEmail } from "@/lib/email/templates";

type EmailMessage = { to: string; subject: string; html: string; text: string };

function getSender() {
    const email = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER;
    if (!email) throw new Error("Email sender is not configured.");
    return { email, name: process.env.BREVO_SENDER_NAME || process.env.EMAIL_FROM_NAME?.trim() || "FreelanceX" };
}

async function sendWithBrevoApi(message: EmailMessage) {
    const sender = getSender();
    const response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": process.env.BREVO_API_KEY || "", "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sender, to: [{ email: message.to }], subject: message.subject, htmlContent: message.html, textContent: message.text }) });
    if (!response.ok) {
        let providerCode = "unknown";
        let providerMessage = "Brevo returned an error.";
        try {
            const body = await response.json() as { code?: string; message?: string };
            providerCode = body.code || providerCode;
            providerMessage = body.message || providerMessage;
        } catch { /* Keep the sanitized fallback when Brevo does not return JSON. */ }
        throw new Error(`Brevo API rejected email with status ${response.status}; code=${providerCode}; message=${providerMessage}`);
    }
}

async function sendWithSmtp(message: EmailMessage) {
    const host = process.env.SMTP_SERVER || process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_KEY || process.env.SMTP_PASSWORD;
    const missing = [!host && "SMTP_SERVER/SMTP_HOST", !user && "SMTP_USER", !password && "SMTP_KEY/SMTP_PASSWORD"].filter(Boolean);
    if (missing.length) throw new Error(`SMTP configuration is incomplete. Missing: ${missing.join(", ")}.`);
    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass: password } });
    await transporter.sendMail({ from: getSender(), to: message.to, subject: message.subject, html: message.html, text: message.text });
}

async function sendEmail(message: EmailMessage) {
    if (process.env.BREVO_API_KEY) return sendWithBrevoApi(message);
    return sendWithSmtp(message);
}

export async function sendVerificationEmail({ name, email, verifyUrl }: { name: string; email: string; verifyUrl: string }) {
    await sendEmail({ to: email, subject: "Verify your FreelanceX email", html: verificationEmail({ name, verifyUrl }), text: `Welcome to FreelanceX, ${name}. Verify your email: ${verifyUrl}` });
}

export async function sendWelcomeEmail({ name, email, signInUrl }: { name: string; email: string; signInUrl: string }) {
    await sendEmail({ to: email, subject: "Welcome to FreelanceX!", html: welcomeEmail({ name, signInUrl }), text: `Welcome to FreelanceX, ${name}. Your email has been verified. Sign in: ${signInUrl}` });
}

export async function sendPasswordResetEmail({ email, resetUrl }: { email: string; resetUrl: string }) {
    await sendEmail({ to: email, subject: "Reset your FreelanceX password", html: passwordResetEmail({ resetUrl }), text: `Reset your FreelanceX password: ${resetUrl}` });
}