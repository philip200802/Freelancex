"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Task = { id: string; title: string; description: string; amount: number; category: string; status: string; employer?: { id?: string | null; name?: string } | null };
const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function JobDetailsView({ jobId, backHref = "/jobs", emptyHref = "/jobs" }: { jobId: string; backHref?: string; emptyHref?: string }) {
    const [task, setTask] = useState<Task | null>(null);
    const [error, setError] = useState("");
    const [loadState, setLoadState] = useState<"loading" | "success" | "error" | "not-found">("loading");
    const [isApplying, setIsApplying] = useState(false);
    const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const [applicationMessage, setApplicationMessage] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function fetchTask() {
            try {
                const response = await fetch(`/api/tasks/${jobId}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { task?: Task; applicationStatus?: string | null; error?: string };
                if (controller.signal.aborted) return;
                if (response.status === 404) {
                    setTask(null);
                    setLoadState("not-found");
                    return;
                }
                if (!response.ok) throw new Error(result.error || "Unable to load project.");
                if (!result.task) {
                    setTask(null);
                    setLoadState("not-found");
                    return;
                }
                setTask(result.task);
                setApplicationStatus(result.applicationStatus || null);
                setLoadState("success");
            } catch (requestError) {
                if (controller.signal.aborted) return;
                setError(requestError instanceof Error ? requestError.message : "Unable to load project.");
                setLoadState("error");
            }
        }

        void fetchTask();
        return () => controller.abort();
    }, [jobId, retryCount]);

    async function applyToProject() {
        setError("");
        setIsApplying(true);
        try {
            const response = await fetch(`/api/tasks/${jobId}`, {
                method: "POST",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: applicationMessage }),
            });
            const result = await response.json() as { application?: { status: string }; applicationStatus?: string; error?: string };
            if (!response.ok) throw new Error(result.error || "Unable to apply.");
            const status = result.applicationStatus || result.application?.status || "pending";
            setApplicationStatus(status);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Unable to apply.");
        } finally {
            setIsApplying(false);
        }
    }

    return <main className="page-shell">
        <header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button button-primary" href={backHref}>Back to projects</Link></header>
        <section className="detail-wrap">
            {loadState === "loading" && <div className="empty-state" role="status">Loading project...</div>}
            {loadState === "not-found" && <div className="empty-state"><strong>Project not found.</strong><p>This project is unavailable or is no longer listed.</p><Link className="button button-primary" href={emptyHref}>Browse available jobs</Link></div>}
            {loadState === "error" && <div className="empty-state" role="alert"><p>{error}</p><button className="button button-primary" onClick={() => { setError(""); setLoadState("loading"); setRetryCount((count) => count + 1); }}>Retry</button></div>}
            {loadState === "success" && task && <><div className="eyebrow">{task.category} project</div><div className="detail-grid">
                <article className="detail-main"><span className="tag">{task.status.replace("_", " ")}</span><h1>{task.title}</h1><p className="detail-description">{task.description}</p><h2>About the project</h2><p className="hero-copy">This project uses milestone-based payments so expectations stay clear from the first conversation through delivery.</p></article>
                <aside className="detail-aside"><span className="filter-label">Project budget</span><strong className="detail-budget">{money.format(task.amount)}</strong><span className="filter-label">Posted by</span><strong>{task.employer?.name || "FreelanceX client"}</strong>{task.employer?.id && <Link className="button button-quiet" href={`/profiles/${task.employer.id}`}>View client profile</Link>}
                    {applicationStatus ? <p className="success-message" role="status">{applicationStatus === "pending" ? "Application submitted. Waiting for employer review." : `Application ${applicationStatus}.`}</p> : task.status === "open" ? <><label className="filter-label" htmlFor="application-message">Application message (optional)</label><textarea className="filter-input dashboard-textarea" id="application-message" maxLength={5000} value={applicationMessage} onChange={(event) => setApplicationMessage(event.target.value)} placeholder="Introduce yourself and explain why you are a good fit." /><button className="button button-primary" disabled={isApplying} onClick={applyToProject}>{isApplying ? "Sending..." : "Apply to project"}</button></> : <button className="button button-primary" disabled>Project unavailable</button>}
                    {error && <p className="form-error" role="alert">{error}</p>}
                </aside>
            </div></>}
        </section>
    </main>;
}
