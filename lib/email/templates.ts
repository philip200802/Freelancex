function escapeHtml(value: string) {
    return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function logo() {
    const url = process.env.FREELANCEX_LOGO_URL;
    return url?.startsWith("https://")
        ? `<img src="${url}" alt="FreelanceX" width="150" style="display:block;margin:0 auto 28px;max-width:150px;height:auto;" />`
        : `<div style="color:#0F5132;font-family:Arial,sans-serif;font-size:24px;font-weight:700;text-align:center;margin:0 auto 28px;">FreelanceX</div>`;
}

function layout(content: string) {
    return `<div style="font-family:Arial,sans-serif;background:#F8FAFC;padding:30px;color:#1e293b;"><div style="max-width:600px;margin:0 auto;background:#fff;padding:40px;border-radius:16px;border:1px solid #e2e8f0;">${logo()}${content}<p style="font-size:12px;color:#94a3b8;margin:30px 0 0;text-align:center;">&copy; FreelanceX. All rights reserved.</p></div></div>`;
}

const button = (url: string, label: string) => `<a href="${url}" style="background:#0F5132;color:#fff;padding:12px 24px;text-decoration:none;border-radius:10px;font-weight:bold;display:inline-block;margin:20px 0;">${label}</a>`;

export function verificationEmail({ name, verifyUrl }: { name: string; verifyUrl: string }) {
    return layout(`<h2 style="color:#0F5132;margin-top:0;">Welcome to FreelanceX, ${escapeHtml(name)}!</h2><p style="font-size:14px;line-height:1.6;color:#475569;">Please verify your email to activate your FreelanceX account and start connecting businesses with talented freelancers.</p>${button(verifyUrl, "Verify Email Address")}<p style="font-size:12px;color:#94a3b8;margin-top:30px;">If you did not create an account on FreelanceX, you can safely ignore this email.</p>`);
}

export function welcomeEmail({ name, signInUrl }: { name: string; signInUrl: string }) {
    return layout(`<h2 style="color:#0F5132;margin-top:0;">Welcome to FreelanceX!</h2><p style="font-size:14px;line-height:1.6;color:#475569;">Hi ${escapeHtml(name)}, your email has been verified and your account is ready to use.</p><p style="font-size:14px;line-height:1.6;color:#475569;">FreelanceX connects businesses with talented freelancers so great work can move forward with confidence.</p>${button(signInUrl, "Sign In")}`);
}

export function passwordResetEmail({ resetUrl }: { resetUrl: string }) {
    return layout(`<h2 style="color:#0F5132;margin-top:0;">Password Reset Request</h2><p style="font-size:14px;line-height:1.6;color:#475569;">We received a request to reset your FreelanceX password. Choose a new password using the button below.</p>${button(resetUrl, "Reset Password")}<p style="font-size:12px;color:#94a3b8;margin-top:30px;">This link is valid for 1 hour. If you did not request this, please secure your account.</p>`);
}