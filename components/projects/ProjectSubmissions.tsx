"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type SubmissionAttachment = {
    fileName: string;
    url: string;
    fileType: string;
    fileSize: number;
};

type Submission = {
    id: string;
    submissionNumber: number;
    message: string;
    attachments: SubmissionAttachment[];
    links: string[];
    status: "submitted" | "revision_requested" | "approved";
    feedback?: string;
    reviewedAt?: string;
    submittedAt: string;
};

type SubmissionResponse = {
    submissions?: Submission[];
    error?: string;
    message?: string;
    task?: { status: string };
};

type SubmissionRole = "freelancer" | "employer" | "admin";

function statusLabel(status: Submission["status"]) {
    if (status === "revision_requested") return "Revision requested";
    if (status === "approved") return "Approved";
    return "Submitted for review";
}

function uploadSubmission(projectId: string, formData: FormData, onProgress: (progress: number) => void) {
    return new Promise<SubmissionResponse>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", `/api/tasks/${projectId}/submissions`);
        request.responseType = "json";
        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        });
        request.addEventListener("load", () => {
            const result = request.response as SubmissionResponse | null;
            if (request.status >= 200 && request.status < 300 && result) {
                resolve(result);
                return;
            }
            reject(new Error(result?.error || "Submission could not be uploaded."));
        });
        request.addEventListener("error", () => reject(new Error("Submission upload failed. Check your connection and try again.")));
        request.addEventListener("abort", () => reject(new Error("Submission upload was cancelled.")));
        request.send(formData);
    });
}

