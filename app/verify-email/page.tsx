"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function VerifyEmailContent() {
    const email = useSearchParams().get("email") || "";
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [cooldown, setCooldown] = useState(0);

    async function resend() {
        if (isSending || cooldown > 0) return;
        setIsSending(true); setError(""); setMessage("");
        try {
            const response = await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
            const result = await response.json() as { message?: string; error?: string; retryAfterSeconds?: number };
            if (!response.ok) { setError(result.error || "Unable to send the verification email right now. Please try again later."); if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds); return; }
            setMessage("Verification email sent successfully. Please check your inbox.");
            setCooldown(60);
            const timer = window.setInterval(() => setCooldown((value) => { if (value <= 1) { window.clearInterval(timer); return 0; } return value - 1; }), 1000);
        } catch { setError("Unable to send the verification email right now. Please try again later."); } finally { setIsSending(false); }
    }

    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link></header><section className="auth-wrap"><div className="auth-card"><div className="eyebrow">Email verification</div><h1>Verify Your Email Address</h1><p className="hero-copy">Your email address has not been verified yet. Please verify your email to continue using FreelanceX.</p>{email && <p className="verification-email">{email}</p>}{message && <p className="success-message" role="status">{message}<br />Didn&apos;t receive it? Check your spam folder.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={isSending || cooldown > 0 || !email} onClick={resend} type="button">{isSending ? "Sending..." : cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend verification email"}</button><Link className="button button-quiet auth-link-button" href="/login">Return to sign in</Link></div></section></main>;
}

export default function VerifyEmailPage() {
    return <Suspense fallback={<main className="page-shell"><section className="auth-wrap"><div className="auth-card"><p className="muted-copy">Loading verification...</p></div></section></main>}><VerifyEmailContent /></Suspense>;
}