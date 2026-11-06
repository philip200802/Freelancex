import nodemailer from "nodemailer";
import { accountRemovedEmail, newJobAlertEmail, passwordResetEmail, verificationEmail, welcomeEmail, workflowEmail } from "@/lib/email/templates";

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

export async function sendNewJobAlertEmail({ email, freelancerName, jobTitle, description, budget, category, jobUrl }: { email: string; freelancerName: string; jobTitle: string; description: string; budget: number; category: string; jobUrl: string }) {
    await sendEmail({
        to: email,
        subject: `New project opportunity: ${jobTitle}`,
        html: newJobAlertEmail({ freelancerName, jobTitle, description, budget, category, jobUrl }),
        text: `New project opportunity: ${jobTitle}. Budget: ${new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(budget)}. View it here: ${jobUrl}`,
    });
}

export async function sendAccountRemovedEmail({ email, name, reason }: { email: string; name: string; reason?: string }) {
    const supportEmail = process.env.SUPPORT_EMAIL?.trim();
    const subject = "Your FreelanceX Account Has Been Removed";
    const text = [
        `Hello ${name}, your account has been permanently removed by FreelanceX platform administration.`,
        "This account can no longer be used to sign in.",
        reason ? `Reason provided: ${reason}` : "",
        supportEmail
            ? `If you believe this action was made in error, contact FreelanceX support at ${supportEmail}.`
            : "If you believe this action was made in error, please contact FreelanceX support through the support channel you used to reach us.",
    ].filter(Boolean).join("\n\n");
    await sendEmail({
        to: email,
        subject,
        html: accountRemovedEmail({ name, reason, supportEmail }),
        text,
    });
}

export async function sendWorkflowEmail({
    to,
    subject,
    heading,
    recipientName,
    message,
    details,
    actionUrl,
    actionLabel,
}: {
    to: string;
    subject: string;
    heading: string;
    recipientName: string;
    message: string;
    details: Array<{ label: string; value: string }>;
    actionUrl: string;
    actionLabel: string;
}) {
    const text = [
        `Hi ${recipientName}, ${message}`,
        ...details.map(({ label, value }) => `${label}: ${value}`),
        `${actionLabel}: ${actionUrl}`,
    ].join("\n\n");
    await sendEmail({
        to,
        subject,
        html: workflowEmail({ heading, recipientName, message, details, actionUrl, actionLabel }),
        text,
    });
}