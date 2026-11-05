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

export function newJobAlertEmail({ freelancerName, jobTitle, description, budget, category, jobUrl }: { freelancerName: string; jobTitle: string; description: string; budget: number; category: string; jobUrl: string }) {
    const formattedBudget = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(budget);
    return layout(`<h2 style="color:#0F5132;margin-top:0;">A new project matches your profile</h2><p style="font-size:14px;line-height:1.6;color:#475569;">Hi ${escapeHtml(freelancerName)}, a new opportunity has just been posted on FreelanceX.</p><div style="border:1px solid #e2e8f0;border-radius:12px;padding:20px;background:#f8fafc;margin:20px 0;">
      <p style="margin:0 0 8px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(category)}</p>
      <h3 style="margin:0 0 10px;color:#0f172a;">${escapeHtml(jobTitle)}</h3>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#475569;">${escapeHtml(description.length > 180 ? `${description.slice(0, 177)}...` : description)}</p>
      <p style="margin:0;color:#0f172a;font-weight:700;">Budget: ${escapeHtml(formattedBudget)}</p>
    </div>${button(jobUrl, "View Job")}<p style="font-size:12px;color:#94a3b8;margin-top:30px;">This email was sent because you are an active, verified freelancer on FreelanceX.</p>`);
}

export function accountRemovedEmail({ name, reason, supportEmail }: { name: string; reason?: string; supportEmail?: string }) {
    const supportCopy = supportEmail
        ? `If you believe this action was made in error, contact FreelanceX support at ${escapeHtml(supportEmail)}.`
        : "If you believe this action was made in error, please contact FreelanceX support through the support channel you used to reach us.";
    const reasonCopy = reason ? `<p style="font-size:14px;line-height:1.6;color:#475569;"><strong>Reason provided:</strong> ${escapeHtml(reason)}</p>` : "";
    return layout(`<h2 style="color:#0F5132;margin-top:0;">Your FreelanceX Account Has Been Removed</h2><p style="font-size:14px;line-height:1.6;color:#475569;">Hello ${escapeHtml(name)}, your account has been permanently removed by FreelanceX platform administration. This account can no longer be used to sign in.</p>${reasonCopy}<p style="font-size:14px;line-height:1.6;color:#475569;">${supportCopy}</p>`);
}