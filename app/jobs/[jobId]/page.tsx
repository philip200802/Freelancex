"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Task = { title: string; description: string; amount: number; category: string; status: string; employer?: { name?: string; bio?: string }; };
const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function JobDetailsPage() {
    const params = useParams<{ jobId: string }>();
    const [task, setTask] = useState<Task | null>(null);
    const [error, setError] = useState("");
    const [isApplying, setIsApplying] = useState(false);
    const [applicationSent, setApplicationSent] = useState(false);

    useEffect(() => {
        fetch(`/api/tasks/${params.jobId}`)
            .then(async (response) => {
                const result = await response.json() as { task?: Task; error?: string };
                if (!response.ok) throw new Error(result.error || "Unable to load project.");
                setTask(result.task || null);
            })
            .catch((requestError: Error) => setError(requestError.message));
    }, [params.jobId]);

    async function applyToProject() {
        setError("");
        setIsApplying(true);
        try {
            const response = await fetch(`/api/tasks/${params.jobId}`, { method: "POST" });
            const result = await response.json() as { error?: string };
            if (!response.ok) throw new Error(result.error || "Unable to apply.");
            setApplicationSent(true);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Unable to apply.");
        } finally {
            setIsApplying(false);
        }
    }

    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button button-primary" href="/jobs">Back to projects</Link></header><section className="detail-wrap">{error && !task ? <div className="empty-state" role="alert">{error}</div> : task ? <><div className="eyebrow">{task.category} project</div><div className="detail-grid"><article className="detail-main"><span className="tag">{task.status}</span><h1>{task.title}</h1><p className="detail-description">{task.description}</p><h2>About the project</h2><p className="hero-copy">This project uses milestone-based payments so expectations stay clear from the first conversation through delivery.</p></article><aside className="detail-aside"><span className="filter-label">Project budget</span><strong className="detail-budget">{money.format(task.amount)}</strong><span className="filter-label">Posted by</span><strong>{task.employer?.name || "FreelanceX client"}</strong><p className="muted-copy">{task.employer?.bio || "A team looking for a thoughtful independent partner."}</p>{applicationSent ? <p className="success-message" role="status">Application sent. The employer will review your proposal.</p> : <button className="button button-primary" disabled={isApplying || task.status !== "open"} onClick={applyToProject}>{isApplying ? "Sending..." : task.status === "open" ? "Apply to project" : "Project unavailable"}</button>}{error && <p className="form-error" role="alert">{error}</p>}</aside></div></> : <div className="empty-state">Loading project...</div>}</section></main>;
}
