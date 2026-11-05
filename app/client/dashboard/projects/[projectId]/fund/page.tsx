"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ProjectSummary = {
    id: string;
    title: string;
    amount: number;
    freelancer?: { name?: string } | null;
    employer?: { name?: string } | null;
    status: string;
};

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function ProjectFundingPage() {
    const params = useParams<{ projectId: string }>();
    const [project, setProject] = useState<ProjectSummary | null>(null);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const controller = new AbortController();
        async function loadProject() {
            try {
                const response = await fetch(`/api/tasks/${params.projectId}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { task?: ProjectSummary; error?: string };
                if (!response.ok) throw new Error(result.error || "Unable to load project.");
                if (!result.task) throw new Error("Project not found.");
                setProject(result.task);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Unable to load project.");
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        }
        void loadProject();
        return () => controller.abort();
    }, [params.projectId]);

    async function beginFunding() {
        if (!project) return;
        setError("");
        setIsSubmitting(true);
        try {
            const response = await fetch("/api/payments/initialize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: project.id }),
            });
            const result = await response.json() as { authorizationUrl?: string; error?: string };
            if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "Paystack checkout could not be initialized.");
            const authorizationUrl = new URL(result.authorizationUrl);
            if (authorizationUrl.protocol !== "https:" || !["checkout.paystack.com", "checkout-staging.paystack.com"].includes(authorizationUrl.hostname)) {
                throw new Error("Paystack returned an invalid checkout address.");
            }
            window.location.assign(authorizationUrl.toString());
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Paystack checkout could not be initialized.");
        } finally {
            setIsSubmitting(false);
        }
    }

    if (isLoading) return <main className="page-shell"><section className="auth-wrap"><div className="auth-card" role="status"><p className="muted-copy">Loading funding details...</p></div></section></main>;
    if (!project) return <main className="page-shell"><section className="auth-wrap"><div className="auth-card"><p className="form-error" role="alert">{error || "Project not found."}</p><Link className="button button-quiet" href="/client/dashboard">Return to dashboard</Link></div></section></main>;

    return <main className="page-shell">
        <header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button button-quiet" href={`/client/dashboard/projects/${project.id}`}>Back to project</Link></header>
        <section className="detail-wrap">
            <div className="eyebrow">Paystack checkout</div>
            <div className="detail-grid">
                <article className="detail-main">
                    <h1>Fund project</h1>
                    <p className="hero-copy">Continue to Paystack to pay for this project. FreelanceX marks the project as funded only after verifying the successful payment directly with Paystack.</p>
                    <div className="dashboard-list">
                        <div className="dashboard-list-row"><div><strong>Project</strong><span>{project.title}</span></div></div>
                        <div className="dashboard-list-row"><div><strong>Freelancer</strong><span>{project.freelancer?.name || "Assigned freelancer"}</span></div></div>
                        <div className="dashboard-list-row"><div><strong>Project payment</strong><span>{money.format(project.amount)}</span></div></div>
                    </div>
                </article>
                <aside className="detail-aside">
                    <h2>Funding summary</h2>
                    <p className="detail-budget">{money.format(project.amount)}</p>
                    <p className="muted-copy">The project status changes only after Paystack confirms the payment. Do not retry if checkout reports an uncertain result; check payment history or contact support.</p>
                    {error && <p className="form-error" role="alert">{error}</p>}
                    {project.status === "awaiting_funding"
                        ? <button className="button button-primary" disabled={isSubmitting} onClick={() => void beginFunding()} type="button">{isSubmitting ? "Connecting to Paystack..." : "Continue to Paystack"}</button>
                        : <p className="dashboard-empty"><strong>Payment is not available for this project.</strong><span>Project status: {project.status.replace("_", " ")}</span></p>}
                    <Link className="button button-quiet" href={`/client/dashboard/projects/${project.id}`}>Back to Project</Link>
                </aside>
            </div>
        </section>
    </main>;
}
