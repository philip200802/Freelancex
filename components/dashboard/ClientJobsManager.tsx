"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getProjectDeadlineCountdown } from "@/lib/project-deadline";

type JobStatus = "open" | "pending_approval" | "awaiting_funding" | "funded" | "in_progress" | "revision_requested" | "submitted" | "completed" | "disputed" | "cancelled";
type Job = { id: string; title: string; description: string; category: string; amount: number; status: JobStatus; applications: number; createdAt: string; deliveryTime?: string | null; deadlineAt?: string | null };
type Listing = { jobs: Job[]; activeCount: number; totalCount: number; page: number; pageSize: number; totalPages: number };
type Filter = "all" | "open" | "funded" | "in_progress" | "revision_requested" | "completed" | "cancelled";

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const tabs: Array<{ value: Filter; label: string }> = [
    { value: "all", label: "All Active Jobs" },
    { value: "open", label: "Open" },
    { value: "funded", label: "Funded" },
    { value: "in_progress", label: "In Progress" },
    { value: "revision_requested", label: "Revision Requested" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled History" },
];
const statusLabels: Record<JobStatus, string> = {
    open: "Open",
    pending_approval: "Pending Approval",
    awaiting_funding: "Awaiting Funding",
    funded: "Funded",
    in_progress: "In Progress",
    revision_requested: "Revision Requested",
    submitted: "Submitted",
    completed: "Completed",
    disputed: "Disputed",
    cancelled: "Cancelled",
};

function statusClass(status: JobStatus) {
    return `job-status-${status.replace(/_/g, "-")}`;
}

export default function ClientJobsManager() {
    const [listing, setListing] = useState<Listing | null>(null);
    const [filter, setFilter] = useState<Filter>("all");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [error, setError] = useState("");
    const [toast, setToast] = useState("");
    const [toastIsError, setToastIsError] = useState(false);
    const [busyJob, setBusyJob] = useState("");
    const [editingJob, setEditingJob] = useState<Job | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    const loadJobs = useCallback(async (signal?: AbortSignal) => {
        setState("loading");
        setError("");
        const params = new URLSearchParams({ status: filter, page: String(page) });
        if (query.trim()) params.set("q", query.trim());
        try {
            const response = await fetch(`/api/client/jobs?${params}`, { cache: "no-store", signal });
            const result = await response.json() as Partial<Listing> & { error?: string };
            if (!response.ok) throw new Error(result.error || "Your jobs could not be loaded.");
            if (!Array.isArray(result.jobs) || typeof result.activeCount !== "number" || typeof result.totalPages !== "number") {
                throw new Error("The jobs response was invalid.");
            }
            if (signal?.aborted) return;
            setListing(result as Listing);
            setState("ready");
        } catch (loadError) {
            if (signal?.aborted) return;
            setError(loadError instanceof Error ? loadError.message : "Your jobs could not be loaded.");
            setState("error");
        }
    }, [filter, page, query]);

    useEffect(() => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => { void loadJobs(controller.signal); }, 0);
        return () => {
            window.clearTimeout(timeout);
            controller.abort();
        };
    }, [loadJobs]);

    useEffect(() => {
        if (!toast) return;
        const timeout = window.setTimeout(() => setToast(""), 3500);
        return () => window.clearTimeout(timeout);
    }, [toast]);

    function selectFilter(value: Filter) {
        setFilter(value);
        setPage(1);
    }

    function submitSearch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPage(1);
        void loadJobs();
    }

    async function deleteJob(jobItem: Job) {
        setBusyJob(jobItem.id);
        setToast("");
        setToastIsError(false);
        try {
            const response = await fetch(`/api/tasks/${jobItem.id}`, { method: "DELETE" });
            const result = await response.json() as { error?: string; archived?: boolean };
            if (!response.ok) throw new Error(result.error || "The job could not be deleted.");
            setListing((current) => current ? {
                ...current,
                jobs: current.jobs.filter((item) => item.id !== jobItem.id),
                activeCount: Math.max(0, current.activeCount - (jobItem.status === "cancelled" ? 0 : 1)),
                totalCount: Math.max(0, current.totalCount - 1),
            } : current);
            if (listing?.jobs.length === 1 && page > 1) setPage((current) => current - 1);
            setToast(result.archived ? "Job archived to preserve project history." : "Job deleted.");
        } catch (actionError) {
            setToastIsError(true);
            setToast(actionError instanceof Error ? actionError.message : "The job could not be deleted.");
        } finally {
            setBusyJob("");
        }
    }

    async function saveEdit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!editingJob) return;
        const job = editingJob;
        const formData = new FormData(event.currentTarget);
        setIsSavingEdit(true);
        setToast("");
        setToastIsError(false);
        try {
            const response = await fetch(`/api/tasks/${job.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: formData.get("title"),
                    description: formData.get("description"),
                    category: formData.get("category"),
                    amount: formData.get("amount"),
                }),
            });
            const result = await response.json() as { task?: { title: string; description: string; category: string; amount: number }; error?: string };
            if (!response.ok || !result.task) throw new Error(result.error || "The job could not be updated.");
            setEditingJob(null);
            setToast("Job updated.");
            await loadJobs();
        } catch (actionError) {
            setToastIsError(true);
            setToast(actionError instanceof Error ? actionError.message : "The job could not be updated.");
        } finally {
            setIsSavingEdit(false);
        }
    }

    return <section className="client-jobs-dashboard">
        <div className="client-jobs-header">
            <div className="client-jobs-header-actions">
                <span className="client-jobs-count"><strong>{listing?.activeCount ?? "—"}</strong> active jobs</span>
                <Link className="button button-primary" href="/client/dashboard/post-job">Create Job</Link>
            </div>
        </div>
        <div className="client-jobs-controls">
            <div className="client-jobs-tabs" aria-label="Filter jobs">
                {tabs.map((tab) => <button
                    aria-pressed={filter === tab.value}
                    className={filter === tab.value ? "is-selected" : ""}
                    key={tab.value}
                    onClick={() => selectFilter(tab.value)}
                    type="button"
                >{tab.label}</button>)}
            </div>
            <form className="client-jobs-search" onSubmit={submitSearch}>
                <label className="visually-hidden" htmlFor="client-jobs-search">Search job titles</label>
                <input id="client-jobs-search" className="filter-input" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search job titles" />
                <button className="button button-quiet" type="submit">Search</button>
            </form>
        </div>
        {toast && <div className={`client-jobs-toast${toastIsError ? " is-error" : " is-success"}`} role={toastIsError ? "alert" : "status"}>{toast}</div>}
        <section className="dashboard-panel client-jobs-panel" aria-label="Job postings">
            {listing && <div className="client-jobs-table-heading">
                <strong>{listing.totalCount} {filter === "cancelled" ? "cancelled" : "active"} {listing.totalCount === 1 ? "job" : "jobs"}</strong>
                <span>{filter === "cancelled" ? "Historical postings are retained." : "Cancelled postings are shown in Cancelled History."}</span>
            </div>}
            {state === "loading" && <div className="dashboard-empty" role="status">Loading your jobs...</div>}
            {state === "error" && <div className="dashboard-empty" role="alert">{error}<button className="button button-quiet" onClick={() => void loadJobs()} type="button">Try again</button></div>}
            {state === "ready" && listing?.jobs.length === 0 && <div className="dashboard-empty"><strong>{query ? "No matching jobs." : filter === "cancelled" ? "No cancelled jobs." : "No jobs in this filter."}</strong><p>{query ? "Try a different title search." : filter === "all" ? "Create your first job posting to start receiving applications." : "Jobs with this status will appear here."}</p>{filter === "all" && <Link className="button button-primary" href="/client/dashboard/post-job">Create Job</Link>}</div>}
            {state === "ready" && !!listing?.jobs.length && <div className="client-jobs-table-wrap">
                <table className="client-jobs-table">
                    <thead><tr><th scope="col">Job</th><th scope="col">Category</th><th scope="col">Budget</th><th scope="col">Status</th><th scope="col">Applications</th><th scope="col">Date</th><th scope="col">Actions</th></tr></thead>
                    <tbody>{listing.jobs.map((job) => <tr key={job.id}>
                        <td data-label="Job"><Link className="client-job-title" href={`/client/dashboard/projects/${job.id}`}>{job.title}</Link></td>
                        <td data-label="Category">{job.category}</td>
                        <td data-label="Budget" className="client-job-budget">{money.format(job.amount)}</td>
                        <td data-label="Status"><span className={`status-badge job-status-badge ${statusClass(job.status)}`}>{statusLabels[job.status] || "Project"}</span>{job.deliveryTime && <small>{job.deliveryTime}</small>}{job.deadlineAt && <small>Deadline: {job.status === "completed" ? "Completed" : getProjectDeadlineCountdown(job.deadlineAt)}</small>}</td>
                        <td data-label="Applications">{job.applications}</td>
                        <td data-label="Date"><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</time></td>
                        <td data-label="Actions"><div className="client-job-actions">
                            <Link className="client-job-action" href={`/client/dashboard/projects/${job.id}`}>{["funded", "awaiting_funding", "in_progress", "revision_requested", "submitted", "completed", "disputed"].includes(job.status) ? "View Project" : "View Job"}</Link>
                            {["open", "pending_approval"].includes(job.status) && <Link className="client-job-action" href="/client/dashboard/applications">View Applications</Link>}
                            {job.status === "open" && job.applications === 0 && <button className="client-job-action" onClick={() => setEditingJob(job)} type="button">Edit Job</button>}
                            {["open", "pending_approval"].includes(job.status) && <button className="client-job-action is-danger" disabled={busyJob === job.id} onClick={() => void deleteJob(job)} type="button">{busyJob === job.id ? "Deleting..." : "Delete Job"}</button>}
                        </div></td>
                    </tr>)}</tbody>
                </table>
                <div className="client-jobs-cards">{listing.jobs.map((job) => <article className="client-job-card" key={job.id}>
                    <div className="client-job-card-heading"><Link className="client-job-title" href={`/client/dashboard/projects/${job.id}`}>{job.title}</Link><span className={`status-badge job-status-badge ${statusClass(job.status)}`}>{statusLabels[job.status] || "Project"}</span></div>
                    <div className="client-job-card-details"><span><small>Category</small>{job.category}</span><span><small>Budget</small>{money.format(job.amount)}</span><span><small>Duration</small>{job.deliveryTime || "—"}</span><span><small>Applications</small>{job.applications}</span><span><small>Posted</small><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</time></span>{job.deadlineAt && <span><small>Deadline</small>{job.status === "completed" ? "Completed" : getProjectDeadlineCountdown(job.deadlineAt)}</span>}</div>
                    <div className="client-job-actions">
                        <Link className="client-job-action" href={`/client/dashboard/projects/${job.id}`}>{["funded", "awaiting_funding", "in_progress", "revision_requested", "submitted", "completed", "disputed"].includes(job.status) ? "View Project" : "View Job"}</Link>
                        {["open", "pending_approval"].includes(job.status) && <Link className="client-job-action" href="/client/dashboard/applications">View Applications</Link>}
                        {job.status === "open" && job.applications === 0 && <button className="client-job-action" onClick={() => setEditingJob(job)} type="button">Edit Job</button>}
                        {["open", "pending_approval"].includes(job.status) && <button className="client-job-action is-danger" disabled={busyJob === job.id} onClick={() => void deleteJob(job)} type="button">{busyJob === job.id ? "Deleting..." : "Delete Job"}</button>}
                    </div>
                </article>)}</div>
            </div>}
            {!!listing && listing.totalPages > 1 && <nav className="client-jobs-pagination" aria-label="Job listing pages">
                <button className="button button-quiet" disabled={page <= 1 || state === "loading"} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
                <span>Page {listing.page} of {listing.totalPages}</span>
                <button className="button button-quiet" disabled={page >= listing.totalPages || state === "loading"} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
            </nav>}
        </section>
        {editingJob && <div className="client-job-delete-backdrop" role="presentation">
            <form aria-labelledby="client-job-edit-title" aria-modal="true" className="client-job-edit-dialog" onSubmit={saveEdit} role="dialog">
                <h2 id="client-job-edit-title">Edit Job</h2>
                <label>Job title<input className="filter-input" defaultValue={editingJob.title} maxLength={180} name="title" required /></label>
                <label>Description<textarea className="filter-input dashboard-textarea" defaultValue={editingJob.description} maxLength={5000} name="description" required /></label>
                <div className="client-job-edit-row">
                    <label>Category<select className="filter-input" defaultValue={editingJob.category} name="category"><option>Development</option><option>Design</option><option>Writing</option><option>Marketing</option></select></label>
                    <label>Budget (NGN)<input className="filter-input" defaultValue={editingJob.amount} min="1" name="amount" required type="number" /></label>
                </div>
                {toastIsError && toast && <p className="form-error" role="alert">{toast}</p>}
                <div className="client-job-delete-actions">
                    <button className="button button-quiet" disabled={isSavingEdit} onClick={() => setEditingJob(null)} type="button">Keep Job</button>
                    <button className="button button-primary" disabled={isSavingEdit} type="submit">{isSavingEdit ? "Saving..." : "Save Changes"}</button>
                </div>
            </form>
        </div>}
    </section>;
}
