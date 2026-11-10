"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import ProjectSubmissions from "@/components/projects/ProjectSubmissions";
import ProjectDispute from "@/components/projects/ProjectDispute";
import ProjectManagementActions from "@/components/projects/ProjectManagementActions";
import { formatProjectDuration, getProjectDeadlineStatus } from "@/lib/project-deadline";

type Task = {
    id: string;
    title: string;
    description: string;
    amount: number;
    category: string;
    status: string;
    duration?: number;
    durationUnit?: "days" | "weeks";
    projectStartedAt?: string;
    deadlineAt?: string;
    funding?: { status: "funded"; amount: number; currency: string; verifiedAt?: string } | null;
    employer?: { name?: string } | null;
    freelancer?: { name?: string } | null;
};

type Review = {
    id: string;
    rating: number;
    comment: string;
    createdAt: string;
    client?: { name?: string } | null;
};

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

function getPaymentNotice(paymentState: string | null) {
    if (paymentState === "success") return "Paystack verified your payment and the project is funded.";
    if (paymentState === "pending") return "Payment is still processing. The project will update after Paystack confirms it.";
    if (paymentState === "failed") return "Paystack did not complete the payment. You can try again.";
    if (paymentState === "needs-review") return "Payment was verified, but the project could not be activated. The platform administrator must review this transaction.";
    if (paymentState === "verification-error") return "Payment verification is temporarily unavailable. Check your payment history before retrying.";
    return "";
}

