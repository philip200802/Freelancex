"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type DisputeStatus = "open" | "under_review" | "awaiting_client_response" | "awaiting_freelancer_response" | "resolved" | "closed";
type DisputeHistoryEntry = { entryId: string; authorId: string; authorRole: string; authorName?: string; message: string; attachments: string[]; createdAt: string };
type Dispute = {
    id: string;
    task: string;
    reason: string;
    description: string;
    evidenceLinks: string[];
    status: DisputeStatus;
    history: DisputeHistoryEntry[];
    resolution: string;
    createdAt: string;
};
type DisputeResponse = { dispute?: Dispute | null; unreadCount?: number; error?: string };
type ProjectDisputeProps = { projectId: string; projectStatus: string; role: "employer" | "freelancer" };

const reasons = [
    ["work_quality", "Work quality"],
    ["missed_deadline", "Missed deadline"],
    ["scope_mismatch", "Scope mismatch"],
    ["communication", "Communication"],
    ["payment", "Payment concern"],
    ["other", "Other"],
];
const statusLabels: Record<DisputeStatus, string> = {
    open: "Open",
    under_review: "Under Review",
    awaiting_client_response: "Awaiting Client Response",
    awaiting_freelancer_response: "Awaiting Freelancer Response",
    resolved: "Resolved",
    closed: "Closed",
};

