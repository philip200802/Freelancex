"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setError(""); setMessage(""); setIsSubmitting(true);
        try {
            const response = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
            const result = await response.json() as { message?: string; error?: string };
            if (!response.ok) setError(result.error || "Unable to request a reset link."); else setMessage(result.message || "Check your inbox for a reset link.");
        } catch { setError("Unable to reach FreelanceX. Please try again."); } finally { setIsSubmitting(false); }
    }

    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button-quiet" href="/login">Back to login</Link></header><section className="auth-wrap"><div className="auth-card"><div className="eyebrow">Account recovery</div><h1>Reset your password.</h1><p className="hero-copy">Enter the email connected to your account and we will send a secure one-hour reset link.</p><form className="auth-form" onSubmit={handleSubmit}><label>Email address<input className="filter-input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label>{message && <p className="success-message" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Sending..." : "Send reset link"}</button></form></div></section></main>;
}