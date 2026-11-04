"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function ResetPasswordPage() {
    return <Suspense fallback={<main className="page-shell"><section className="auth-wrap"><div className="auth-card"><p className="muted-copy">Loading password reset...</p></div></section></main>}><ResetPasswordContent /></Suspense>;
}

function ResetPasswordContent() {
    const token = useSearchParams().get("token") || "";
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setError(""); setMessage("");
        if (!token) { setError("This reset link is missing its token."); return; }
        if (password !== confirmation) { setError("Passwords do not match."); return; }
        setIsSubmitting(true);
        try {
            const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
            const result = await response.json() as { message?: string; error?: string };
            if (!response.ok) setError(result.error || "Unable to reset your password."); else setMessage(result.message || "Password updated successfully.");
        } catch { setError("Unable to reach FreelanceX. Please try again."); } finally { setIsSubmitting(false); }
    }

    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button-quiet" href="/login">Back to login</Link></header><section className="auth-wrap"><div className="auth-card"><div className="eyebrow">Choose a new password</div><h1>Make it memorable.</h1><form className="auth-form" onSubmit={handleSubmit}><label>New password<input className="filter-input" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required type="password" /></label><label>Confirm password<input className="filter-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} required type="password" /></label>{message && <p className="success-message" role="status">{message} <Link href="/login">Log in</Link></p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={isSubmitting || Boolean(message)} type="submit">{isSubmitting ? "Updating..." : "Update password"}</button></form></div></section></main>;
}