export default function ProjectDispute({ projectId, projectStatus, role }: ProjectDisputeProps) {
    const [dispute, setDispute] = useState<Dispute | null>(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [isOpening, setIsOpening] = useState(false);
    const [isReplying, setIsReplying] = useState(false);
    const [reason, setReason] = useState("");
    const [description, setDescription] = useState("");
    const [evidence, setEvidence] = useState("");
    const [reply, setReply] = useState("");
    const [replyEvidence, setReplyEvidence] = useState("");
    const replyRequest = useRef<{ requestId: string; message: string; evidenceLinks: string[] } | null>(null);
    const replyInFlight = useRef(false);

    useEffect(() => {
        const controller = new AbortController();
        async function load(showLoading: boolean) {
            if (showLoading) setState("loading");
            try {
                const response = await fetch(`/api/disputes?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as DisputeResponse;
                if (!response.ok) throw new Error(result.error || "Dispute information is unavailable.");
                if (controller.signal.aborted) return;
                setDispute(result.dispute || null);
                setUnreadCount(result.unreadCount || 0);
                setState("ready");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Dispute information is unavailable.");
                setState("error");
            }
        }
        void load(true);
        const interval = window.setInterval(() => { void load(false); }, 15000);
        return () => {
            window.clearInterval(interval);
            controller.abort();
        };
    }, [attempt, projectId]);

    async function openDispute(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (isOpening) return;
        const evidenceLinks = evidence.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
        setError("");
        setSuccess("");
        setIsOpening(true);
        try {
            const response = await fetch("/api/disputes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId, reason, description, evidenceLinks }),
            });
            const result = await response.json() as DisputeResponse;
            if (!response.ok || !result.dispute) throw new Error(result.error || "The dispute could not be opened.");
            setDispute(result.dispute);
            setSuccess("Your dispute has been opened. No payment has been released or refunded.");
            setDescription("");
            setEvidence("");
        } catch (openError) {
            setError(openError instanceof Error ? openError.message : "The dispute could not be opened.");
        } finally {
            setIsOpening(false);
        }
    }

    async function sendReply(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!dispute || replyInFlight.current || !reply.trim()) return;
        const evidenceLinks = replyEvidence.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
        if (!replyRequest.current) replyRequest.current = { requestId: crypto.randomUUID(), message: reply.trim(), evidenceLinks };
        replyInFlight.current = true;
        setError("");
        setSuccess("");
        setIsReplying(true);
        try {
            const response = await fetch(`/api/disputes/${dispute.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reply", ...replyRequest.current }),
            });
            const result = await response.json() as DisputeResponse;
            if (!response.ok || !result.dispute) throw new Error(result.error || "Your response could not be saved.");
            setDispute(result.dispute);
            setReply("");
            setReplyEvidence("");
            replyRequest.current = null;
            setSuccess("Your response was added to the dispute history.");
        } catch (replyError) {
            setError(replyError instanceof Error ? replyError.message : "Your response could not be saved. Retry to safely check its status.");
        } finally {
            replyInFlight.current = false;
            setIsReplying(false);
        }
    }

    const isActive = dispute && dispute.status !== "resolved" && dispute.status !== "closed";
    const canOpen = role === "employer" && ["funded", "in_progress", "submitted", "revision_requested", "completed"].includes(projectStatus);

    return <section className="dashboard-panel project-dispute">
        <div className="dashboard-panel-heading"><div><span className="panel-kicker">Project support</span><h2>Dispute</h2></div>{dispute && <span className={`status-badge status-${dispute.status}`}>{statusLabels[dispute.status]}</span>}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="success-message" role="status">{success}</p>}
        {state === "loading" && <p className="muted-copy" role="status">Loading dispute information...</p>}
        {state === "error" && <div className="dashboard-empty" role="alert"><p>{error}</p><button className="button button-quiet" onClick={() => { setError(""); setAttempt((value) => value + 1); }} type="button">Retry</button></div>}
        {state === "ready" && !dispute && <>
            <p className="muted-copy">There is no dispute for this project.</p>
            {canOpen && <form className="dashboard-form" onSubmit={(event) => void openDispute(event)}>
                <h3>Open a dispute</h3>
                <p className="form-hint">Explain the issue and provide links to relevant evidence. Opening a dispute does not release or refund project funds.</p>
                <label>Reason<select className="filter-input" required value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select a reason</option>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>Describe the issue<textarea className="filter-input dashboard-textarea" maxLength={5000} required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
                <label>Evidence links (optional, one HTTPS URL per line)<textarea className="filter-input dashboard-textarea" maxLength={20480} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
                <button className="button button-primary" disabled={isOpening} type="submit">{isOpening ? "Opening dispute..." : "Submit dispute"}</button>
            </form>}
        </>}
        {state === "ready" && dispute && <>
            <dl className="project-dispute-summary"><div><dt>Reason</dt><dd>{reasons.find(([value]) => value === dispute.reason)?.[1] || dispute.reason}</dd></div><div><dt>Opened</dt><dd>{new Date(dispute.createdAt).toLocaleString()}</dd></div></dl>
            <p className="project-dispute-description">{dispute.description}</p>
            {dispute.evidenceLinks.length > 0 && <div><h3>Supporting evidence</h3><ul className="project-submission-links">{dispute.evidenceLinks.map((link) => <li key={link}><a href={link} rel="noreferrer" target="_blank">{new URL(link).hostname}</a></li>)}</ul></div>}
            <div><h3>Dispute history</h3><ol className="project-dispute-history">{dispute.history.map((entry) => <li key={entry.entryId}><div><strong>{entry.authorName || (entry.authorRole === "admin" ? "FreelanceX Support" : entry.authorRole === "employer" ? "Client" : "Freelancer")}</strong><span>{entry.authorRole}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div><p>{entry.message}</p>{entry.attachments?.length > 0 && <ul className="project-submission-links">{entry.attachments.map((url) => <li key={url}><a href={url} rel="noreferrer" target="_blank">{new URL(url).hostname}</a></li>)}</ul>}</li>)}</ol></div>
            {unreadCount > 0 && <span className="dispute-unread-indicator">{unreadCount} new {unreadCount === 1 ? "message" : "messages"}</span>}
            {dispute.resolution && <div className="project-submission-feedback"><strong>Resolution</strong><p>{dispute.resolution}</p></div>}
            {isActive && <form className="dashboard-form" onSubmit={(event) => void sendReply(event)}>
                <label>Respond to the dispute<textarea className="filter-input dashboard-textarea" maxLength={5000} required value={reply} onChange={(event) => setReply(event.target.value)} /></label>
                <label>Evidence links (optional, one HTTPS URL per line)<textarea className="filter-input dashboard-textarea" maxLength={20480} value={replyEvidence} onChange={(event) => setReplyEvidence(event.target.value)} /></label>
                <button className="button button-primary" disabled={isReplying || !reply.trim()} type="submit">{isReplying ? "Sending..." : "Send response"}</button>
            </form>}
        </>}
    </section>;
}
