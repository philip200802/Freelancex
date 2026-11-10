"use client";

import React, { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";

const categories = ["Development", "Design", "Writing", "Marketing"] as const;

export default function CreateProjectForm() {
    const router = useRouter();
    const [error, setError] = React.useState("");
    const [success, setSuccess] = React.useState("");
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [durationUnit, setDurationUnit] = React.useState<"days" | "weeks">("days");
    const submissionInFlight = useRef(false);
    const idempotencyKey = useRef("");

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setSuccess("");
        if (submissionInFlight.current) return;
        submissionInFlight.current = true;
        if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
        setIsSubmitting(true);
        const formElement = event.currentTarget;
        const form = new FormData(formElement);

        try {
            const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current }, body: JSON.stringify({ title: form.get("title"), description: form.get("description"), amount: Number(form.get("amount")), category: form.get("category"), duration: Number(form.get("duration")), durationUnit: form.get("durationUnit") }) });
            const result = await response.json() as { error?: string; task?: { _id?: string } };
            if (!response.ok) {
                setError(result.error || "Unable to publish this project.");
                return;
            }
            if (!result.task?._id) throw new Error("The project was created but the response was incomplete. Refresh My Jobs to confirm.");
            idempotencyKey.current = "";
            formElement.reset();
            setSuccess("Your job was published and is now available in the marketplace.");
            router.refresh();
        } catch (requestError) {
            setError(requestError instanceof TypeError
                ? "We could not confirm whether your job was published. Submit again to safely check."
                : requestError instanceof Error ? requestError.message : "The job could not be confirmed. Submit again to safely check.");
        } finally {
            submissionInFlight.current = false;
            setIsSubmitting(false);
        }
    }

    return <form className="dashboard-form" onSubmit={handleSubmit}><div className="dashboard-form-heading"><div><div className="eyebrow">Start a brief</div><h2>Post a new project</h2></div><span className="form-hint">Protected payments are coming next</span></div><label>Project title<input className="filter-input" name="title" placeholder="e.g. Brand identity for a fintech startup" required /></label><label>What needs to be done?<textarea className="filter-input dashboard-textarea" name="description" placeholder="Describe the outcome, context, and what a great delivery looks like." required /></label><div className="dashboard-form-row"><label>Category<select className="filter-input" defaultValue="Development" name="category">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Budget (NGN)<input className="filter-input" min="1" name="amount" placeholder="250000" required type="number" /></label></div><div className="dashboard-form-row"><label>Project duration<input className="filter-input" max={durationUnit === "weeks" ? "520" : "3650"} min="1" name="duration" placeholder="e.g. 7" required step="1" type="number" /></label><label>Duration unit<select className="filter-input" name="durationUnit" onChange={(event) => setDurationUnit(event.target.value as "days" | "weeks")} value={durationUnit}><option value="days">Days</option><option value="weeks">Weeks</option></select></label></div>{error && <p className="form-error" role="alert">{error}</p>}{success && <p className="success-message" role="status">{success} <Link href="/client/dashboard/jobs">View My Jobs</Link></p>}<button className="button button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Publishing..." : "Publish project"}</button></form>;
}