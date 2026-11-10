"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProjectSubmissions from "@/components/projects/ProjectSubmissions";
import ProjectDispute from "@/components/projects/ProjectDispute";
import ProjectManagementActions from "@/components/projects/ProjectManagementActions";
import { getProjectDeadlineCountdown } from "@/lib/project-deadline";

type Task = {
    id: string;
    title: string;
    description: string;
    amount: number;
    category: string;
    status: string;
    createdAt?: string;
    duration?: number;
    durationUnit?: "days" | "weeks";
    projectStartedAt?: string;
    deadlineAt?: string;
    funding?: { status: "funded"; amount: number; currency: string; verifiedAt?: string } | null;
    employer?: { name?: string } | null;
    freelancer?: { name?: string } | null;
};

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function FreelancerProjectPage() {
    const params = useParams<{ projectId: string }>();
    const [task, setTask] = useState<Task | null>(null);
    const [error, setError] = useState("");
    const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
    const [loadAttempt, setLoadAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        let requestPending = false;
        let hasLoadedProject = false;
        async function loadProject(showLoading = false) {
            if (requestPending) return;
            requestPending = true;
            if (showLoading) {
                setLoadState("loading");
                setError("");
            }
            try {
                const response = await fetch(`/api/tasks/${params.projectId}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { task?: Task; error?: string };
                if (!response.ok) throw new Error(result.error || "Project is unavailable.");
                if (!result.task) throw new Error("Project not found.");
                setTask(result.task);
                hasLoadedProject = true;
                setLoadState("ready");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                if (!hasLoadedProject) {
                    setError(loadError instanceof Error ? loadError.message : "Project is unavailable.");
                    setLoadState("error");
                }
            } finally {
                requestPending = false;
            }
        }
        void loadProject(true);
        const timer = window.setInterval(() => void loadProject(), 30_000);
        return () => {
            window.clearInterval(timer);
            controller.abort();
        };
    }, [loadAttempt, params.projectId]);

    const updateTaskStatus = useCallback((status: string) => {
        setTask((current) => current ? { ...current, status } : current);
    }, []);

    if (!task && loadState === "loading") return <main className="page-shell"><section className="auth-wrap"><div className="auth-card"><p className="muted-copy" role="status">Loading project details...</p></div></section></main>;
    if (!task) return <main className="page-shell"><section className="auth-wrap"><div className="auth-card"><p className="form-error" role="alert">{error || "Project not found."}</p><button className="button button-quiet" onClick={() => { setError(""); setLoadAttempt((attempt) => attempt + 1); }} type="button">Retry</button><Link className="button button-quiet" href="/freelancer/dashboard">Back to dashboard</Link></div></section></main>;

    const statusLabels: Record<string, string> = {
        funded: "Funded — work can begin",
        in_progress: "In Progress",
        submitted: "Submitted for Review",
        revision_requested: "Revision Requested",
        completed: "Completed",
    };
    const fundingConfirmed = ["funded", "in_progress", "submitted", "revision_requested", "completed", "disputed"].includes(task.status);

    return <main className="page-shell">
        <header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button button-quiet" href="/freelancer/dashboard">Back to dashboard</Link></header>
        <section className="detail-wrap">
            <div className="eyebrow">{task.category} project</div>
            <div className="detail-grid">
                <article className="detail-main">
                    <span className="tag">{statusLabels[task.status] || task.status.replace(/_/g, " ")}</span>
                    <h1>{task.title}</h1>
                    {task.status === "funded" && <p className="success-message" role="status">Funding is confirmed. You are eligible to begin work on this project.</p>}
                    <p className="detail-description">{task.description}</p>
                    <div className="dashboard-list">
                        <div className="dashboard-list-row"><div><strong>Client</strong><span>{task.employer?.name || "Project owner"}</span></div></div>
                        <div className="dashboard-list-row"><div><strong>Budget</strong><span>{money.format(task.amount)}</span></div></div>
                        {fundingConfirmed && <div className="dashboard-list-row"><div><strong>Funding</strong><span>Confirmed · {money.format(task.funding?.amount ?? task.amount)}{task.funding?.verifiedAt ? ` · ${new Date(task.funding.verifiedAt).toLocaleDateString()}` : ""}</span></div></div>}
                        {task.projectStartedAt && <div className="dashboard-list-row"><div><strong>Accepted on</strong><span>{new Date(task.projectStartedAt).toLocaleDateString()}</span></div></div>}
                        {task.deadlineAt && <div className="dashboard-list-row"><div><strong>Deadline</strong><span>{new Date(task.deadlineAt).toLocaleDateString()} · {task.status === "completed" ? "Completed" : getProjectDeadlineCountdown(task.deadlineAt)}</span></div></div>}
                    </div>
                </article>
                <aside className="detail-aside">
                    <h2>Project status</h2>
                    <p className="muted-copy">{statusLabels[task.status] || task.status.replace(/_/g, " ")}</p>
                    <Link className="button button-quiet" href="/freelancer/dashboard/contracts">Back to contracts</Link>
                </aside>
            </div>
            <ProjectSubmissions projectId={task.id} role="freelancer" projectStatus={task.status} onStatusChange={updateTaskStatus} />
            <ProjectManagementActions projectId={task.id} projectStatus={task.status} role="freelancer" onStatusChange={updateTaskStatus} />
            <ProjectDispute projectId={task.id} projectStatus={task.status} role="freelancer" />
        </section>
    </main>;
}
