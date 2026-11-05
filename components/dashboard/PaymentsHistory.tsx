"use client";

import { useEffect, useState } from "react";

type Payment = {
    id: string;
    reference: string;
    amount: number;
    currency: "NGN";
    status: "initializing" | "pending" | "success" | "failed";
    taskTitle: string;
    taskStatus: string;
    createdAt: string;
    verifiedAt: string | null;
};

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });

export default function PaymentsHistory() {
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            setLoading(true);
            setError("");
            try {
                const response = await fetch("/api/payments/transactions", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { transactions?: Payment[]; error?: string };
                if (!response.ok || !Array.isArray(result.transactions)) throw new Error(result.error || "Payment history could not be loaded.");
                if (!controller.signal.aborted) setPayments(result.transactions);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Payment history could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [retry]);

    return <section aria-label="Payment history" className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><span className="panel-kicker">Paystack</span><h2>Project payments</h2></div></div>
        {loading ? <div className="admin-users-loading" role="status"><span className="admin-users-spinner" /><span>Loading payment history...</span></div>
            : error ? <div className="admin-activity-error" role="alert"><p>{error}</p><button className="button button-quiet" onClick={() => setRetry((current) => current + 1)} type="button">Retry</button></div>
                : payments.length === 0 ? <div className="dashboard-empty"><strong>No payments yet.</strong><p>Payment history will appear after a Paystack payment is initialized. Records are not simulated.</p></div>
                    : <div className="dashboard-list">{payments.map((payment) => <article className="dashboard-list-row payment-history-row" key={payment.id}>
                    <div><strong>{payment.taskTitle}</strong><span>{money.format(payment.amount)} · {payment.reference}</span><small>{new Date(payment.verifiedAt || payment.createdAt).toLocaleString()}</small>
                        {payment.status === "success" && !["funded", "in_progress", "submitted", "completed"].includes(payment.taskStatus) && <small className="admin-transaction-review-warning">Payment verified; the project needs platform review.</small>}
                    </div>
                    <span className={`status-badge status-${payment.status}`}>{payment.status === "success" ? "verified" : payment.status}</span>
                    </article>)}</div>}
    </section>;
}
