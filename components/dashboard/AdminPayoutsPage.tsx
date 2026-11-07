"use client";

import { FormEvent, useEffect, useState } from "react";

type EligibleProject = {
    payoutId: string;
    taskId: string;
    taskTitle: string;
    clientName: string;
    projectStatus: string;
    freelancerName: string;
    payoutStatus: "pending" | "failed" | "rejected";
    dueStatus: "overdue" | "due_within_24_hours";
    dueAt: string;
    approvedAt: string;
    grossAmountKobo: number;
    commissionRatePercent: number;
    commissionAmountKobo: number;
    amountKobo: number;
    currency: string;
    bankAccountStatus: "verified" | "missing" | "unverified";
    bankName: string | null;
    accountName: string | null;
    maskedAccountNumber: string | null;
    paymentVerifiedAt: string | null;
    blockReason: string | null;
    failureReason: string | null;
    approvedDeliverables: {
        message: string;
        links: string[];
        attachments: Array<{ fileName: string; url: string; fileType: string; fileSize: number }>;
        reviewedAt: string | null;
    } | null;
};

type Payout = {
    id: string;
    taskId: string;
    taskTitle: string;
    freelancerName: string;
    bankName: string | null;
    accountName: string | null;
    maskedAccountNumber: string | null;
    grossAmountKobo: number | null;
    commissionRatePercent: number | null;
    commissionAmountKobo: number | null;
    amountKobo: number;
    currency: string;
    transferReference: string | null;
    transferredAt: string | null;
    dueAt: string | null;
    approvedAt: string | null;
    failureReason: string | null;
    receiptUrl: string | null;
    adminName: string | null;
    status: "pending" | "completed" | "failed" | "rejected";
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };
type PayoutSummary = {
    pendingCount: number;
    overdueCount: number;
    blockedCount: number;
    failedCount: number;
    completedCount: number;
    outstandingKobo: number;
    completedKobo: number;
};

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });
function formatDate(value: string | null) {
    if (!value) return "Unknown date";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export default function AdminPayoutsPage() {
    const [payouts, setPayouts] = useState<Payout[]>([]);
    const [eligibleProjects, setEligibleProjects] = useState<EligibleProject[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [summary, setSummary] = useState<PayoutSummary>({ pendingCount: 0, overdueCount: 0, blockedCount: 0, failedCount: 0, completedCount: 0, outstandingKobo: 0, completedKobo: 0 });
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [transferReferences, setTransferReferences] = useState<Record<string, string>>({});
    const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
    const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
    const [failureReasons, setFailureReasons] = useState<Record<string, string>>({});
    const [submittingTask, setSubmittingTask] = useState("");
    const [success, setSuccess] = useState("");
    const [activeTab, setActiveTab] = useState<"awaiting" | "overdue" | "blocked" | "failed" | "completed">("awaiting");
    const [draftQuery, setDraftQuery] = useState("");
    const [query, setQuery] = useState("");
    const [historyStatus, setHistoryStatus] = useState("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [minAmount, setMinAmount] = useState("");
    const [maxAmount, setMaxAmount] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function loadPayouts() {
            setLoading(true);
            setError("");
            try {
                const params = new URLSearchParams({
                    page: String(page),
                    limit: String(pagination.limit),
                    q: query,
                    status: historyStatus,
                    dateFrom,
                    dateTo,
                    minAmount,
                    maxAmount,
                });
                const response = await fetch(`/api/admin/payouts?${params}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { payouts?: Payout[]; eligibleProjects?: EligibleProject[]; pagination?: Pagination; summary?: PayoutSummary; error?: string };
                if (!response.ok || !Array.isArray(result.payouts) || !Array.isArray(result.eligibleProjects) || !result.pagination || !result.summary) {
                    throw new Error(result.error || "Payout records could not be loaded.");
                }
                if (controller.signal.aborted) return;
                setPayouts(result.payouts);
                setEligibleProjects(result.eligibleProjects);
                setPagination(result.pagination);
                setSummary(result.summary);
                if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Payout records could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void loadPayouts();
        return () => controller.abort();
    }, [dateFrom, dateTo, historyStatus, maxAmount, minAmount, page, pagination.limit, query, retry]);

    function searchPayouts(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPage(1);
        setQuery(draftQuery.trim());
    }

    async function recordPayout(event: FormEvent<HTMLFormElement>, project: EligibleProject) {
        event.preventDefault();
        if (submittingTask || !confirmed[project.taskId]) return;
        setSubmittingTask(project.taskId);
        setError("");
        setSuccess("");
        try {
            const response = await fetch("/api/admin/payouts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    taskId: project.taskId,
                    transferReference: transferReferences[project.taskId] || "",
                    receiptUrl: receiptUrls[project.taskId] || "",
                    transferConfirmed: confirmed[project.taskId] === true,
                }),
            });
            const result = await response.json() as { error?: string; message?: string };
            if (!response.ok) throw new Error(result.error || "Payout could not be recorded.");
            setSuccess(result.message || "Manual payout recorded.");
            setRetry((current) => current + 1);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Payout could not be recorded.");
        } finally {
            setSubmittingTask("");
        }
    }

    async function markPayoutFailed(event: FormEvent<HTMLFormElement>, project: EligibleProject) {
        event.preventDefault();
        const reason = (failureReasons[project.taskId] || "").trim();
        if (submittingTask || !reason) return;
        setSubmittingTask(project.taskId);
        setError("");
        setSuccess("");
        try {
            const response = await fetch("/api/admin/payouts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId: project.taskId, action: "mark_failed", failureReason: reason }),
            });
            const result = await response.json() as { error?: string; message?: string };
            if (!response.ok) throw new Error(result.error || "Payout failure could not be recorded.");
            setSuccess(result.message || "Payout marked failed.");
            setFailureReasons((current) => ({ ...current, [project.taskId]: "" }));
            setRetry((current) => current + 1);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Payout failure could not be recorded.");
        } finally {
            setSubmittingTask("");
        }
    }

    const overdueCount = summary.overdueCount;
    const blockedCount = summary.blockedCount;
    const failedCount = summary.failedCount;
    const completedCount = summary.completedCount;
    const visibleProjects = eligibleProjects.filter((project) => {
        if (activeTab === "awaiting") return project.payoutStatus === "pending" && project.dueStatus !== "overdue" && !project.blockReason;
        if (activeTab === "overdue") return project.payoutStatus === "pending" && project.dueStatus === "overdue";
        if (activeTab === "blocked") return Boolean(project.blockReason);
        if (activeTab === "failed") return project.payoutStatus === "failed" || project.payoutStatus === "rejected";
        return false;
    });

    return <section className="admin-activity">
        <p className="muted-copy">FreelanceX does not initiate bank transfers. The 24-hour deadline is a processing target, not a guarantee of external transfer completion. Record the freelancer&apos;s net amount only after manually transferring it.</p>
        {success && <p className="success-message" role="status">{success}</p>}
        {error && <p className="form-error" role="alert">{error}<button className="button button-quiet" onClick={() => setRetry((current) => current + 1)} type="button">Retry</button></p>}

        <section className="dashboard-stat-grid" aria-label="Payout summary">
            <article className="dashboard-stat-card"><span>Pending payouts</span><strong>{summary.pendingCount}</strong></article>
            <article className="dashboard-stat-card"><span>Overdue payouts</span><strong>{overdueCount}</strong></article>
            <article className="dashboard-stat-card"><span>Blocked payouts</span><strong>{blockedCount}</strong></article>
            <article className="dashboard-stat-card"><span>Failed / rejected</span><strong>{failedCount}</strong></article>
            <article className="dashboard-stat-card"><span>Completed payouts</span><strong>{completedCount}</strong></article>
            <article className="dashboard-stat-card"><span>Total outstanding</span><strong>{money.format(summary.outstandingKobo / 100)}</strong></article>
            <article className="dashboard-stat-card"><span>Total completed</span><strong>{money.format(summary.completedKobo / 100)}</strong></article>
        </section>

        <nav aria-label="Payout sections" className="admin-activity-tabs">
            {([
                ["awaiting", "Awaiting Processing"],
                ["overdue", "Overdue"],
                ["blocked", "Blocked"],
                ["failed", "Failed / Rejected"],
                ["completed", "Completed History"],
            ] as const).map(([tab, label]) => <button aria-pressed={activeTab === tab} className={activeTab === tab ? "button button-primary" : "button button-quiet"} key={tab} onClick={() => setActiveTab(tab)} type="button">{label}</button>)}
        </nav>

        {activeTab !== "completed" && <section className="dashboard-panel">
            <div className="dashboard-table-heading"><span>{loading ? "Loading approved payouts..." : `${visibleProjects.length} ${activeTab === "awaiting" ? "awaiting processing" : activeTab} payouts`}</span></div>
            {!loading && visibleProjects.length === 0 ? <div className="dashboard-empty"><strong>No payouts in this section.</strong><p>Approved projects appear here when they match this status.</p></div>
                : <div className="dashboard-table">{visibleProjects.map((project) => <article className="dashboard-table-row admin-payout-eligible-row" key={project.taskId}>
                    <div>
                        <strong>{project.taskTitle}</strong>
                        <span>{project.freelancerName} · Client: {project.clientName}{project.bankName ? ` · ${project.bankName}` : ""}{project.accountName ? ` · ${project.accountName}` : ""}</span>
                        <small>Gross {money.format(project.grossAmountKobo / 100)} · Commission ({project.commissionRatePercent}%) {money.format(project.commissionAmountKobo / 100)} · Net due {money.format(project.amountKobo / 100)}</small>
                        <small>{project.maskedAccountNumber || "No verified account"} · Approved {formatDate(project.approvedAt)} · Due {formatDate(project.dueAt)} · {project.paymentVerifiedAt ? `Payment verified ${formatDate(project.paymentVerifiedAt)}` : "Payment verification unavailable"}</small>
                        <span className={`status-badge status-${project.dueStatus}`}>{project.dueStatus === "overdue" ? "Overdue" : "Due within 24 hours"}</span>
                        {project.blockReason && <p className="form-error" role="status">Blocked: {project.blockReason}</p>}
                        {project.failureReason && <p className="form-error">Previous failure: {project.failureReason}</p>}
                        {project.approvedDeliverables && <div className="admin-approved-deliverables">
                            <strong>Approved deliverables</strong>
                            <p>{project.approvedDeliverables.message}</p>
                            {project.approvedDeliverables.attachments.map((file) => <a href={file.url} key={file.url} rel="noreferrer" target="_blank">{file.fileName}</a>)}
                            {project.approvedDeliverables.links.map((link) => <a href={link} key={link} rel="noreferrer" target="_blank">{new URL(link).hostname}</a>)}
                        </div>}
                        {project.bankAccountStatus === "verified" && !project.blockReason && <form className="admin-payout-form" onSubmit={(event) => void recordPayout(event, project)}>
                            <label>Manual transfer reference<input className="filter-input" maxLength={160} required value={transferReferences[project.taskId] || ""} onChange={(event) => setTransferReferences((current) => ({ ...current, [project.taskId]: event.target.value }))} /></label>
                            <label>Receipt URL (optional)<input className="filter-input" maxLength={2048} type="url" value={receiptUrls[project.taskId] || ""} onChange={(event) => setReceiptUrls((current) => ({ ...current, [project.taskId]: event.target.value }))} /></label>
                            <label className="admin-payout-confirm"><input checked={confirmed[project.taskId] || false} type="checkbox" onChange={(event) => setConfirmed((current) => ({ ...current, [project.taskId]: event.target.checked }))} /> I confirm I manually transferred the net payout amount shown above.</label>
                            <button className="button button-primary" disabled={Boolean(submittingTask) || !confirmed[project.taskId] || !(transferReferences[project.taskId] || "").trim()} type="submit">{submittingTask === project.taskId ? "Recording..." : "Record completed net payout"}</button>
                        </form>}
                        <form className="admin-payout-form" onSubmit={(event) => void markPayoutFailed(event, project)}>
                            <label>Record transfer failure or rejection<input className="filter-input" maxLength={1000} value={failureReasons[project.taskId] || ""} onChange={(event) => setFailureReasons((current) => ({ ...current, [project.taskId]: event.target.value }))} placeholder="Reason for failure or rejection" /></label>
                            <button className="button button-quiet" disabled={Boolean(submittingTask) || !(failureReasons[project.taskId] || "").trim()} type="submit">{submittingTask === project.taskId ? "Saving..." : "Mark failed or rejected"}</button>
                        </form>
                    </div>
                </article>)}</div>}
        </section>}

        {activeTab === "completed" && <section aria-live="polite" className="dashboard-panel">
            <form className="admin-transaction-filters" onSubmit={searchPayouts}>
                <label>Search freelancer, project, or reference<input className="filter-input" maxLength={120} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Freelancer, project, or transfer reference" value={draftQuery} /></label>
                <label>Status<select className="filter-input" onChange={(event) => { setHistoryStatus(event.target.value); setPage(1); }} value={historyStatus}>
                    <option value="all">All statuses</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="rejected">Rejected</option><option value="completed">Completed</option>
                </select></label>
                <label>From<input className="filter-input" onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} type="date" value={dateFrom} /></label>
                <label>To<input className="filter-input" onChange={(event) => { setDateTo(event.target.value); setPage(1); }} type="date" value={dateTo} /></label>
                <label>Min amount (NGN)<input className="filter-input" min="0" onChange={(event) => { setMinAmount(event.target.value); setPage(1); }} step="0.01" type="number" value={minAmount} /></label>
                <label>Max amount (NGN)<input className="filter-input" min="0" onChange={(event) => { setMaxAmount(event.target.value); setPage(1); }} step="0.01" type="number" value={maxAmount} /></label>
                <button className="button button-primary" type="submit">Search</button>
            </form>
            <div className="dashboard-table-heading"><span>{loading ? "Loading payout history..." : `${pagination.total} payout records`}</span></div>
            {loading ? <div className="activity-loading-list" role="status">Loading payout history...</div>
                : payouts.length === 0 ? <div className="dashboard-empty"><strong>No payout records.</strong><p>Pending, failed, and completed payout records appear here.</p></div>
                    : <div className="dashboard-table">{payouts.map((payout) => <article className="dashboard-table-row" key={payout.id}>
                        <div>
                            <strong>{payout.freelancerName} · {payout.taskTitle}</strong>
                            <span>Project reference {payout.taskId} · {payout.bankName || "Bank account pending"}{payout.accountName ? ` · ${payout.accountName}` : ""}{payout.maskedAccountNumber ? ` · ${payout.maskedAccountNumber}` : ""}</span>
                            <small>Net {money.format(payout.amountKobo / 100)} {payout.currency} · Approved {formatDate(payout.approvedAt)} · Due {formatDate(payout.dueAt)}</small>
                            <small>{payout.grossAmountKobo !== null && payout.commissionAmountKobo !== null ? `Gross ${money.format(payout.grossAmountKobo / 100)} · Commission ${money.format(payout.commissionAmountKobo / 100)} · ` : ""}{payout.transferReference ? `Transfer reference: ${payout.transferReference} · ` : ""}{payout.adminName ? `Recorded by ${payout.adminName}` : payout.dueAt ? `Due ${formatDate(payout.dueAt)}` : ""}</small>
                            {payout.failureReason && <small>Failure: {payout.failureReason}</small>}
                            {payout.receiptUrl && <a href={payout.receiptUrl} rel="noreferrer" target="_blank">View transfer receipt</a>}
                        </div>
                        <div className="admin-transaction-status"><span className={`status-badge status-${payout.status}`}>{payout.status}</span>{payout.transferredAt && <time dateTime={payout.transferredAt}>{formatDate(payout.transferredAt)}</time>}</div>
                    </article>)}</div>}
        </section>}

        {activeTab === "completed" && !loading && pagination.totalPages > 1 && <nav aria-label="Payout history pages" className="admin-activity-pagination">
            <button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>}
    </section>;
}
