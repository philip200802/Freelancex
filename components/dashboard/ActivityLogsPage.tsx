"use client";

import { useEffect, useState } from "react";

type ActivityLog = {
    id: string;
    adminName: string;
    action: string;
    targetUserId: string | null;
    targetUserName: string | null;
    description: string;
    metadata: Record<string, unknown>;
    createdAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

function LoadingRows() {
    return <div aria-label="Loading activity logs" className="activity-loading-list" role="status">
        {Array.from({ length: 5 }, (_, index) => <div className="activity-loading-row" key={index}><span /><span /><span /></div>)}
        <span className="sr-only">Loading activity logs...</span>
    </div>;
}

export default function ActivityLogsPage() {
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [query, setQuery] = useState("");
    const [draftQuery, setDraftQuery] = useState("");
    const [action, setAction] = useState("all");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function loadLogs() {
            setLoading(true);
            setError("");
            try {
                const params = new URLSearchParams({
                    q: query,
                    action,
                    from,
                    to,
                    page: String(page),
                    limit: String(pagination.limit),
                });
                const response = await fetch(`/api/admin/activity-logs?${params}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { logs?: ActivityLog[]; pagination?: Pagination; error?: string };
                if (!response.ok || !Array.isArray(result.logs) || !result.pagination) {
                    throw new Error(result.error || "Activity logs could not be loaded.");
                }
                if (controller.signal.aborted) return;
                setLogs(result.logs);
                setPagination(result.pagination);
                if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Activity logs could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void loadLogs();
        return () => controller.abort();
    }, [action, from, page, pagination.limit, query, retry, to]);

    function search(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPage(1);
        setQuery(draftQuery.trim());
    }

    function clearFilters() {
        setDraftQuery("");
        setQuery("");
        setAction("all");
        setFrom("");
        setTo("");
        setPage(1);
    }

    return <section aria-label="Administrative activity" className="admin-activity">
        <form className="admin-activity-filters" onSubmit={search}>
            <label>Search<input className="filter-input" maxLength={120} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Admin, user, action" value={draftQuery} /></label>
            <label>Action<select className="filter-input" onChange={(event) => { setAction(event.target.value); setPage(1); }} value={action}>
                <option value="all">All actions</option>
                <option value="user.permanently_removed">User permanently removed</option>
                <option value="bank_account.revealed">Bank account revealed</option>
                <option value="payout.manual_recorded">Manual payout recorded</option>
            </select></label>
            <label>From<input className="filter-input" onChange={(event) => { setFrom(event.target.value); setPage(1); }} type="date" value={from} /></label>
            <label>To<input className="filter-input" onChange={(event) => { setTo(event.target.value); setPage(1); }} type="date" value={to} /></label>
            <div className="admin-activity-filter-actions">
                <button className="button button-primary" type="submit">Search</button>
                <button className="button button-quiet" onClick={clearFilters} type="button">Clear</button>
            </div>
        </form>

        <section aria-live="polite" className="dashboard-panel">
            <div className="dashboard-table-heading"><span>{loading ? "Loading activity..." : `${pagination.total} recorded actions`}</span></div>
            {loading ? <LoadingRows />
                : error ? <div className="admin-activity-error" role="alert"><p>{error}</p><button className="button button-quiet" onClick={() => setRetry((current) => current + 1)} type="button">Retry</button></div>
                    : logs.length === 0 ? <div className="dashboard-empty"><strong>No activity found.</strong><p>Successful supported admin actions will appear here.</p></div>
                        : <div className="dashboard-table">{logs.map((log) => <article className="dashboard-table-row admin-activity-row" key={log.id}>
                            <div>
                                <strong>{log.action === "user.permanently_removed" ? "User permanently removed" : log.action === "bank_account.revealed" ? "Bank account revealed" : log.action === "payout.manual_recorded" ? "Manual payout recorded" : log.action}</strong>
                                <span>{log.description}</span>
                                <small>Admin: {log.adminName}{log.targetUserName ? ` · User: ${log.targetUserName}` : ""}</small>
                            </div>
                            <time dateTime={log.createdAt}>{formatDate(log.createdAt)}</time>
                        </article>)}</div>}
        </section>

        {!loading && !error && pagination.totalPages > 1 && <nav aria-label="Activity log pages" className="admin-activity-pagination">
            <button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>}
    </section>;
}
