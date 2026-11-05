"use client";

import { useEffect, useState } from "react";

type Transaction = {
    id: string;
    reference: string;
    provider: string;
    amount: number;
    currency: string;
    status: "initializing" | "pending" | "success" | "failed";
    task: { id: string; title: string; status: string } | null;
    employerName: string;
    freelancerName: string;
    providerTransactionId: number | null;
    verifiedAt: string | null;
    createdAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });

function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export default function AdminTransactionsPage() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [query, setQuery] = useState("");
    const [draftQuery, setDraftQuery] = useState("");
    const [status, setStatus] = useState("all");
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function loadTransactions() {
            setLoading(true);
            setError("");
            try {
                const params = new URLSearchParams({ q: query, status, page: String(page), limit: String(pagination.limit) });
                const response = await fetch(`/api/admin/transactions?${params}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { transactions?: Transaction[]; pagination?: Pagination; error?: string };
                if (!response.ok || !Array.isArray(result.transactions) || !result.pagination) {
                    throw new Error(result.error || "Transactions could not be loaded.");
                }
                if (controller.signal.aborted) return;
                setTransactions(result.transactions);
                setPagination(result.pagination);
                if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Transactions could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void loadTransactions();
        return () => controller.abort();
    }, [page, pagination.limit, query, retry, status]);

    function search(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPage(1);
        setQuery(draftQuery.trim());
    }

    return <section aria-label="Paystack transactions" className="admin-activity">
        <form className="admin-transaction-filters" onSubmit={search}>
            <label>Search<input className="filter-input" maxLength={120} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Reference or participant" value={draftQuery} /></label>
            <label>Status<select className="filter-input" onChange={(event) => { setStatus(event.target.value); setPage(1); }} value={status}>
                <option value="all">All statuses</option>
                <option value="initializing">Initializing</option>
                <option value="pending">Pending</option>
                <option value="success">Verified</option>
                <option value="failed">Failed</option>
            </select></label>
            <button className="button button-primary" type="submit">Search</button>
        </form>

        <section aria-live="polite" className="dashboard-panel">
            <div className="dashboard-table-heading"><span>{loading ? "Loading transactions..." : `${pagination.total} Paystack transactions`}</span></div>
            {loading ? <div aria-label="Loading transactions" className="activity-loading-list" role="status">{Array.from({ length: 5 }, (_, index) => <div className="activity-loading-row" key={index}><span /><span /><span /></div>)}<span className="sr-only">Loading transactions...</span></div>
                : error ? <div className="admin-activity-error" role="alert"><p>{error}</p><button className="button button-quiet" onClick={() => setRetry((current) => current + 1)} type="button">Retry</button></div>
                    : transactions.length === 0 ? <div className="dashboard-empty"><strong>No transactions found.</strong><p>Only transactions initialized and verified through Paystack appear here. No payment activity is fabricated.</p></div>
                        : <div className="dashboard-table">{transactions.map((transaction) => <article className="dashboard-table-row admin-transaction-row" key={transaction.id}>
                            <div>
                                <strong>{transaction.task?.title || "Project payment"}</strong>
                                <span>{money.format(transaction.amount)} · {transaction.employerName} → {transaction.freelancerName}</span>
                                <small>Reference: {transaction.reference}</small>
                                {transaction.providerTransactionId && <small>Paystack transaction: {transaction.providerTransactionId}</small>}
                                {transaction.status === "success" && transaction.task && !["funded", "in_progress", "submitted", "completed"].includes(transaction.task.status) &&
                                    <small className="admin-transaction-review-warning">Payment verified; project was not activated and needs reconciliation.</small>}
                            </div>
                            <div className="admin-transaction-status">
                                <span className={`status-badge status-${transaction.status}`}>{transaction.status === "success" ? "verified" : transaction.status}</span>
                                <time dateTime={transaction.createdAt}>{formatDate(transaction.verifiedAt || transaction.createdAt)}</time>
                            </div>
                        </article>)}</div>}
        </section>

        {!loading && !error && pagination.totalPages > 1 && <nav aria-label="Transaction pages" className="admin-activity-pagination">
            <button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>}
    </section>;
}
