"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Role = "employer" | "freelancer";
type HistoryEntry = { entryId: string; authorId: string; authorRole: string; authorName?: string; message: string; attachments: string[]; createdAt: string };
type Dispute = {
    id: string;
    task: { _id: string; title: string; status: string };
    reason: string;
    description: string;
    evidenceLinks: string[];
    status: string;
    history: HistoryEntry[];
    resolution: string;
    createdAt: string;
    unreadCount: number;
};
type EligibleProject = { id: string; title: string; status: string };
type Result = { disputes?: Dispute[]; eligibleProjects?: EligibleProject[]; error?: string };

const reasonLabels: Record<string, string> = {
    work_quality: "Work quality",
    missed_deadline: "Missed deadline",
    scope_mismatch: "Scope mismatch",
    communication: "Communication",
    payment: "Payment concern",
    other: "Other",
};
const statusLabels: Record<string, string> = {
    open: "Open",
    awaiting_administrator_review: "Awaiting Administrator Review",
    under_review: "Under Investigation",
    awaiting_client_response: "Awaiting Client Response",
    awaiting_freelancer_response: "Awaiting Freelancer Response",
    awaiting_additional_evidence: "Awaiting Additional Evidence",
    resolution_proposed: "Resolution Proposed",
    resolved: "Resolved",
    closed: "Closed",
    escalated: "Escalated",
    reopened: "Reopened",
};

