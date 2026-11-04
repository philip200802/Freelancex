"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function VerifyPage() {
    return <Suspense fallback={<main className="page-shell"><section className="auth-wrap"><div className="auth-card"><p className="muted-copy">Verifying your email...</p></div></section></main>}><VerifyContent /></Suspense>;
}

function VerifyContent() {
    const params = useSearchParams();
    const router = useRouter();
    const token = params.get("token");
    const [message, setMessage] = useState("Verifying your email...");
    const [error, setError] = useState("");

    useEffect(() => {
        if (!token) return;
        fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`).then(async (response) => {
            const result = await response.json() as { message?: string; error?: string; alreadyVerified?: boolean; welcomeEmailPending?: boolean };
            if (!response.ok) setError(result.error || "This verification link is invalid.");
            else router.replace(`/email-verified?status=${result.alreadyVerified ? "already" : "success"}${result.welcomeEmailPending ? "&welcome=pending" : ""}`);
        }).catch(() => setError("Unable to verify your email right now."));
    }, [router, token]);

    const displayError = error || (!token ? "This verification link is missing its token." : "");
    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button-quiet" href="/login">Log in</Link></header><section className="auth-wrap"><div className="auth-card"><div className="eyebrow">Account verification</div><h1>{displayError ? "This link needs attention." : message}</h1>{displayError ? <p className="form-error" role="alert">{displayError}</p> : <p className="muted-copy">Your account is ready. Sign in to continue to FreelanceX.</p>}<Link className="button button-primary auth-link-button" href="/login">Continue to login</Link></div></section></main>;
}