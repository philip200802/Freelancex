"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type DashboardApplication = {
    _id?: string;
    id?: string;
    task: { _id?: string; id?: string; title: string; category: string; amount: number; status: string };
    employer?: { name?: string };
    freelancer?: { name?: string; email?: string };
    message: string;
    status: "pending" | "accepted" | "rejected";
    legacy?: boolean;
    createdAt: string;
};

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function ApplicationList({ role, statusFilter }: { role: "employer" | "freelancer" | "admin"; statusFilter?: DashboardApplication["status"] }) {
    const [applications, setApplications] = useState<DashboardApplication[]>([]);
    const [state, setState] = useState<"loading" | "success" | "error">("loading");
    const [retry, setRetry] = useState(0);
    const [error, setError] = useState("");
    const [updating, setUpdating] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const response = await fetch("/api/applications", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { applications?: DashboardApplication[]; error?: string };
                if (!response.ok) throw new Error(result.error || "Applications are unavailable.");
                if (!Array.isArray(result.applications)) throw new Error("The applications response was invalid.");
                if (controller.signal.aborted) return;
                setApplications(result.applications);
                setState("success");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Applications are unavailable.");
                setState("error");
            }
        }
        void load();
        return () => controller.abort();
    }, [retry]);

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
            const result = await response.json() as { error?: string; application?: { status: DashboardApplication["status"] } };
            if (!response.ok) throw new Error(result.error || "Application could not be updated.");
            setApplications((current) => current.map((item) => item._id === id || item.id === id
                ? { ...item, status: result.application?.status ?? (action === "accept" ? "accepted" : "rejected") }
                : item));
        } catch (reviewError) {
            setError(reviewError instanceof Error ? reviewError.message : "Application could not be updated.");
        } finally {
            setUpdating(null);
        }
    }

    if (state === "loading") return <div className="dashboard-empty" role="status">Loading applications...</div>;
    if (state === "error") return <div className="dashboard-empty" role="alert"><p>{error}</p><button className="button button-primary" onClick={() => { setState("loading"); setRetry((count) => count + 1); }}>Retry</button></div>;
    const visibleApplications = statusFilter ? applications.filter((application) => application.status === statusFilter) : applications;
    if (!visibleApplications.length) {
        const message = role === "employer"
            ? "No applications yet. Applications received for your jobs will appear here."
            : role === "freelancer"
                ? "You haven't applied to any jobs yet. Browse available opportunities and submit your first application."
                : "No application records are available.";
        const filteredMessage = statusFilter === "accepted" ? "No accepted applications yet." : statusFilter === "rejected" ? "No rejected applications." : message;
        return <div className="dashboard-empty"><strong>{statusFilter ? `No ${statusFilter} applications.` : "No applications yet."}</strong><p>{filteredMessage}</p>{role === "freelancer" && <Link className="button button-primary" href="/jobs">Find Jobs</Link>}</div>;
    }

    return <div className="dashboard-list">
        {error && <p className="form-error" role="alert">{error}</p>}
        {visibleApplications.map((application) => {
            const applicationId = application._id || application.id || `${application.task._id || application.task.id}-${application.freelancer?.name}`;
            const taskId = application.task._id || application.task.id;
            const participantName = role === "employer" ? application.freelancer?.name : application.employer?.name;
            return <article className="dashboard-list-row" key={applicationId}>
                <div>
                    <strong>{application.task.title}</strong>
                    <span>{participantName || application.task.category} &middot; {money.format(application.task.amount)}</span>
                    {application.message && <p>{application.message}</p>}
                    {taskId && <Link className="text-link" href={`/jobs/${taskId}`}>View job</Link>}
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
    </div>;
}
