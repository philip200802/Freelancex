"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type DisputeStatus = "open" | "under_review" | "awaiting_client_response" | "awaiting_freelancer_response" | "resolved" | "closed";
type Dispute = {
    id: string;
    task: { _id: string; title: string; amount: number; status: string };
    employer: { name: string; email: string };
    freelancer: { name: string; email: string };
    reason: string;
    description: string;
    evidenceLinks: string[];
    status: DisputeStatus;
    history: Array<{ entryId: string; authorRole: string; authorName?: string; message: string; attachments?: string[]; createdAt: string }>;
    resolution: string;
    createdAt: string;
    paymentStatus: string;
    unreadCount?: number;
};
type DisputesResult = { disputes?: Dispute[]; error?: string };
type DisputeResponse = { dispute?: Dispute; error?: string };
type PendingRequest = { requestId: string; action: string; message: string; status: string; resolution: string };

const statuses: Array<[DisputeStatus, string]> = [
    ["open", "Open"],
    ["under_review", "Under Review"],
    ["awaiting_client_response", "Awaiting Client Response"],
    ["awaiting_freelancer_response", "Awaiting Freelancer Response"],
    ["resolved", "Resolved"],
    ["closed", "Closed"],
];
const reasonLabels: Record<string, string> = {
    work_quality: "Work quality",
    missed_deadline: "Missed deadline",
    scope_mismatch: "Scope mismatch",
    communication: "Communication",
    payment: "Payment concern",
    other: "Other",
};

