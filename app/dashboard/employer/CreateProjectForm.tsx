"use client";

import React, { FormEvent } from "react";
import { useRouter } from "next/navigation";

const categories = ["Development", "Design", "Writing", "Marketing"] as const;

export default function CreateProjectForm() {
    const router = useRouter();
    const [error, setError] = React.useState("");
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setIsSubmitting(true);
        const form = new FormData(event.currentTarget);

        try {
            const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: form.get("title"), description: form.get("description"), amount: Number(form.get("amount")), category: form.get("category") }) });
            const result = await response.json() as { error?: string };
            if (!response.ok) {
                setError(result.error || "Unable to publish this project.");
                return;
            }
            event.currentTarget.reset();
            router.refresh();
        } catch {
            setError("Unable to reach FreelanceX. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    }

    return <form className="dashboard-form" onSubmit={handleSubmit}><div className="dashboard-form-heading"><div><div className="eyebrow">Start a brief</div><h2>Post a new project</h2></div><span className="form-hint">Protected payments are coming next</span></div><label>Project title<input className="filter-input" name="title" placeholder="e.g. Brand identity for a fintech startup" required /></label><label>What needs to be done?<textarea className="filter-input dashboard-textarea" name="description" placeholder="Describe the outcome, context, and what a great delivery looks like." required /></label><div className="dashboard-form-row"><label>Category<select className="filter-input" defaultValue="Development" name="category">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Budget (NGN)<input className="filter-input" min="1" name="amount" placeholder="250000" required type="number" /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Publishing..." : "Publish project"}</button></form>;
}