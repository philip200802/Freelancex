"use client";

import { FormEvent, useEffect, useState } from "react";

type EligibleProject = {
    taskId: string;
    taskTitle: string;
    freelancerName: string;
    amount: number;
    currency: string;
    bankName: string;
    accountName: string;
    maskedAccountNumber: string;
    paymentVerifiedAt: string | null;
    approvedDeliverables: {
        message: string;
        links: string[];
        attachments: Array<{ fileName: string; url: string; fileType: string; fileSize: number }>;
        reviewedAt: string | null;
    };
};
type Payout = {
    id: string;
    taskId: string;
    freelancerName: string;
    bankName: string;
    accountName: string;
    maskedAccountNumber: string;
    amount: number;
    currency: string;
    transferReference: string;
    transferredAt: string;
    receiptUrl: string | null;
    adminName: string;
    status: "completed";
};
type Pagination = { page: number; limit: number; total: number; totalPages: number };

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });
function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export default function AdminPayoutsPage() {
    const [payouts, setPayouts] = useState<Payout[]>([]);
    const [eligibleProjects, setEligibleProjects] = useState<EligibleProject[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [transferReferences, setTransferReferences] = useState<Record<string, string>>({});
    const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
    const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
    const [submittingTask, setSubmittingTask] = useState("");
    const [success, setSuccess] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function loadPayouts() {
            setLoading(true);
            setError("");
            try {
                const params = new URLSearchParams({ page: String(page), limit: String(pagination.limit) });
                const response = await fetch(`/api/admin/payouts?${params}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { payouts?: Payout[]; eligibleProjects?: EligibleProject[]; pagination?: Pagination; error?: string };
                if (!response.ok || !Array.isArray(result.payouts) || !Array.isArray(result.eligibleProjects) || !result.pagination) {
                    throw new Error(result.error || "Payout records could not be loaded.");
                }
                if (controller.signal.aborted) return;
                setPayouts(result.payouts);
                setEligibleProjects(result.eligibleProjects);
                setPagination(result.pagination);
                if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Payout records could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void loadPayouts();
        return () => controller.abort();
    }, [page, pagination.limit, retry]);

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

    return <section className="admin-activity">
        <p className="muted-copy">FreelanceX does not initiate transfers. Record a payout only after you have manually transferred the approved project amount and confirmed the Paystack payment.</p>
        {success && <p className="success-message" role="status">{success}</p>}
        {error && <p className="form-error" role="alert">{error}<button className="button button-quiet" onClick={() => setRetry((current) => current + 1)} type="button">Retry</button></p>}

        <section className="dashboard-panel">
            <div className="dashboard-table-heading"><span>{loading ? "Loading eligible projects..." : `${eligibleProjects.length} eligible projects (up to 500 reviewed)`}</span></div>
            {!loading && eligibleProjects.length === 0 ? <div className="dashboard-empty"><strong>No eligible payouts.</strong><p>Projects must be approved and completed, have a verified successful Paystack payment, and belong to a freelancer with verified bank details.</p></div>
                : <div className="dashboard-table">{eligibleProjects.map((project) => <article className="dashboard-table-row admin-payout-eligible-row" key={project.taskId}>
                    <div>
                        <strong>{project.taskTitle}</strong>
                        <span>{project.freelancerName} · {project.bankName} · {project.accountName}</span>
                        <small>{project.maskedAccountNumber} · {money.format(project.amount)} · Payment verified {project.paymentVerifiedAt ? formatDate(project.paymentVerifiedAt) : "date unavailable"}</small>
                        <div className="admin-approved-deliverables">
                            <strong>Approved deliverables</strong>
                            <p>{project.approvedDeliverables.message}</p>
                            {project.approvedDeliverables.attachments.map((file) => <a href={file.url} key={file.url} rel="noreferrer" target="_blank">{file.fileName}</a>)}
                            {project.approvedDeliverables.links.map((link) => <a href={link} key={link} rel="noreferrer" target="_blank">{new URL(link).hostname}</a>)}
                        </div>
                        <form className="admin-payout-form" onSubmit={(event) => void recordPayout(event, project)}>
                            <label>Manual transfer reference<input className="filter-input" maxLength={160} required value={transferReferences[project.taskId] || ""} onChange={(event) => setTransferReferences((current) => ({ ...current, [project.taskId]: event.target.value }))} /></label>
                            <label>Receipt URL (optional)<input className="filter-input" maxLength={2048} type="url" value={receiptUrls[project.taskId] || ""} onChange={(event) => setReceiptUrls((current) => ({ ...current, [project.taskId]: event.target.value }))} /></label>
                            <label className="admin-payout-confirm"><input checked={confirmed[project.taskId] || false} type="checkbox" onChange={(event) => setConfirmed((current) => ({ ...current, [project.taskId]: event.target.checked }))} /> I confirm this bank transfer has already been completed.</label>
                            <button className="button button-primary" disabled={Boolean(submittingTask) || !confirmed[project.taskId] || !(transferReferences[project.taskId] || "").trim()} type="submit">{submittingTask === project.taskId ? "Recording..." : "Record completed payout"}</button>
                        </form>
                    </div>
                </article>)}</div>}
        </section>

        <section aria-live="polite" className="dashboard-panel">
            <div className="dashboard-table-heading"><span>{loading ? "Loading payout history..." : `${pagination.total} immutable payout records`}</span></div>
            {loading ? <div className="activity-loading-list" role="status">Loading payout history...</div>
                : payouts.length === 0 ? <div className="dashboard-empty"><strong>No manual payouts recorded.</strong><p>Completed transfers appear here as immutable payout history.</p></div>
                    : <div className="dashboard-table">{payouts.map((payout) => <article className="dashboard-table-row" key={payout.id}>
                        <div>
                            <strong>{payout.freelancerName} · {money.format(payout.amount)}</strong>
                            <span>{payout.bankName} · {payout.accountName} · {payout.maskedAccountNumber}</span>
                            <small>Transfer reference: {payout.transferReference} · Recorded by {payout.adminName}</small>
                            {payout.receiptUrl && <a href={payout.receiptUrl} rel="noreferrer" target="_blank">View transfer receipt</a>}
                        </div>
                        <div className="admin-transaction-status"><span className="status-badge status-completed">completed</span><time dateTime={payout.transferredAt}>{formatDate(payout.transferredAt)}</time></div>
                    </article>)}</div>}
        </section>

        {!loading && pagination.totalPages > 1 && <nav aria-label="Payout history pages" className="admin-activity-pagination">
            <button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>}
    </section>;
}
