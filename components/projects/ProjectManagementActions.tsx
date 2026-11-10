"use client";

import { useEffect, useState, type FormEvent } from "react";

type CancellationEntry = {
    id: string;
    requestedBy: string;
    requesterRole: "employer" | "freelancer";
    reason: string;
    description: string;
    evidenceLinks: string[];
    status: "pending" | "accepted" | "rejected" | "disputed";
    createdAt: string;
};
type ExtensionEntry = {
    id: string;
    freelancer: string;
    currentDeadline: string;
    proposedDeadline: string;
    duration: number;
    durationUnit: "days" | "weeks";
    reason: string;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
};
type ManagementResponse = { requests?: CancellationEntry[] | ExtensionEntry[]; error?: string };

const cancellationOptions = [
    ["changed_requirements", "Client changed project requirements"],
    ["freelancer_unable_to_continue", "Freelancer unable to continue"],
    ["communication_problems", "Communication problems"],
    ["project_no_longer_needed", "Project no longer needed"],
    ["unrealistic_requirements", "Unrealistic requirements or expectations"],
    ["mutual_agreement", "Mutual agreement"],
    ["other", "Other"],
];

export default function ProjectManagementActions({
    projectId,
    projectStatus,
    role,
    onStatusChange,
}: {
    projectId: string;
    projectStatus: string;
    role: "employer" | "freelancer";
    onStatusChange?: (status: string) => void;
}) {
    const [cancellations, setCancellations] = useState<CancellationEntry[]>([]);
    const [extensions, setExtensions] = useState<ExtensionEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [busy, setBusy] = useState(false);
    const [reason, setReason] = useState("other");
    const [description, setDescription] = useState("");
    const [evidenceLinks, setEvidenceLinks] = useState("");
    const [extensionDuration, setExtensionDuration] = useState("2");
    const [extensionUnit, setExtensionUnit] = useState<"days" | "weeks">("days");
    const [extensionReason, setExtensionReason] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const [cancellationResponse, extensionResponse] = await Promise.all([
                    fetch(`/api/tasks/${projectId}/cancellation`, { cache: "no-store", signal: controller.signal }),
                    fetch(`/api/tasks/${projectId}/deadline-extensions`, { cache: "no-store", signal: controller.signal }),
                ]);
                const [cancellationResult, extensionResult] = await Promise.all([
                    cancellationResponse.json() as Promise<ManagementResponse>,
                    extensionResponse.json() as Promise<ManagementResponse>,
                ]);
                if (!cancellationResponse.ok) throw new Error(cancellationResult.error || "Cancellation history is unavailable.");
                if (!extensionResponse.ok) throw new Error(extensionResult.error || "Deadline extension history is unavailable.");
                if (controller.signal.aborted) return;
                setCancellations((cancellationResult.requests || []) as CancellationEntry[]);
                setExtensions((extensionResult.requests || []) as ExtensionEntry[]);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Project management history is unavailable.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [projectId]);

    async function sendRequest(path: string, method: "POST" | "PATCH", body: object) {
        setBusy(true);
        setError("");
        setSuccess("");
        try {
            const response = await fetch(path, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await response.json() as { error?: string; request?: { id: string; status: string; proposedDeadline?: string }; task?: { status?: string; deadlineAt?: string } };
            if (!response.ok) throw new Error(result.error || "The project request could not be saved.");
            setSuccess("Project request updated.");
            if (result.task?.status) onStatusChange?.(result.task.status);
            return result;
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "The project request could not be saved.");
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function requestCancellation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const links = evidenceLinks.split(/\r?\n/).map((link) => link.trim()).filter(Boolean);
        const result = await sendRequest(`/api/tasks/${projectId}/cancellation`, "POST", { reason, description, evidenceLinks: links });
        if (result?.request) {
            setCancellations((current) => [{
                id: result.request!.id,
                requestedBy: "",
                requesterRole: role,
                reason,
                description,
                evidenceLinks: links,
                status: "pending",
                createdAt: new Date().toISOString(),
            }, ...current]);
            setDescription("");
            setEvidenceLinks("");
        }
    }

    async function requestExtension(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const result = await sendRequest(`/api/tasks/${projectId}/deadline-extensions`, "POST", {
            duration: Number(extensionDuration),
            durationUnit: extensionUnit,
            reason: extensionReason,
        });
        if (result?.request) {
            setExtensions((current) => [{
                id: result.request!.id,
                freelancer: "",
                currentDeadline: "",
                proposedDeadline: result.request!.proposedDeadline || "",
                duration: Number(extensionDuration),
                durationUnit: extensionUnit,
                reason: extensionReason,
                status: "pending",
                createdAt: new Date().toISOString(),
            }, ...current]);
            setExtensionReason("");
        }
    }

    async function decideCancellation(entry: CancellationEntry, action: "accept" | "reject") {
        const result = await sendRequest(`/api/tasks/${projectId}/cancellation/${entry.id}`, "PATCH", { action });
        if (!result?.request) return;
        setCancellations((current) => current.map((item) => item.id === entry.id ? { ...item, status: action === "accept" ? "accepted" : "rejected" } : item));
    }

    async function decideExtension(entry: ExtensionEntry, action: "approve" | "reject") {
        const result = await sendRequest(`/api/tasks/${projectId}/deadline-extensions/${entry.id}`, "PATCH", { action });
        if (!result?.request) return;
        setExtensions((current) => current.map((item) => item.id === entry.id ? { ...item, status: action === "approve" ? "approved" : "rejected" } : item));
    }

    const activeCancellation = cancellations.find((entry) => entry.status === "pending");
    const activeExtension = extensions.find((entry) => entry.status === "pending");
    const canRequestCancellation = ["awaiting_funding", "funded", "in_progress", "submitted", "revision_requested"].includes(projectStatus);

    return <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><span className="panel-kicker">Project management</span><h2>Requests and history</h2></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="success-message" role="status">{success}</p>}
        {loading && <p className="muted-copy" role="status">Loading project request history...</p>}
        {!loading && !error && <>
            <div className="dashboard-list">
                {cancellations.map((entry) => <article className="dashboard-list-row" key={entry.id}>
                    <div><strong>Cancellation {entry.status}</strong><span>{entry.reason.replaceAll("_", " ")} · {new Date(entry.createdAt).toLocaleDateString()}</span><p>{entry.description}</p>{entry.evidenceLinks.map((link) => <a href={link} key={link} rel="noreferrer" target="_blank">{new URL(link).hostname}</a>)}</div>
                    {entry.status === "pending" && entry.requesterRole !== role && <span className="project-submission-actions"><button className="button button-primary" disabled={busy} onClick={() => void decideCancellation(entry, "accept")} type="button">Accept cancellation</button><button className="button button-quiet" disabled={busy} onClick={() => void decideCancellation(entry, "reject")} type="button">Reject</button></span>}
                </article>)}
                {extensions.map((entry) => <article className="dashboard-list-row" key={entry.id}>
                    <div><strong>Deadline extension {entry.status}</strong><span>+{entry.duration} {entry.durationUnit} · Proposed {entry.proposedDeadline ? new Date(entry.proposedDeadline).toLocaleDateString() : "pending"}</span><p>{entry.reason}</p>{entry.currentDeadline && <small>Previous deadline: {new Date(entry.currentDeadline).toLocaleDateString()}</small>}</div>
                    {entry.status === "pending" && role === "employer" && <span className="project-submission-actions"><button className="button button-primary" disabled={busy} onClick={() => void decideExtension(entry, "approve")} type="button">Approve extension</button><button className="button button-quiet" disabled={busy} onClick={() => void decideExtension(entry, "reject")} type="button">Reject</button></span>}
                </article>)}
                {!cancellations.length && !extensions.length && <p className="muted-copy">No cancellation or deadline extension requests.</p>}
            </div>
            {canRequestCancellation && !activeCancellation && <form className="dashboard-form" onSubmit={(event) => void requestCancellation(event)}>
                <h3>Request project cancellation</h3>
                <p className="form-hint">The other participant must agree. Cancellation will not refund the client or release freelancer funds.</p>
                <label>Reason<select className="filter-input" onChange={(event) => setReason(event.target.value)} value={reason}>{cancellationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>Details<textarea className="filter-input dashboard-textarea" maxLength={5000} onChange={(event) => setDescription(event.target.value)} required value={description} /></label>
                <label>Supporting links (optional, HTTPS URLs one per line)<textarea className="filter-input dashboard-textarea" maxLength={20480} onChange={(event) => setEvidenceLinks(event.target.value)} value={evidenceLinks} /></label>
                <button className="button button-quiet" disabled={busy || !description.trim()} type="submit">{busy ? "Sending..." : "Send cancellation request"}</button>
            </form>}
            {role === "freelancer" && ["funded", "in_progress", "revision_requested"].includes(projectStatus) && !activeExtension && <form className="dashboard-form" onSubmit={(event) => void requestExtension(event)}>
                <h3>Request deadline extension</h3>
                <label>Additional time<input className="filter-input" max={extensionUnit === "weeks" ? "520" : "3650"} min="1" onChange={(event) => setExtensionDuration(event.target.value)} required step="1" type="number" value={extensionDuration} /></label>
                <label>Unit<select className="filter-input" onChange={(event) => setExtensionUnit(event.target.value as "days" | "weeks")} value={extensionUnit}><option value="days">Days</option><option value="weeks">Weeks</option></select></label>
                <label>Reason<textarea className="filter-input dashboard-textarea" maxLength={5000} onChange={(event) => setExtensionReason(event.target.value)} required value={extensionReason} /></label>
                <button className="button button-quiet" disabled={busy || !extensionReason.trim()} type="submit">{busy ? "Sending..." : "Request more time"}</button>
            </form>}
        </>}
    </section>;
}