export default function AdminDisputesPage() {
    const [disputes, setDisputes] = useState<Dispute[]>([]);
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [targetStatus, setTargetStatus] = useState<Record<string, DisputeStatus>>({});
    const [messages, setMessages] = useState<Record<string, string>>({});
    const [resolutions, setResolutions] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState("");
    const [pendingIds, setPendingIds] = useState<string[]>([]);
    const pendingRequests = useRef(new Map<string, PendingRequest>());

    useEffect(() => {
        const controller = new AbortController();
        async function load(showLoading = false) {
            if (showLoading) setState("loading");
            try {
                const response = await fetch("/api/disputes", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as DisputesResult;
                if (!response.ok || !Array.isArray(result.disputes)) throw new Error(result.error || "Disputes are unavailable.");
                if (controller.signal.aborted) return;
                setDisputes(result.disputes);
                setError("");
                setState("ready");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Disputes are unavailable.");
                setState("error");
            }
        }
        void load(true);
        const interval = window.setInterval(() => { void load(); }, 15000);
        return () => {
            window.clearInterval(interval);
            controller.abort();
        };
    }, [attempt]);

    async function updateDispute(event: FormEvent<HTMLFormElement>, dispute: Dispute) {
        event.preventDefault();
        if (saving) return;
        const selectedStatus = targetStatus[dispute.id] || "under_review";
        const resolution = (resolutions[dispute.id] || "").trim();
        const message = (messages[dispute.id] || "").trim();
        if (selectedStatus === "resolved" && !resolution) {
            setError("Enter a resolution before resolving a dispute.");
            return;
        }
        if (selectedStatus !== "resolved" && !message) {
            setError("Add a message to the dispute history.");
            return;
        }
        let pending = pendingRequests.current.get(dispute.id);
        if (!pending) {
            const action = selectedStatus === "resolved"
                ? "resolve"
                : selectedStatus === "closed"
                    ? "close"
                    : selectedStatus === "awaiting_client_response" || selectedStatus === "awaiting_freelancer_response"
                        ? "request_response"
                        : "set_status";
            pending = {
                requestId: crypto.randomUUID(),
                action,
                message,
                status: selectedStatus,
                resolution,
            };
            pendingRequests.current.set(dispute.id, pending);
            setPendingIds((current) => current.includes(dispute.id) ? current : [...current, dispute.id]);
        }
        setError("");
        setSuccess("");
        setSaving(dispute.id);
        try {
            const response = await fetch(`/api/disputes/${dispute.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(pending),
            });
            const result = await response.json() as DisputeResponse;
            if (!response.ok || !result.dispute) throw new Error(result.error || "The dispute could not be updated.");
            setDisputes((current) => current.map((item) => item.id === dispute.id ? { ...item, ...result.dispute, task: item.task, employer: item.employer, freelancer: item.freelancer, paymentStatus: item.paymentStatus } : item));
            pendingRequests.current.delete(dispute.id);
            setPendingIds((current) => current.filter((id) => id !== dispute.id));
            setMessages((current) => ({ ...current, [dispute.id]: "" }));
            setSuccess("Dispute updated. The parties were notified when their verified email addresses are available.");
        } catch (updateError) {
            setError(updateError instanceof Error ? updateError.message : "The dispute could not be updated. Retry to safely check its status.");
        } finally {
            setSaving("");
        }
    }

    return <section className="admin-disputes">
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="success-message" role="status">{success}</p>}
        {state === "loading" && <div className="dashboard-empty" role="status">Loading disputes...</div>}
        {state === "error" && <div className="dashboard-empty" role="alert"><p>{error}</p><button className="button button-quiet" onClick={() => { setError(""); setAttempt((value) => value + 1); }} type="button">Retry</button></div>}
        {state === "ready" && disputes.length === 0 && <div className="dashboard-empty"><strong>No disputes have been opened.</strong><p>Project disputes requiring administrator review will appear here.</p></div>}
        {state === "ready" && disputes.map((dispute) => {
            const hasPending = pendingIds.includes(dispute.id);
            const selectedStatus = targetStatus[dispute.id] || "under_review";
            const isResolved = selectedStatus === "resolved";
            return <article className="dashboard-panel admin-dispute-card" id={dispute.id} key={dispute.id}>
                <header className="admin-dispute-heading"><div><span className="panel-kicker">{reasonLabels[dispute.reason] || dispute.reason}</span><h2>{dispute.task?.title || "Project dispute"}</h2></div><span className={`status-badge status-${dispute.status}`}>{dispute.status.replace(/_/g, " ")}</span></header>
                {!!dispute.unreadCount && <span className="dispute-unread-indicator">{dispute.unreadCount} new {dispute.unreadCount === 1 ? "message" : "messages"}</span>}
                <dl className="admin-dispute-meta">
                    <div><dt>Project reference</dt><dd>{dispute.task?._id}</dd></div>
                    <div><dt>Project status</dt><dd>{dispute.task?.status?.replace(/_/g, " ")}</dd></div>
                    <div><dt>Payment status</dt><dd>{dispute.paymentStatus?.replace(/_/g, " ") || "Not recorded"}</dd></div>
                    <div><dt>Client</dt><dd>{dispute.employer?.name || "Client"}{dispute.employer?.email ? ` · ${dispute.employer.email}` : ""}</dd></div>
                    <div><dt>Freelancer</dt><dd>{dispute.freelancer?.name || "Freelancer"}{dispute.freelancer?.email ? ` · ${dispute.freelancer.email}` : ""}</dd></div>
                    <div><dt>Opened</dt><dd>{new Date(dispute.createdAt).toLocaleString()}</dd></div>
                </dl>
                <p className="project-dispute-description">{dispute.description}</p>
                {dispute.evidenceLinks.length > 0 && <div><h3>Evidence links</h3><ul className="project-submission-links">{dispute.evidenceLinks.map((link) => <li key={link}><a href={link} rel="noreferrer" target="_blank">{new URL(link).hostname}</a></li>)}</ul></div>}
                <h3>History</h3>
                <ol className="project-dispute-history">{dispute.history.map((entry) => <li key={entry.entryId}><div><strong>{entry.authorName || (entry.authorRole === "admin" ? "FreelanceX Support" : entry.authorRole === "employer" ? "Client" : "Freelancer")}</strong><span>{entry.authorRole}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div><p>{entry.message}</p>{entry.attachments?.length ? <ul className="project-submission-links">{entry.attachments.map((link) => <li key={link}><a href={link} rel="noreferrer" target="_blank">{new URL(link).hostname}</a></li>)}</ul> : null}</li>)}</ol>
                {dispute.resolution && <div className="project-submission-feedback"><strong>Recorded resolution</strong><p>{dispute.resolution}</p></div>}
                {dispute.status !== "closed" && <form className="dashboard-form admin-dispute-actions" onSubmit={(event) => void updateDispute(event, dispute)}>
                    <h3>Update dispute</h3>
                    <label>Status<select className="filter-input" disabled={hasPending || saving === dispute.id} value={selectedStatus} onChange={(event) => setTargetStatus((current) => ({ ...current, [dispute.id]: event.target.value as DisputeStatus }))}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    {isResolved && <label>Resolution<textarea className="filter-input dashboard-textarea" disabled={hasPending || saving === dispute.id} maxLength={5000} required value={resolutions[dispute.id] || ""} onChange={(event) => setResolutions((current) => ({ ...current, [dispute.id]: event.target.value }))} /></label>}
                    <label>Message to parties<textarea className="filter-input dashboard-textarea" disabled={hasPending || saving === dispute.id} maxLength={5000} required={!isResolved} value={messages[dispute.id] || ""} onChange={(event) => setMessages((current) => ({ ...current, [dispute.id]: event.target.value }))} /></label>
                    {hasPending && <p className="form-hint">Retrying the same update safely; its text is locked to prevent duplicate history entries.</p>}
                    <button className="button button-primary" disabled={saving === dispute.id} type="submit">{saving === dispute.id ? "Saving..." : hasPending ? "Retry update" : "Save update"}</button>
                </form>}
            </article>;
        })}
    </section>;
}
