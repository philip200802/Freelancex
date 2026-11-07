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

    return <section className="admin-activity admin-payouts">
        <p className="muted-copy">FreelanceX does not initiate bank transfers. The 24-hour deadline is a processing target, not a guarantee of external transfer completion. Record the freelancer&apos;s net amount only after manually transferring it.</p>
        {success && <p className="success-message" role="status">{success}</p>}
        {error && <p className="form-error" role="alert">{error}<button className="button button-quiet" onClick={() => setRetry((current) => current + 1)} type="button">Retry</button></p>}

        <section className="dashboard-stat-grid admin-payout-summary-grid" aria-label="Payout summary">
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

        {activeTab !== "completed" && <section className="dashboard-panel admin-payout-list-panel">
            <div className="dashboard-table-heading"><span>{loading ? "Loading approved payouts..." : `${visibleProjects.length} ${activeTab === "awaiting" ? "awaiting processing" : activeTab} payouts`}</span></div>
            {!loading && visibleProjects.length === 0 ? <div className="dashboard-empty"><strong>No payouts in this section.</strong><p>Approved projects appear here when they match this status.</p></div>
                : <div className="admin-payout-review-list">{visibleProjects.map((project) => <article className="admin-payout-review-card" key={project.taskId}>
                    <header className="admin-payout-review-heading">
                        <div><span className="admin-payout-field-label">Freelancer</span><strong>{project.freelancerName}</strong></div>
                        <div className="admin-payout-review-status">
                            <span className={`status-badge status-${project.payoutStatus}`}>{project.payoutStatus}</span>
                            <span className={`status-badge status-${project.dueStatus}`}>{project.dueStatus === "overdue" ? "Overdue" : "Due within 24 hours"}</span>
                        </div>
                    </header>
                    <div className="admin-payout-review-grid">
                        <div className="admin-payout-review-cell"><span className="admin-payout-field-label">Project</span><strong>{project.taskTitle}</strong><small>Reference {project.taskId}</small><small>Client: {project.clientName}</small></div>
                        <div className="admin-payout-review-cell"><span className="admin-payout-field-label">Bank details</span><strong>{project.bankName || "Bank account unavailable"}</strong><span>{project.accountName || "Account name unavailable"}</span><small>{project.maskedAccountNumber || "No verified account"}</small></div>
                        <div className="admin-payout-review-cell admin-payout-amounts"><span className="admin-payout-field-label">Amount breakdown</span><span>Gross <strong>{money.format(project.grossAmountKobo / 100)}</strong></span><span>Commission ({project.commissionRatePercent}%) <strong>{money.format(project.commissionAmountKobo / 100)}</strong></span><span>Freelancer net <strong>{money.format(project.amountKobo / 100)}</strong></span></div>
                        <div className="admin-payout-review-cell"><span className="admin-payout-field-label">Dates</span><span>Approved <strong>{formatDate(project.approvedAt)}</strong></span><span>Due <strong>{formatDate(project.dueAt)}</strong></span><small>{project.paymentVerifiedAt ? `Payment verified ${formatDate(project.paymentVerifiedAt)}` : "Payment verification unavailable"}</small></div>
                    </div>
                    {project.blockReason && <p className="form-error" role="status">Blocked: {project.blockReason}</p>}
                    {project.failureReason && <p className="form-error">Previous failure: {project.failureReason}</p>}
                    {project.approvedDeliverables && <div className="admin-approved-deliverables">
                        <strong>Approved deliverables</strong>
                        <p>{project.approvedDeliverables.message}</p>
                        {project.approvedDeliverables.attachments.map((file) => <a href={file.url} key={file.url} rel="noreferrer" target="_blank">{file.fileName}</a>)}
                        {project.approvedDeliverables.links.map((link) => <a href={link} key={link} rel="noreferrer" target="_blank">{new URL(link).hostname}</a>)}
                    </div>}
                    <div className="admin-payout-review-actions">
                        {project.bankAccountStatus === "verified" && !project.blockReason && <form className="admin-payout-form" onSubmit={(event) => void recordPayout(event, project)}>
                            <label>Manual transfer reference<input className="filter-input" maxLength={160} required value={transferReferences[project.taskId] || ""} onChange={(event) => setTransferReferences((current) => ({ ...current, [project.taskId]: event.target.value }))} /></label>
                            <label>Receipt URL (optional)<input className="filter-input" maxLength={2048} type="url" value={receiptUrls[project.taskId] || ""} onChange={(event) => setReceiptUrls((current) => ({ ...current, [project.taskId]: event.target.value }))} /></label>
                            <label className="admin-payout-confirm"><input checked={confirmed[project.taskId] || false} type="checkbox" onChange={(event) => setConfirmed((current) => ({ ...current, [project.taskId]: event.target.checked }))} /> I confirm I manually transferred the net payout amount shown above.</label>
                            <button className="button button-primary" disabled={Boolean(submittingTask) || !confirmed[project.taskId] || !(transferReferences[project.taskId] || "").trim()} type="submit">{submittingTask === project.taskId ? "Recording..." : "Record completed net payout"}</button>
                        </form>}
                        <form className="admin-payout-form admin-payout-failure-form" onSubmit={(event) => void markPayoutFailed(event, project)}>
                            <label>Record transfer failure or rejection<input className="filter-input" maxLength={1000} value={failureReasons[project.taskId] || ""} onChange={(event) => setFailureReasons((current) => ({ ...current, [project.taskId]: event.target.value }))} placeholder="Reason for failure or rejection" /></label>
                            <button className="button button-quiet" disabled={Boolean(submittingTask) || !(failureReasons[project.taskId] || "").trim()} type="submit">{submittingTask === project.taskId ? "Saving..." : "Mark failed or rejected"}</button>
                        </form>
                    </div>
                </article>)}</div>}
        </section>}

        {activeTab === "completed" && <section aria-live="polite" className="dashboard-panel">
            <form className="admin-transaction-filters admin-payout-history-filters" onSubmit={searchPayouts}>
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
                    : <div className="admin-data-table-scroll" role="region" aria-label="Payout history" tabIndex={0}>
                        <table className="admin-data-table admin-payout-history-table">
                            <thead><tr>
                                <th scope="col">Freelancer</th>
                                <th scope="col">Project</th>
                                <th scope="col">Bank details</th>
                                <th scope="col">Amount breakdown</th>
                                <th scope="col">Dates</th>
                                <th scope="col">Transfer reference</th>
                                <th scope="col">Status</th>
                                <th scope="col">Actions</th>
                            </tr></thead>
                            <tbody>{payouts.map((payout) => <tr key={payout.id}>
                                <td><strong>{payout.freelancerName}</strong></td>
                                <td><div className="admin-table-cell-stack"><strong>{payout.taskTitle}</strong><span>Reference {payout.taskId}</span></div></td>
                                <td><div className="admin-table-cell-stack"><strong>{payout.bankName || "Bank account pending"}</strong><span>{payout.accountName || "Account name unavailable"}</span><small>{payout.maskedAccountNumber || "No account number"}</small></div></td>
                                <td><div className="admin-table-cell-stack admin-payout-amounts">
                                    <span>Gross <strong>{payout.grossAmountKobo === null ? "Unavailable" : money.format(payout.grossAmountKobo / 100)}</strong></span>
                                    <span>Commission <strong>{payout.commissionAmountKobo === null ? "Unavailable" : money.format(payout.commissionAmountKobo / 100)}</strong></span>
                                    <span>Freelancer net <strong>{money.format(payout.amountKobo / 100)}</strong></span>
                                </div></td>
                                <td><div className="admin-table-cell-stack"><span>Approved <strong>{formatDate(payout.approvedAt)}</strong></span><span>Due <strong>{formatDate(payout.dueAt)}</strong></span><span>Completed <strong>{formatDate(payout.transferredAt)}</strong></span></div></td>
                                <td className="admin-transfer-reference">{payout.transferReference || "Not provided"}</td>
                                <td><div className="admin-table-cell-stack"><span className={`status-badge status-${payout.status}`}>{payout.status}</span>
                                    {payout.adminName && <small>Recorded by {payout.adminName}</small>}
                                    {payout.failureReason && <small>Failure: {payout.failureReason}</small>}
                                </div></td>
                                <td className="admin-table-actions-cell">{payout.receiptUrl ? <a className="text-link" href={payout.receiptUrl} rel="noreferrer" target="_blank">View receipt</a> : <span>—</span>}</td>
                            </tr>)}</tbody>
                        </table>
                    </div>}
        </section>}

        {activeTab === "completed" && !loading && pagination.totalPages > 1 && <nav aria-label="Payout history pages" className="admin-activity-pagination">
            <button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>}
    </section>;
}