export default function ClientProjectPage() {
    const params = useParams<{ projectId: string }>();
    const router = useRouter();
    const [task, setTask] = useState<Task | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [success, setSuccess] = useState("");
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState("");
    const [isReviewReady, setIsReviewReady] = useState(false);
    const [paymentNotice, setPaymentNotice] = useState("");
    const [hasSubmissionHistory, setHasSubmissionHistory] = useState(false);
    const [submissionHistoryLoaded, setSubmissionHistoryLoaded] = useState(false);
    const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
    const [toast, setToast] = useState("");
    const [toastIsError, setToastIsError] = useState(false);

    useEffect(() => {
        const paymentState = new URLSearchParams(window.location.search).get("payment");
        const controller = new AbortController();
        async function loadProject() {
            try {
                const taskResponse = await fetch(`/api/tasks/${params.projectId}`, { cache: "no-store", signal: controller.signal });
                const taskResult = await taskResponse.json() as { task?: Task; error?: string };
                if (!taskResponse.ok) throw new Error(taskResult.error || "Project is unavailable.");
                if (!taskResult.task) throw new Error("Project not found.");
                setTask(taskResult.task);
                setPaymentNotice(getPaymentNotice(paymentState));
                const reviewResponse = await fetch(`/api/reviews?projectId=${encodeURIComponent(params.projectId)}`, { cache: "no-store", signal: controller.signal });
                const reviewResult = await reviewResponse.json() as { reviews?: Review[]; error?: string };
                if (reviewResponse.ok && Array.isArray(reviewResult.reviews)) setReviews(reviewResult.reviews);
                setIsReviewReady(taskResult.task.status === "completed");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Project is unavailable.");
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        }
        void loadProject();
        return () => controller.abort();
    }, [loadAttempt, params.projectId]);

    useEffect(() => {
        if (!toast) return;
        const timeout = window.setTimeout(() => setToast(""), 5000);
        return () => window.clearTimeout(timeout);
    }, [toast]);

    useEffect(() => {
        if (!isCancelDialogOpen || isSubmitting) return;
        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setIsCancelDialogOpen(false);
        }
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [isCancelDialogOpen, isSubmitting]);

    async function performAction(action: "complete" | "cancel") {
        if (!task || isSubmitting) return;
        setIsSubmitting(true);
        setError("");
        setSuccess("");
        try {
            const response = await fetch(`/api/tasks/${task.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const result = await response.json() as { message?: string; error?: string; task?: { status: string } };
            if (!response.ok) throw new Error(result.error || "The project action could not be completed.");
            setSuccess(result.message || "Project action completed.");
            if (result.task?.status) {
                setTask((current) => current ? { ...current, status: result.task!.status } : current);
                setIsReviewReady(result.task.status === "completed");
            }
            if (action === "cancel") {
                setIsCancelDialogOpen(false);
                setToastIsError(false);
                setToast(result.message || "Job posting cancelled.");
            }
            router.refresh();
        } catch (requestError) {
            const message = requestError instanceof Error ? requestError.message : "The project action could not be completed.";
            setError(message);
            if (action === "cancel") {
                setToastIsError(true);
                setToast(message);
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    const updateTaskStatus = useCallback((status: string) => {
        setTask((current) => current ? { ...current, status } : current);
        setIsReviewReady(status === "completed");
    }, []);

    const handleSubmissionHistory = useCallback((hasSubmissions: boolean) => {
        setHasSubmissionHistory(hasSubmissions);
        setSubmissionHistoryLoaded(true);
    }, []);

    async function submitReview(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!task) return;
        setError("");
        setSuccess("");
        try {
            const response = await fetch("/api/reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: task.id, rating, comment })
            });
            const result = await response.json() as { review?: Review; error?: string; message?: string };
            if (!response.ok) throw new Error(result.error || "Review could not be submitted.");
            setSuccess(result.message || "Review submitted successfully.");
            setComment("");
            const reviewResponse = await fetch(`/api/reviews?projectId=${encodeURIComponent(task.id)}`);
            const reviewResult = await reviewResponse.json() as { reviews?: Review[] };
            if (reviewResponse.ok && Array.isArray(reviewResult.reviews)) setReviews(reviewResult.reviews);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Review could not be submitted.");
        }
    }

    if (!task && isLoading) return <main className="page-shell"><section className="auth-wrap"><div className="auth-card" role="status"><p className="muted-copy">Loading project details...</p></div></section></main>;
    if (!task) return <main className="page-shell"><section className="auth-wrap"><div className="auth-card"><p className="form-error" role="alert">{error || "Project not found."}</p><button className="button button-quiet" onClick={() => { setError(""); setIsLoading(true); setLoadAttempt((attempt) => attempt + 1); }} type="button">Retry</button><Link className="button button-quiet" href="/client/dashboard">Back to dashboard</Link></div></section></main>;

    const statusLabel = task.status === "submitted"
        ? "Submitted for Review"
        : task.status === "revision_requested"
            ? "Revision Requested"
            : task.status === "cancelled"
                ? "Cancelled"
                : task.status === "disputed"
                    ? "Disputed"
            : task.status.replace(/_/g, " ");

    return <main className="page-shell">
        <header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button button-quiet" href="/client/dashboard">Back to dashboard</Link></header>
        <section className="detail-wrap">
            <div className="eyebrow">{task.category} project</div>
            <div className="detail-grid">
                <article className="detail-main">
                    <span className="tag">{statusLabel}</span>
                    <h1>{task.title}</h1>
                    <p className="detail-description">{task.description}</p>
                    {paymentNotice && <p className={paymentNotice.startsWith("Paystack verified") ? "success-message" : "muted-copy"} role="status">{paymentNotice}</p>}
                    <div className="dashboard-list">
                        <div className="dashboard-list-row"><div><strong>Client</strong><span>{task.employer?.name || "Project owner"}</span></div></div>
                        <div className="dashboard-list-row"><div><strong>Freelancer</strong><span>{task.freelancer?.name || "Awaiting assignment"}</span></div></div>
                        {task.duration && task.durationUnit && <div className="dashboard-list-row"><div><strong>Delivery time</strong><span>{formatProjectDuration(task.duration, task.durationUnit)}</span></div></div>}
                        {task.projectStartedAt && <div className="dashboard-list-row"><div><strong>Accepted on</strong><span>{new Date(task.projectStartedAt).toLocaleDateString()}</span></div></div>}
                        {task.deadlineAt && <div className="dashboard-list-row"><div><strong>Deadline</strong><span>{new Date(task.deadlineAt).toLocaleDateString()} · {getProjectDeadlineStatus(task.deadlineAt, task.status)}</span></div></div>}
                        {task.freelancer && <div className="dashboard-list-row"><div><strong>Work status</strong><span>{statusLabel}</span></div></div>}
                        {task.funding && <div className="dashboard-list-row"><div><strong>Funding</strong><span>Confirmed · {money.format(task.funding.amount)}{task.funding.verifiedAt ? ` · ${new Date(task.funding.verifiedAt).toLocaleDateString()}` : ""}</span></div></div>}
                    </div>
                </article>
                <aside className="detail-aside">
                    <span className="filter-label">Project budget</span>
                    <strong className="detail-budget">{money.format(task.amount)}</strong>
                    {success && <p className="success-message" role="status">{success}</p>}
                    {error && <p className="form-error" role="alert">{error}</p>}
                    {task.status === "awaiting_funding" && <Link className="button button-primary" href={`/client/dashboard/projects/${task.id}/fund`}>Fund project with Paystack</Link>}
                    {(task.status === "open" || task.status === "pending_approval") && <p className="muted-copy">Accept a freelancer application before funding this project.</p>}
                    {(task.status === "open" || task.status === "pending_approval") && !task.freelancer && <button className="button button-quiet" disabled={isSubmitting} onClick={() => { setError(""); setIsCancelDialogOpen(true); }} type="button">Cancel posting</button>}
                    {task.status === "submitted" && submissionHistoryLoaded && !hasSubmissionHistory && <button className="button button-primary" disabled={isSubmitting} onClick={() => void performAction("complete")} type="button">Complete Legacy Submission</button>}
                    {task.status === "submitted" && !submissionHistoryLoaded && <p className="muted-copy" role="status">Loading submission history...</p>}
                    <Link className="button button-quiet" href="/client/dashboard/payments">Payment history</Link>
                </aside>
            </div>

            <ProjectSubmissions projectId={task.id} role="employer" projectStatus={task.status} onStatusChange={updateTaskStatus} onHistoryLoaded={handleSubmissionHistory} />
            {task.freelancer && <ProjectManagementActions projectId={task.id} projectStatus={task.status} role="employer" onStatusChange={updateTaskStatus} />}
            {task.freelancer && <ProjectDispute projectId={task.id} projectStatus={task.status} role="employer" />}

            {isReviewReady && <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Review</span><h2>Leave a review</h2></div></div>
                <form className="dashboard-form" onSubmit={(event) => void submitReview(event)}>
                    <label htmlFor="rating">Rating</label>
                    <select className="filter-input" id="rating" onChange={(event) => setRating(Number(event.target.value))} value={rating}>
                        {[5,4,3,2,1].map((value) => <option key={value} value={value}>{value} star{value > 1 ? "s" : ""}</option>)}
                    </select>
                    <label htmlFor="review-comment">Review</label>
                    <textarea className="filter-input dashboard-textarea" id="review-comment" maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder="Describe the quality of the freelancer's work, communication, and professionalism." value={comment} />
                    <button className="button button-primary" type="submit">Submit review</button>
                </form>
            </section>}

            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Feedback</span><h2>Project reviews</h2></div></div>
                {reviews.length ? <div className="dashboard-list">{reviews.map((review) => <article className="dashboard-list-row" key={review.id}><div><strong>{review.client?.name || "Client"}</strong><span>{"★".repeat(review.rating)}{review.rating ? "" : ""}</span><p>{review.comment}</p></div><time>{new Date(review.createdAt).toLocaleDateString()}</time></article>)}</div> : <div className="dashboard-empty"><strong>No reviews yet.</strong><p>Project reviews will appear here once a client leaves feedback.</p></div>}
            </section>
        </section>
        {isCancelDialogOpen && <div className="admin-users-overlay" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSubmitting) setIsCancelDialogOpen(false);
        }}>
            <section aria-labelledby="cancel-job-title" aria-modal="true" className="admin-users-dialog admin-users-confirm-dialog" role="alertdialog">
                <h2 id="cancel-job-title">Cancel Job Posting?</h2>
                <p>Are you sure you want to cancel this job posting? Freelancers will no longer be able to apply.</p>
                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="admin-users-dialog-actions">
                    <button className="button button-quiet" disabled={isSubmitting} onClick={() => setIsCancelDialogOpen(false)} type="button">Keep Job</button>
                    <button className="button button-primary" disabled={isSubmitting} onClick={() => void performAction("cancel")} type="button">
                        {isSubmitting ? "Cancelling..." : "Cancel Job"}
                    </button>
                </div>
            </section>
        </div>}
        {toast && <div className={`admin-users-toast${toastIsError ? " client-job-toast-error" : ""}`} role={toastIsError ? "alert" : "status"}>{toast}</div>}
    </main>;
}
