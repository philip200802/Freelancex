"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Job = {
    id: string;
    title: string;
    description: string;
    category: string;
    budget: number;
    posted: string;
};

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function JobBoard() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loadState, setLoadState] = useState<"loading" | "success" | "error">("loading");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("All categories");
    const [maximum, setMaximum] = useState("Any budget");
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function fetchJobs() {
            try {
                const response = await fetch("/api/tasks", { cache: "no-store", signal: controller.signal });
                if (!response.ok) throw new Error("Unable to load jobs right now.");
                const result = await response.json() as { tasks?: Array<{ _id: string; title: string; description: string; amount: number; category: string; createdAt: string }> };
                if (!Array.isArray(result.tasks)) throw new Error("The jobs response was invalid.");
                if (controller.signal.aborted) return;

                setJobs(result.tasks.map((task) => ({
                    id: task._id,
                    title: task.title,
                    description: task.description,
                    category: task.category === "Design" ? "Design & Brand" : task.category === "Writing" ? "Writing & Content" : task.category,
                    budget: task.amount,
                    posted: new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round((new Date(task.createdAt).getTime() - Date.now()) / 86400000), "day"),
                })));
                setLoadState("success");
            } catch {
                if (!controller.signal.aborted) setLoadState("error");
            }
        }

        void fetchJobs();
        return () => controller.abort();
    }, [retryCount]);

    const filteredJobs = useMemo(() => jobs.filter((job) => {
        const matchesQuery = `${job.title} ${job.description} ${job.category}`.toLowerCase().includes(query.toLowerCase());
        const matchesCategory = category === "All categories" || job.category === category;
        const matchesBudget = maximum === "Any budget" || job.budget <= Number(maximum);
        return matchesQuery && matchesCategory && matchesBudget;
    }), [category, jobs, maximum, query]);

    return <section className="jobs-layout">
        <aside className="filters">
            <label className="filter-label" htmlFor="category">Category</label>
            <select className="filter-select" id="category" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option>All categories</option><option>Development</option><option>Design &amp; Brand</option><option>Writing &amp; Content</option><option>Marketing</option>
            </select>
            <label className="filter-label" htmlFor="budget">Budget</label>
            <select className="filter-select" id="budget" value={maximum} onChange={(event) => setMaximum(event.target.value)}>
                <option>Any budget</option><option value="100000">Up to ₦100,000</option><option value="200000">Up to ₦200,000</option><option value="300000">Up to ₦300,000</option>
            </select>
            <button className="button button-quiet" onClick={() => { setCategory("All categories"); setMaximum("Any budget"); setQuery(""); }}>Clear filters</button>
        </aside>
        <div>
            <div className="jobs-toolbar">
                <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, skills, or keywords" aria-label="Search projects" />
                {loadState === "success" && <span className="jobs-count">{filteredJobs.length} projects</span>}
            </div>
            {loadState === "loading" && <div className="empty-state" role="status">Loading available jobs...</div>}
            {loadState === "error" && <div className="empty-state" role="alert"><p>Jobs are temporarily unavailable. Please try again.</p><button className="button button-primary" onClick={() => { setLoadState("loading"); setRetryCount((count) => count + 1); }}>Retry</button></div>}
            {loadState === "success" && jobs.length === 0 && <div className="empty-state"><strong>No jobs available right now.</strong><p>Please check back later for new opportunities.</p></div>}
            {loadState === "success" && jobs.length > 0 && filteredJobs.length === 0 && <div className="empty-state">No projects match those filters yet.</div>}
            {loadState === "success" && filteredJobs.length > 0 && <div className="job-grid">{filteredJobs.map((job) => <article className="job-card" key={job.id}>
                <div className="job-card-top"><div><span className="tag">{job.category}</span><h2>{job.title}</h2></div><div className="job-budget">{money.format(job.budget)}</div></div>
                <p>{job.description}</p>
                <div className="job-meta"><span>{job.posted}</span><span>Milestone protected</span><Link className="job-link" href={`/jobs/${job.id}`}>View details &rarr;</Link></div>
            </article>)}</div>}
        </div>
    </section>;
}
