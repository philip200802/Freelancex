"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function EmailVerifiedContent() {
    const status = useSearchParams().get("status");
    const welcomePending = useSearchParams().get("welcome") === "pending";
    const alreadyVerified = status === "already";
    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link></header><section className="auth-wrap"><div className="auth-card verification-result"><div className="verification-icon" aria-hidden="true">&#10003;</div><div className="eyebrow">FreelanceX account</div><h1>{alreadyVerified ? "Your email is already verified." : "Email Verified Successfully!"}</h1><p className="hero-copy">{alreadyVerified ? "You can sign in and continue using FreelanceX." : "Your email address has been verified. Your FreelanceX account is now ready."}</p>{welcomePending && <p className="form-error" role="status">Your account is verified. The welcome email could not be sent yet.</p>}<Link className="button button-primary auth-link-button" href="/login">Sign In</Link><p className="muted-copy">Welcome to FreelanceX!</p></div></section></main>;
}

export default function EmailVerifiedPage() {
    return <Suspense fallback={<main className="page-shell"><section className="auth-wrap"><div className="auth-card"><p className="muted-copy">Loading verification status...</p></div></section></main>}><EmailVerifiedContent /></Suspense>;
}