export default function DisputesDashboard({ role }: { role: Role }) {
    const [disputes, setDisputes] = useState<Dispute[]>([]);
    const [eligibleProjects, setEligibleProjects] = useState<EligibleProject[]>([]);
    const [messages, setMessages] = useState<Record<string, string>>({});
    const [evidenceLinks, setEvidenceLinks] = useState<Record<string, string>>({});
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [error, setError] = useState("");
    const [sending, setSending] = useState("");
    const [success, setSuccess] = useState("");
    const requestIds = useRef(new Map<string, string>());

    const loadDisputes = useCallback(async (signal?: AbortSignal, showLoading = false) => {
        if (showLoading) setState("loading");
        try {
            const response = await fetch("/api/disputes", { cache: "no-store", signal });
            const result = await response.json() as Result;
            if (!response.ok || !Array.isArray(result.disputes)) throw new Error(result.error || "Disputes could not be loaded.");
            if (signal?.aborted) return;
            setDisputes(result.disputes);
            setEligibleProjects(result.eligibleProjects || []);
            setError("");
            setState("ready");
        } catch (loadError) {
            if (signal?.aborted) return;
            setError(loadError instanceof Error ? loadError.message : "Disputes could not be loaded.");
            setState("error");
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const start = window.setTimeout(() => { void loadDisputes(controller.signal, true); }, 0);
        const interval = window.setInterval(() => { void loadDisputes(controller.signal); }, 15000);
        return () => {
            window.clearTimeout(start);
            window.clearInterval(interval);
            controller.abort();
        };
    }, [loadDisputes]);

    async function sendMessage(event: FormEvent<HTMLFormElement>, dispute: Dispute) {
        event.preventDefault();
        const message = (messages[dispute.id] || "").trim();
        if (!message || sending) return;
        const attachments = (evidenceLinks[dispute.id] || "").split(/\r?\n/).map((link) => link.trim()).filter(Boolean);
        const requestId = requestIds.current.get(dispute.id) || crypto.randomUUID();
        requestIds.current.set(dispute.id, requestId);
        setSending(dispute.id);
        setError("");
        setSuccess("");
        try {
            const response = await fetch(`/api/disputes/${dispute.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reply", requestId, message, evidenceLinks: attachments }),
            });
            const result = await response.json() as { dispute?: Dispute; error?: string };
            if (!response.ok || !result.dispute) throw new Error(result.error || "Your message could not be sent.");
            setMessages((current) => ({ ...current, [dispute.id]: "" }));
            setEvidenceLinks((current) => ({ ...current, [dispute.id]: "" }));
            requestIds.current.delete(dispute.id);
            setSuccess("Your message was added to the dispute.");
            await loadDisputes();
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Your message could not be sent. Retry to safely check its status.");
        } finally {
            setSending("");
        }
    }

    return <section className="dashboard-disputes">
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="success-message" role="status">{success}</p>}
        {state === "loading" && <div className="dashboard-empty" role="status">Loading disputes...</div>}
        {state === "error" && <div className="dashboard-empty" role="alert"><p>{error}</p><button className="button button-quiet" onClick={() => void loadDisputes(undefined, true)} type="button">Try again</button></div>}
        {state === "ready" && role === "employer" && <section className="dashboard-panel dispute-eligible-projects">
            <div className="dashboard-panel-heading"><div><span className="panel-kicker">Project support</span><h2>Open a dispute</h2></div></div>
            {eligibleProjects.length ? <ul>{eligibleProjects.map((project) => <li key={project.id}>
                <span><strong>{project.title}</strong><small>{project.status.replace(/_/g, " ")}</small></span>
                <Link className="button button-quiet" href={`/client/dashboard/projects/${project.id}`}>Review project</Link>
            </li>)}</ul> : <p className="muted-copy">No projects are currently eligible to open a dispute.</p>}
        </section>}
        {state === "ready" && disputes.length === 0 && <div className="dashboard-empty"><strong>No disputes to show.</strong><p>Disputes linked to your projects will appear here.</p></div>}
        {state === "ready" && disputes.map((dispute) => <article className="dashboard-panel dashboard-dispute-card" id={dispute.id} key={dispute.id}>
            <header className="dashboard-dispute-heading">
                <div><span className="panel-kicker">{reasonLabels[dispute.reason] || dispute.reason}</span><h2>{dispute.task?.title || "Project dispute"}</h2></div>
                <span className={`status-badge status-${dispute.status}`}>{statusLabels[dispute.status] || "Under Review"}</span>
            </header>
            {dispute.unreadCount > 0 && <span className="dispute-unread-indicator">{dispute.unreadCount} new {dispute.unreadCount === 1 ? "message" : "messages"}</span>}
            <dl className="dashboard-dispute-meta"><div><dt>Project reference</dt><dd>{dispute.task?._id}</dd></div><div><dt>Project status</dt><dd>{dispute.task?.status?.replace(/_/g, " ")}</dd></div><div><dt>Opened</dt><dd>{new Date(dispute.createdAt).toLocaleString()}</dd></div></dl>
            <p className="project-dispute-description">{dispute.description}</p>
            {dispute.evidenceLinks.length > 0 && <div><h3>Supporting evidence</h3><ul className="project-submission-links">{dispute.evidenceLinks.map((url) => <li key={url}><a href={url} rel="noreferrer" target="_blank">{new URL(url).hostname}</a></li>)}</ul></div>}
            <div className="dashboard-dispute-conversation">
                <h3>Conversation</h3>
                {!dispute.history.length && <p className="muted-copy">No messages yet.</p>}
                <ol className="project-dispute-history">{dispute.history.map((entry) => <li key={entry.entryId}>
                    <div><strong>{entry.authorName || (entry.authorRole === "admin" ? "FreelanceX Support Team" : entry.authorRole === "employer" ? "Client" : "Freelancer")}</strong><span>{entry.authorRole === "admin" ? "FreelanceX Support Team" : entry.authorRole}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div>
                    <p>{entry.message}</p>
                    {entry.attachments?.length > 0 && <ul className="project-submission-links">{entry.attachments.map((url) => <li key={url}><a href={url} rel="noreferrer" target="_blank">{new URL(url).hostname}</a></li>)}</ul>}
                </li>)}</ol>
            </div>
            {dispute.resolution && <div className="project-submission-feedback"><strong>Final resolution</strong><p>{dispute.resolution}</p></div>}
            {!["resolved", "closed"].includes(dispute.status) && <form className="dashboard-dispute-reply" onSubmit={(event) => void sendMessage(event, dispute)}>
                <label htmlFor={`dispute-reply-${dispute.id}`}>Send a message</label>
                <textarea className="filter-input dashboard-textarea" id={`dispute-reply-${dispute.id}`} maxLength={5000} value={messages[dispute.id] || ""} onChange={(event) => setMessages((current) => ({ ...current, [dispute.id]: event.target.value }))} />
                <label htmlFor={`dispute-evidence-${dispute.id}`}>Evidence links (optional, one HTTPS URL per line)</label>
                <textarea className="filter-input dashboard-textarea" id={`dispute-evidence-${dispute.id}`} maxLength={20480} value={evidenceLinks[dispute.id] || ""} onChange={(event) => setEvidenceLinks((current) => ({ ...current, [dispute.id]: event.target.value }))} />
                <button className="button button-primary" disabled={sending === dispute.id || !(messages[dispute.id] || "").trim()} type="submit">{sending === dispute.id ? "Sending..." : "Send message"}</button>
            </form>}
        </article>)}
    </section>;
}
