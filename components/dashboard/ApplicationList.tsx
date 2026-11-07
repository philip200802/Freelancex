"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type DashboardApplication = {
    _id?: string;
    id?: string;
    task: { _id?: string; id?: string; title: string; category: string; amount: number; status: string } | null;
    employer?: { id?: string | null; name?: string };
    freelancer?: { id?: string | null; name?: string };
    message: string;
    status: "pending" | "accepted" | "rejected";
    legacy?: boolean;
    createdAt: string;
};
type ApplicationPagination = { page: number; pageSize: number; totalCount: number; totalPages: number };

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function ApplicationList({ role, statusFilter }: { role: "employer" | "freelancer" | "admin"; statusFilter?: DashboardApplication["status"] }) {
    const router = useRouter();
    const [applications, setApplications] = useState<DashboardApplication[]>([]);
    const [state, setState] = useState<"loading" | "success" | "error">("loading");
    const [retry, setRetry] = useState(0);
    const [error, setError] = useState("");
    const [updating, setUpdating] = useState<string | null>(null);
    const [pagination, setPagination] = useState<ApplicationPagination>({ page: 1, pageSize: 10, totalCount: 0, totalPages: 0 });

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const params = new URLSearchParams({ page: String(pagination.page) });
                if (statusFilter) params.set("status", statusFilter);
                const response = await fetch(`/api/applications?${params.toString()}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { applications?: DashboardApplication[]; pagination?: ApplicationPagination; error?: string };
                if (!response.ok) throw new Error(result.error || "Applications are unavailable.");
                if (!Array.isArray(result.applications) || !result.pagination) throw new Error("The applications response was invalid.");
                if (controller.signal.aborted) return;
                setApplications(result.applications);
                setPagination(result.pagination);
                setState("success");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Applications are unavailable.");
                setState("error");
            }
        }
        void load();
        return () => controller.abort();
    }, [pagination.page, retry, statusFilter]);

    async function review(application: DashboardApplication, action: "accept" | "reject") {
        const id = application._id || application.id;
        if (!id) return;
        setUpdating(id);
        setError("");
        try {
            const response = await fetch(`/api/applications/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const result = await response.json() as { error?: string; redirectTo?: string; application?: { status: DashboardApplication["status"] } };
            if (!response.ok) throw new Error(result.error || "Application could not be updated.");
            if (action === "accept") {
                if (!result.redirectTo?.startsWith("/client/dashboard/projects/")) throw new Error("Application was accepted, but the project funding page could not be opened.");
                router.push(result.redirectTo);
                return;
            }
            setApplications((current) => current.map((item) => item._id === id || item.id === id
                ? { ...item, status: result.application?.status ?? "rejected" }
                : item));
        } catch (reviewError) {
            setError(reviewError instanceof Error ? reviewError.message : "Application could not be updated.");
        } finally {
            setUpdating(null);
        }
    }

    if (state === "loading") return <div className="dashboard-empty" role="status">Loading applications...</div>;
    if (state === "error") return <div className="dashboard-empty" role="alert"><p>{error}</p><button className="button button-primary" onClick={() => { setState("loading"); setRetry((count) => count + 1); }}>Retry</button></div>;
    const visibleApplications = applications;
    if (!visibleApplications.length) {
        const message = role === "employer"
            ? "No applications yet. Applications received for your jobs will appear here."
            : role === "freelancer"
                ? "You haven't applied to any jobs yet. Browse available opportunities and submit your first application."
                : "No application records are available.";
        const filteredMessage = statusFilter === "accepted" ? "No accepted applications yet." : statusFilter === "rejected" ? "No rejected applications." : message;
        return <div className="dashboard-empty"><strong>{statusFilter ? `No ${statusFilter} applications.` : "No applications yet."}</strong><p>{filteredMessage}</p>{role === "freelancer" && <Link className="button button-primary" href="/freelancer/dashboard/jobs">Find Jobs</Link>}</div>;
    }

    return <>
        <div className="dashboard-table-heading"><span>{pagination.totalCount} application{pagination.totalCount === 1 ? "" : "s"}</span></div>
        <div className="dashboard-list">
        {error && <p className="form-error" role="alert">{error}</p>}
        {visibleApplications.map((application) => {
            const task = application.task;
            const taskId = task?._id || task?.id;
            const applicationId = application._id || application.id || `${taskId || "removed-project"}-${application.freelancer?.name}`;
            const participant = role === "employer" ? application.freelancer : application.employer;
            const participantName = participant?.name;
            return <article className="dashboard-list-row" key={applicationId}>
                <div>
                    <strong>{task?.title || "Project no longer available"}</strong>
                    <span>{participantName || task?.category || "Project"}{task ? ` · ${money.format(task.amount)}` : ""}</span>
                    {participant?.id && <Link className="text-link" href={`/profiles/${participant.id}`}>{role === "employer" ? "View freelancer profile" : "View client profile"}</Link>}
                    {application.message && <p>{application.message}</p>}
                    {taskId && <Link className="text-link" href={role === "freelancer" ? `/freelancer/dashboard/jobs/${taskId}` : `/client/dashboard/projects/${taskId}`}>View job</Link>}
                </div>
                <div>
                    <span className={`status-badge status-${application.status}`}>{application.status}</span>
                    {role === "employer" && application.status === "pending" && <div className="dashboard-toolbar">
                        <button className="button button-primary" disabled={updating === applicationId} onClick={() => void review(application, "accept")}>Accept</button>
                        <button className="button button-quiet" disabled={updating === applicationId} onClick={() => void review(application, "reject")}>Reject</button>
                    </div>}
                </div>
            </article>;
        })}
        </div>
        {pagination.totalPages > 1 && <nav aria-label="Application result pages" className="job-pagination">
            <button className="button button-quiet" disabled={pagination.page <= 1} onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))} type="button">Previous</button>
            <span>Page {pagination.page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))} type="button">Next</button>
        </nav>}
    </>;
}
