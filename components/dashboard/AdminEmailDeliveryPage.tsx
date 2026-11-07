"use client";

import { FormEvent, useEffect, useState } from "react";

type EmailEntry = {
    id: string;
    recipient: string;
    event: string;
    subject: string;
    relatedProject: string | null;
    status: "pending" | "processing" | "sent";
    attempts: number;
    failureReason: string | null;
    createdAt: string;
    lastAttemptAt: string | null;
    providerMessageId: string | null;
};
type Pagination = { page: number; limit: number; total: number; totalPages: number };

function formatDate(value: string | null) {
    if (!value) return "Not attempted";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

function statusLabel(status: EmailEntry["status"]) {
    if (status === "sent") return "Provider accepted";
    if (status === "processing") return "Sending";
    return "Queued / retrying";
}

export default function AdminEmailDeliveryPage() {
    const [emails, setEmails] = useState<EmailEntry[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [draftQuery, setDraftQuery] = useState("");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("all");
    const [page, setPage] = useState(1);
    const [refresh, setRefresh] = useState(0);
    const [loading, setLoading] = useState(true);
    const [busyEmailId, setBusyEmailId] = useState("");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function loadEmails() {
            setLoading(true);
            setError("");
            try {
                const params = new URLSearchParams({ q: query, status, page: String(page), limit: String(pagination.limit) });
                const response = await fetch(`/api/admin/email-outbox?${params}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { emails?: EmailEntry[]; pagination?: Pagination; error?: string };
                if (!response.ok || !Array.isArray(result.emails) || !result.pagination) {
                    throw new Error(result.error || "Email records could not be loaded.");
                }
                if (controller.signal.aborted) return;
                setEmails(result.emails);
                setPagination(result.pagination);
                if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Email records could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void loadEmails();
        return () => controller.abort();
    }, [page, pagination.limit, query, refresh, status]);

    function search(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPage(1);
        setQuery(draftQuery.trim());
    }

    async function retryEmail(emailId: string) {
        setBusyEmailId(emailId);
        setError("");
        setSuccess("");
        try {
            const response = await fetch("/api/admin/email-outbox", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ emailId }),
            });
            const result = await response.json() as { error?: string; message?: string };
            if (!response.ok) throw new Error(result.error || "Email could not be retried.");
            setSuccess(result.message || "Email retry processed.");
            setRefresh((current) => current + 1);
        } catch (retryError) {
            setError(retryError instanceof Error ? retryError.message : "Email could not be retried.");
        } finally {
            setBusyEmailId("");
        }
    }

    return <section className="admin-activity" aria-label="Email delivery monitoring">
        <p className="muted-copy">“Provider accepted” means Brevo or SMTP accepted the message for processing. It does not confirm delivery to the recipient&apos;s inbox. Failed outbox messages retry automatically; only pending retries can be manually retried.</p>
        <form className="admin-transaction-filters" onSubmit={search}>
            <label>Search recipient, event, or subject
                <input className="filter-input" maxLength={120} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Email, event, or subject" value={draftQuery} />
            </label>
            <label>Delivery status
                <select className="filter-input" onChange={(event) => { setStatus(event.target.value); setPage(1); }} value={status}>
                    <option value="all">All statuses</option>
                    <option value="pending">Queued / retrying</option>
                    <option value="processing">Sending</option>
                    <option value="sent">Provider accepted</option>
                </select>
            </label>
            <button className="button button-primary" type="submit">Search</button>
        </form>

        {success && <p className="success-message" role="status">{success}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <section className="dashboard-panel" aria-live="polite">
            <div className="dashboard-table-heading"><span>{loading ? "Loading email records..." : `${pagination.total} email records`}</span></div>
            {loading ? <div className="activity-loading-list" role="status">Loading email records...</div>
                : error ? <div className="dashboard-empty"><strong>Email records unavailable.</strong><p>Retry the request or check again later.</p><button className="button button-quiet" onClick={() => setRefresh((current) => current + 1)} type="button">Retry loading</button></div>
                    : emails.length === 0 ? <div className="dashboard-empty"><strong>No workflow emails found.</strong><p>Try a different search or status filter.</p></div>
                        : <div className="dashboard-table">{emails.map((email) => <article className="dashboard-table-row" key={email.id}>
                            <div>
                                <strong>{email.subject}</strong>
                                <span>{email.recipient} · {email.event}</span>
                                <small>{email.relatedProject || "No linked project"} · Created {formatDate(email.createdAt)} · Last attempt {formatDate(email.lastAttemptAt)} · {email.attempts} attempt{email.attempts === 1 ? "" : "s"}</small>
                                {email.providerMessageId && <small>Provider message ID: {email.providerMessageId}</small>}
                                {email.failureReason && <small className="form-error">Latest failure: {email.failureReason}</small>}
                            </div>
                            <div className="admin-transaction-status">
                                <span className={`status-badge status-${email.status}`}>{statusLabel(email.status)}</span>
                                {email.status === "pending" && email.attempts > 0 && <button className="button button-quiet" disabled={Boolean(busyEmailId)} onClick={() => void retryEmail(email.id)} type="button">
                                    {busyEmailId === email.id ? "Retrying..." : "Retry now"}
                                </button>}
                            </div>
                        </article>)}</div>}
        </section>
        {!loading && !error && pagination.totalPages > 1 && <nav aria-label="Email record pages" className="admin-activity-pagination">
            <button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>}
    </section>;
}
