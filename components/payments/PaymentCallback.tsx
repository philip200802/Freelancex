"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type VerificationState = "processing" | "success" | "pending" | "failed" | "error";
type VerificationResult = { status?: "success" | "pending" | "failed"; projectId?: string; projectFunded?: boolean; error?: string };

export default function PaymentCallback({ reference }: { reference: string }) {
    const router = useRouter();
    const [state, setState] = useState<VerificationState>("processing");
    const [message, setMessage] = useState("Verifying your payment with Paystack...");
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function verifyPayment() {
            if (!reference || reference.length > 100) {
                setState("error");
                setMessage("The Paystack return did not include a valid payment reference.");
                return;
            }
            try {
                const response = await fetch("/api/payments/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reference }),
                    cache: "no-store",
                    signal: controller.signal,
                });
                const result = await response.json() as VerificationResult;
                if (!response.ok) throw new Error(result.error || "Payment verification is unavailable.");
                if (result.status === "success" && result.projectFunded && result.projectId) {
                    setState("success");
                    setMessage("Payment verified. Your project is funded.");
                    router.replace(`/client/dashboard/projects/${encodeURIComponent(result.projectId)}?payment=success`);
                    return;
                }
                if (result.status === "pending") {
                    setState("pending");
                    setMessage("Paystack is still processing your payment. You can check again shortly.");
                    return;
                }
                if (result.status === "failed") {
                    setState("failed");
                    setMessage("Paystack did not complete this payment. The project has not been funded.");
                    return;
                }
                setState("error");
                setMessage("The payment could not be confirmed as successful. The project has not been marked funded.");
            } catch (error) {
                if (controller.signal.aborted) return;
                setState("error");
                setMessage(error instanceof Error ? error.message : "Payment verification is temporarily unavailable.");
            }
        }
        void verifyPayment();
        return () => controller.abort();
    }, [attempt, reference, router]);

    return <main className="page-shell">
        <section className="auth-wrap">
            <div className="auth-card" role="status" aria-live="polite">
                <h1>{state === "processing" ? "Verifying payment" : state === "success" ? "Payment confirmed" : "Payment update"}</h1>
                <p className={state === "failed" || state === "error" ? "form-error" : "muted-copy"}>{message}</p>
                {state === "pending" && <button className="button button-primary" onClick={() => { setState("processing"); setMessage("Checking the payment status with Paystack..."); setAttempt((current) => current + 1); }} type="button">Check again</button>}
                {state !== "processing" && state !== "success" && <Link className="button button-quiet" href="/client/dashboard">Return to dashboard</Link>}
            </div>
        </section>
    </main>;
}
