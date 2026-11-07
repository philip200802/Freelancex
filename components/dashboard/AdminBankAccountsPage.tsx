"use client";

import { FormEvent, useEffect, useState } from "react";

type BankAccountEntry = {
    userId: string;
    freelancerName: string;
    freelancerEmail: string;
    bankName: string | null;
    bankCode: string | null;
    accountName: string | null;
    maskedAccountNumber: string | null;
    verificationStatus: "verified" | "unverified" | "missing";
    verifiedAt: string | null;
    updatedAt: string | null;
};
type Pagination = { page: number; limit: number; total: number; totalPages: number };
type BankSummary = { totalFreelancers: number; verifiedAccounts: number; unverifiedAccounts: number; freelancersWithoutAccounts: number };

function formatDate(value: string | null, missingLabel = "Not available") {
    if (!value) return missingLabel;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export default function AdminBankAccountsPage() {
    const [accounts, setAccounts] = useState<BankAccountEntry[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [summary, setSummary] = useState<BankSummary>({ totalFreelancers: 0, verifiedAccounts: 0, unverifiedAccounts: 0, freelancersWithoutAccounts: 0 });
    const [draftQuery, setDraftQuery] = useState("");
    const [query, setQuery] = useState("");
    const [verification, setVerification] = useState("all");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [revealingUser, setRevealingUser] = useState("");
    const [revealedNumbers, setRevealedNumbers] = useState<Record<string, string>>({});
    const [revealReason, setRevealReason] = useState("");
    const [revealError, setRevealError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function loadAccounts() {
            setLoading(true);
            setError("");
            try {
                const params = new URLSearchParams({ q: query, verification, page: String(page), limit: String(pagination.limit) });
                const response = await fetch(`/api/admin/bank-accounts?${params}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { bankAccounts?: BankAccountEntry[]; pagination?: Pagination; summary?: BankSummary; error?: string };
                if (!response.ok || !Array.isArray(result.bankAccounts) || !result.pagination || !result.summary) {
                    throw new Error(result.error || "Bank accounts could not be loaded.");
                }
                if (controller.signal.aborted) return;
                setAccounts(result.bankAccounts);
                setPagination(result.pagination);
                setSummary(result.summary);
                if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Bank accounts could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void loadAccounts();
        return () => controller.abort();
    }, [page, pagination.limit, query, verification]);

    function search(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPage(1);
        setQuery(draftQuery.trim());
        setRevealedNumbers({});
    }

    async function revealAccount(userId: string) {
        if (revealingUser || !revealReason.trim()) return;
        setRevealingUser(userId);
        setRevealError("");
        try {
            const response = await fetch(`/api/admin/bank-accounts/${userId}/reveal`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: revealReason.trim() }),
            });
            const result = await response.json() as { accountNumber?: string; error?: string };
            if (!response.ok || !result.accountNumber) throw new Error(result.error || "Account number could not be revealed.");
            setRevealedNumbers((current) => ({ ...current, [userId]: result.accountNumber! }));
            window.setTimeout(() => {
                setRevealedNumbers((current) => {
                    if (current[userId] !== result.accountNumber) return current;
                    const next = { ...current };
                    delete next[userId];
                    return next;
                });
            }, 30_000);
        } catch (revealErrorValue) {
            setRevealError(revealErrorValue instanceof Error ? revealErrorValue.message : "Account number could not be revealed.");
        } finally {
            setRevealingUser("");
        }
    }

    return <section aria-label="Freelancer payout bank accounts" className="admin-activity">
        <p className="muted-copy">Full account numbers are encrypted at rest and masked by default. Every reveal requires a reason and is recorded in admin activity logs.</p>
        <section aria-label="Bank account summary" className="dashboard-stat-grid">
            <article className="dashboard-stat-card"><span>Total freelancers</span><strong>{summary.totalFreelancers}</strong></article>
            <article className="dashboard-stat-card"><span>Verified bank accounts</span><strong>{summary.verifiedAccounts}</strong></article>
            <article className="dashboard-stat-card"><span>Unverified bank accounts</span><strong>{summary.unverifiedAccounts}</strong></article>
            <article className="dashboard-stat-card"><span>No bank account</span><strong>{summary.freelancersWithoutAccounts}</strong></article>
        </section>
        <form className="admin-transaction-filters" onSubmit={search}>
            <label>Search freelancers or bank details<input className="filter-input" maxLength={120} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Freelancer, bank, or account name" value={draftQuery} /></label>
            <label>Verification<select className="filter-input" onChange={(event) => { setVerification(event.target.value); setPage(1); setRevealedNumbers({}); }} value={verification}>
                <option value="all">All freelancers</option>
                <option value="verified">Verified accounts</option>
                <option value="unverified">Unverified accounts</option>
                <option value="missing">No bank account</option>
            </select></label>
            <button className="button button-primary" type="submit">Search</button>
        </form>

        <label className="admin-bank-reveal-reason">Reason for account access<input className="filter-input" maxLength={500} minLength={10} onChange={(event) => setRevealReason(event.target.value)} placeholder="Explain why the full account number is needed" value={revealReason} /></label>
        {Object.keys(revealedNumbers).length > 0 && <button className="button button-quiet" onClick={() => setRevealedNumbers({})} type="button">Hide revealed numbers</button>}
        {revealError && <p className="form-error" role="alert">{revealError}</p>}

        <section aria-live="polite" className="dashboard-panel">
            <div className="dashboard-table-heading"><span>{loading ? "Loading bank accounts..." : `${pagination.total} freelancers`}</span></div>
            {loading ? <div className="activity-loading-list" role="status">Loading bank accounts...</div>
                : error ? <div className="admin-activity-error" role="alert"><p>{error}</p></div>
                    : accounts.length === 0 ? <div className="dashboard-empty"><strong>No freelancers found.</strong><p>Try a different search or verification filter.</p></div>
                        : <div className="dashboard-table">{accounts.map((account) => <article className="dashboard-table-row" key={account.userId}>
                            <div>
                                <strong>{account.freelancerName}</strong>
                                <span>{account.freelancerEmail}</span>
                                <small>{account.bankName || "No bank account"}{account.accountName ? ` · ${account.accountName}` : ""} · {account.maskedAccountNumber || "No account number"}</small>
                                <small>Verified {formatDate(account.verifiedAt, "Not verified")} · Updated {formatDate(account.updatedAt)}</small>
                                {revealedNumbers[account.userId] && <small aria-live="polite">Full account number: <strong>{revealedNumbers[account.userId]}</strong></small>}
                            </div>
                            <div className="admin-transaction-status">
                                <span className={`status-badge status-${account.verificationStatus}`}>{account.verificationStatus}</span>
                                <small>{account.verificationStatus === "verified" ? "Eligible for payout" : "Not eligible for payout"}</small>
                                {account.verificationStatus === "verified" && !revealedNumbers[account.userId] &&
                                    <button className="button button-quiet" disabled={Boolean(revealingUser) || revealReason.trim().length < 10} onClick={() => void revealAccount(account.userId)} type="button">
                                        {revealingUser === account.userId ? "Recording access..." : "Reveal account"}
                                    </button>}
                            </div>
                        </article>)}</div>}
        </section>

        {!loading && !error && pagination.totalPages > 1 && <nav aria-label="Bank account pages" className="admin-activity-pagination">
            <button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>}
    </section>;
}