export default function ProjectSubmissions({
    projectId,
    role,
    projectStatus,
    onStatusChange,
    onHistoryLoaded,
}: {
    projectId: string;
    role: SubmissionRole;
    projectStatus: string;
    onStatusChange?: (status: string) => void;
    onHistoryLoaded?: (hasSubmissions: boolean) => void;
}) {
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [message, setMessage] = useState("");
    const [linkText, setLinkText] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<Map<File, string>>(new Map());
    const imagePreviewUrls = useRef<Map<File, string>>(new Map());
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [reviewFeedback, setReviewFeedback] = useState("");
    const [reviewing, setReviewing] = useState<"approve" | "request_revision" | null>(null);
    const [isConfirmingApproval, setIsConfirmingApproval] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => () => imagePreviewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

    useEffect(() => {
        const controller = new AbortController();
        async function loadSubmissions() {
            setLoadState("loading");
            try {
                const response = await fetch(`/api/tasks/${projectId}/submissions`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as SubmissionResponse;
                if (!response.ok || !Array.isArray(result.submissions)) {
                    throw new Error(result.error || "Submission history is unavailable.");
                }
                if (controller.signal.aborted) return;
                setSubmissions(result.submissions);
                onHistoryLoaded?.(result.submissions.length > 0);
                setLoadState("ready");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Submission history is unavailable.");
                setLoadState("error");
            }
        }
        void loadSubmissions();
        return () => controller.abort();
    }, [loadAttempt, onHistoryLoaded, projectId]);

    const latestSubmission = useMemo(() => submissions[submissions.length - 1], [submissions]);
    const canSubmit = role === "freelancer" &&
        (projectStatus === "funded" || projectStatus === "in_progress" ||
            (projectStatus === "revision_requested" && latestSubmission?.status === "revision_requested"));
    const canReview = role === "employer" && projectStatus === "submitted" && latestSubmission?.status === "submitted";

    const submitWork = useCallback(async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isSubmitting || !message.trim()) return;
        const links = linkText.split(/\r?\n/).map((link) => link.trim()).filter(Boolean);
        if (links.length > 10 || links.some((link) => {
            try {
                return new URL(link).protocol !== "https:";
            } catch {
                return true;
            }
        })) {
            setError("Enter up to ten valid HTTPS links, one per line.");
            return;
        }
        if (files.length > 5 || files.some((file) => file.size > 10 * 1024 * 1024)) {
            setError("Choose at most five files, each 10 MB or smaller.");
            return;
        }
        setError("");
        setSuccess("");
        setUploadProgress(0);
        setIsSubmitting(true);
        const formData = new FormData();
        formData.set("message", message.trim());
        formData.set("links", JSON.stringify(links));
        files.forEach((file) => formData.append("files", file));
        try {
            const result = await uploadSubmission(projectId, formData, setUploadProgress);
            setSuccess(result.message || "Work submitted for review.");
            setMessage("");
            setLinkText("");
            imagePreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
            imagePreviewUrls.current.clear();
            setImagePreviews(new Map());
            setFiles([]);
            setIsFormOpen(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
            setUploadProgress(100);
            onStatusChange?.(result.task?.status || "submitted");
            setLoadAttempt((attempt) => attempt + 1);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Work could not be submitted.");
        } finally {
            setIsSubmitting(false);
        }
    }, [files, isSubmitting, linkText, message, onStatusChange, projectId]);

    async function reviewSubmission(action: "approve" | "request_revision") {
        if (!latestSubmission || reviewing) return;
        if (action === "request_revision" && !reviewFeedback.trim()) {
            setError("Provide feedback explaining what needs to be changed.");
            return;
        }
        if (action === "approve" && !isConfirmingApproval) {
            setIsConfirmingApproval(true);
            return;
        }

        setError("");
        setSuccess("");
        setReviewing(action);
        setIsConfirmingApproval(false);
        try {
            const response = await fetch(`/api/tasks/${projectId}/submissions/${latestSubmission.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, feedback: action === "request_revision" ? reviewFeedback : "" }),
            });
            const result = await response.json() as SubmissionResponse;
            if (!response.ok) throw new Error(result.error || "Submission review could not be saved.");
            setSuccess(result.message || "Submission review saved.");
            setReviewFeedback("");
            onStatusChange?.(result.task?.status || (action === "approve" ? "completed" : "revision_requested"));
            setLoadAttempt((attempt) => attempt + 1);
        } catch (reviewError) {
            setError(reviewError instanceof Error ? reviewError.message : "Submission review could not be saved.");
        } finally {
            setReviewing(null);
            setIsConfirmingApproval(false);
        }
    }

    function selectFiles(selectedFiles: FileList | null) {
        if (!selectedFiles) return;
        const incomingFiles = Array.from(selectedFiles);
        if (files.length + incomingFiles.length > 5) {
            setError("Choose at most five deliverables.");
            return;
        }
        if (incomingFiles.some((file) => file.size === 0 || file.size > 10 * 1024 * 1024)) {
            setError("Choose deliverables larger than 0 bytes and no more than 10 MB each.");
            return;
        }
        setError("");
        const previews = new Map(imagePreviewUrls.current);
        incomingFiles.filter((file) => file.type.startsWith("image/")).forEach((file) => previews.set(file, URL.createObjectURL(file)));
        imagePreviewUrls.current = previews;
        setImagePreviews(previews);
        setFiles((current) => [...current, ...incomingFiles]);
        if (fileInputRef.current) fileInputRef.current.value = "";
    }

    function removeFile(fileToRemove: File) {
        const previews = new Map(imagePreviewUrls.current);
        const previewUrl = previews.get(fileToRemove);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previews.delete(fileToRemove);
        imagePreviewUrls.current = previews;
        setImagePreviews(previews);
        setFiles((current) => current.filter((file) => file !== fileToRemove));
    }

    return <section className="dashboard-panel project-submissions">
        <div className="dashboard-panel-heading">
            <div><span className="panel-kicker">Project delivery</span><h2>Submission history</h2></div>
            {submissions.length > 0 && <span className="status-badge">{submissions.length} submission{submissions.length === 1 ? "" : "s"}</span>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="success-message" role="status">{success}</p>}
        {loadState === "loading" && <p className="muted-copy" role="status">Loading submission history...</p>}
        {loadState === "error" && <div className="dashboard-empty" role="alert"><p>{error}</p><button className="button button-quiet" onClick={() => { setError(""); setLoadAttempt((attempt) => attempt + 1); }} type="button">Retry</button></div>}
        {loadState === "ready" && submissions.length === 0 && <p className="muted-copy">No work has been submitted for this project yet.</p>}

        {loadState === "ready" && submissions.length > 0 && <ol className="project-submission-history">
            {submissions.map((submission, index) => <li className="project-submission-item" key={submission.id}>
                <div className="project-submission-heading">
                    <strong>Submission {submission.submissionNumber}{index === submissions.length - 1 ? " · Latest" : ""}</strong>
                    <span className={`status-badge status-${submission.status}`}>{statusLabel(submission.status)}</span>
                </div>
                <time dateTime={submission.submittedAt}>{new Date(submission.submittedAt).toLocaleString()}</time>
                <p className="project-submission-message">{submission.message}</p>
                {submission.feedback && <div className="project-submission-feedback"><strong>Employer feedback</strong><p>{submission.feedback}</p>{submission.reviewedAt && <time dateTime={submission.reviewedAt}>Reviewed {new Date(submission.reviewedAt).toLocaleString()}</time>}</div>}
                {submission.attachments.length > 0 && <ul className="project-submission-links">{submission.attachments.map((attachment) => <li key={`${submission.id}-${attachment.url}`}><a href={attachment.url} rel="noreferrer" target="_blank">{attachment.fileName}</a><span>{(attachment.fileSize / (1024 * 1024)).toFixed(1)} MB</span></li>)}</ul>}
                {submission.links.length > 0 && <ul className="project-submission-links">{submission.links.map((link) => <li key={link}><a href={link} rel="noreferrer" target="_blank">{new URL(link).hostname}</a></li>)}</ul>}
            </li>)}
        </ol>}

        {canSubmit && loadState === "ready" && <button aria-expanded={isFormOpen} className="button button-primary project-submission-open" onClick={() => setIsFormOpen((open) => !open)} type="button">
            {isFormOpen ? "Close submission form" : projectStatus === "revision_requested" ? "Resubmit Work" : "Submit Work"}
        </button>}

        {canSubmit && isFormOpen && loadState === "ready" && <form className="dashboard-form project-submission-form" onSubmit={(event) => void submitWork(event)}>
            <h3>{projectStatus === "revision_requested" ? "Resubmit corrected work" : "Submit completed work"}</h3>
            {projectStatus === "revision_requested" && latestSubmission?.feedback && <div className="project-submission-feedback"><strong>Changes requested by the employer</strong><p>{latestSubmission.feedback}</p></div>}
            <label htmlFor={`submission-message-${projectId}`}>Completion message <span aria-hidden="true">*</span></label>
            <textarea className="filter-input dashboard-textarea" id={`submission-message-${projectId}`} maxLength={5000} required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the completed work and anything the employer should know." />
            <label htmlFor={`submission-files-${projectId}`}>Deliverable files (optional, up to 5; 10 MB each)</label>
            <input accept=".pdf,.docx,.xlsx,.pptx,.zip,.txt,.jpg,.jpeg,.png,.webp" className="filter-input" id={`submission-files-${projectId}`} multiple onChange={(event) => selectFiles(event.target.files)} ref={fileInputRef} type="file" />
            {files.length > 0 && <ul className="project-submission-selected-files">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}>{imagePreviews.get(file) && <Image alt={`Preview of ${file.name}`} height={56} src={imagePreviews.get(file) || ""} unoptimized width={72} />}<span>{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</span><button aria-label={`Remove ${file.name}`} className="text-link" onClick={() => removeFile(file)} type="button">Remove</button></li>)}</ul>}
            <label htmlFor={`submission-links-${projectId}`}>External links (optional, one HTTPS URL per line)</label>
            <textarea className="filter-input dashboard-textarea" id={`submission-links-${projectId}`} maxLength={20480} value={linkText} onChange={(event) => setLinkText(event.target.value)} placeholder={"https://github.com/...\nhttps://example.com/deliverable"} />
            {isSubmitting && <div className="project-upload-progress" role="status"><span>{uploadProgress < 100 ? `Uploading files… ${uploadProgress}%` : "Saving submission…"}</span><progress max="100" value={uploadProgress} /></div>}
            <div className="project-submission-actions">
                <button className="button button-primary" disabled={isSubmitting || !message.trim()} type="submit">{isSubmitting ? "Submitting work..." : "Submit for Review"}</button>
                <button className="button button-quiet" disabled={isSubmitting} onClick={() => setIsFormOpen(false)} type="button">Cancel</button>
            </div>
        </form>}

        {canReview && loadState === "ready" && <div className="project-submission-review">
            <h3>Review the latest submission</h3>
            <label htmlFor={`review-feedback-${projectId}`}>Revision feedback (required to request changes)</label>
            <textarea className="filter-input dashboard-textarea" id={`review-feedback-${projectId}`} maxLength={5000} value={reviewFeedback} onChange={(event) => setReviewFeedback(event.target.value)} placeholder="Explain what needs to be changed before resubmission." />
            {isConfirmingApproval && <p className="form-hint" role="status">Approve this submission and mark the project complete? This does not release or transfer payment.</p>}
            <div className="project-submission-actions">
                <button className="button button-primary" disabled={reviewing !== null} onClick={() => void reviewSubmission("approve")} type="button">{reviewing === "approve" ? "Approving..." : isConfirmingApproval ? "Confirm approval" : "Approve Submission"}</button>
                {isConfirmingApproval && <button className="button button-quiet" onClick={() => setIsConfirmingApproval(false)} type="button">Cancel</button>}
                <button className="button button-quiet" disabled={reviewing !== null || !reviewFeedback.trim()} onClick={() => void reviewSubmission("request_revision")} type="button">{reviewing === "request_revision" ? "Sending request..." : "Request Revision"}</button>
            </div>
        </div>}
    </section>;
}
