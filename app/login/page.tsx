"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { startGlobalNavigation } from "@/components/navigation/GlobalNavigationLoader";

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setIsSubmitting(true);

        try {
            const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
            const result = await response.json() as { error?: string; message?: string; code?: string; email?: string; user?: { role: string } };
            if (!response.ok) {
                if (result.code === "EMAIL_NOT_VERIFIED") {
                    const destination = `/verify-email?email=${encodeURIComponent(result.email || email)}`;
                    startGlobalNavigation(destination);
                    router.push(destination);
                    return;
                }
                setError(result.error || "Unable to log in.");
                return;
            }
            const destination = result.user?.role === "employer" ? "/client/dashboard" : result.user?.role === "admin" ? "/admin/dashboard" : "/freelancer/dashboard";
            startGlobalNavigation(destination);
            router.push(destination);
        } catch {
            setError("Unable to reach FreelanceX. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    }

    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button-quiet" href="/register">Create an account</Link></header><section className="auth-wrap"><div className="auth-card"><div className="eyebrow">Welcome back</div><h1>Pick up where you left off.</h1><p className="hero-copy">Sign in to manage your projects, conversations, and protected milestones.</p><form className="auth-form" onSubmit={handleSubmit}><label>Email address<input className="filter-input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" required /></label><label>Password<input className="filter-input" value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Your password" minLength={8} required /></label><Link className="form-link" href="/forgot-password">Forgot your password?</Link>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Signing in..." : "Log in"}</button></form></div></section></main>;
}
