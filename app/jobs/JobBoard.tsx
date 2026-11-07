"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Job = {
    id: string;
    title: string;
    description: string;
    category: string;
    budget: number;
    posted: string;
    employer: { id: string | null; name: string } | null;
};
type JobPagination = { page: number; pageSize: number; totalCount: number; totalPages: number };

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function JobBoard({ detailsHrefPrefix = "/jobs/" }: { detailsHrefPrefix?: string }) {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [pagination, setPagination] = useState<JobPagination>({ page: 1, pageSize: 9, totalCount: 0, totalPages: 0 });
    const [loadState, setLoadState] = useState<"loading" | "success" | "error">("loading");
    const [loadError, setLoadError] = useState("");
    const [query, setQuery] = useState("");
    const [submittedQuery, setSubmittedQuery] = useState("");
    const [category, setCategory] = useState("All categories");
    const [maximum, setMaximum] = useState("Any budget");
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function fetchJobs() {
            setLoadState("loading");
            try {
                const params = new URLSearchParams({ page: String(pagination.page) });
                if (submittedQuery) params.set("q", submittedQuery);
                if (category !== "All categories") params.set("category", category === "Design & Brand" ? "Design" : category === "Writing & Content" ? "Writing" : category);
                if (maximum !== "Any budget") params.set("maxBudget", maximum);
                const response = await fetch(`/api/tasks?${params.toString()}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as {
                    tasks?: Array<{ _id: string; title: string; description: string; amount: number; category: string; createdAt: string; employer?: { id: string | null; name: string } | null }>;
                    pagination?: JobPagination;
                    error?: string;
                };
                if (!response.ok) throw new Error(result.error || "Unable to load jobs right now.");
                if (!Array.isArray(result.tasks) || !result.pagination) throw new Error("The jobs response was invalid.");
                if (controller.signal.aborted) return;

                setJobs(result.tasks.map((task) => ({
                    id: task._id,
                    title: task.title,
                    description: task.description,
                    category: task.category === "Design" ? "Design & Brand" : task.category === "Writing" ? "Writing & Content" : task.category,
                    budget: task.amount,
                    posted: new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round((new Date(task.createdAt).getTime() - Date.now()) / 86400000), "day"),
                    employer: task.employer || null,
                })));
                setPagination(result.pagination);
                setLoadState("success");
            } catch (error) {
                if (!controller.signal.aborted) {
                    setLoadError(error instanceof Error ? error.message : "Unable to load jobs right now.");
                    setLoadState("error");
                    setJobs([]);
                }
            }
        }

        void fetchJobs();
        return () => controller.abort();
    }, [category, maximum, pagination.page, retryCount, submittedQuery]);

    function search(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPagination((current) => ({ ...current, page: 1 }));
        setSubmittedQuery(query.trim());
    }

    function resetFilters() {
        setCategory("All categories");
        setMaximum("Any budget");
        setQuery("");
        setSubmittedQuery("");
        setPagination((current) => ({ ...current, page: 1 }));
    }

    const startResult = pagination.totalCount === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
    const endResult = Math.min(pagination.page * pagination.pageSize, pagination.totalCount);

    return <section className="jobs-layout">
        <aside className="filters">
            <label className="filter-label" htmlFor="category">Category</label>
            <select className="filter-select" id="category" value={category} onChange={(event) => { setCategory(event.target.value); setPagination((current) => ({ ...current, page: 1 })); }}>
                <option>All categories</option><option>Development</option><option>Design &amp; Brand</option><option>Writing &amp; Content</option><option>Marketing</option>
            </select>
            <label className="filter-label" htmlFor="budget">Budget</label>
            <select className="filter-select" id="budget" value={maximum} onChange={(event) => { setMaximum(event.target.value); setPagination((current) => ({ ...current, page: 1 })); }}>
                <option>Any budget</option><option value="100000">Up to ₦100,000</option><option value="200000">Up to ₦200,000</option><option value="300000">Up to ₦300,000</option>
            </select>
            <button className="button button-quiet" onClick={resetFilters} type="button">Clear filters</button>
        </aside>
        <div>
            <form className="jobs-toolbar" onSubmit={search}>
                <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search job titles or descriptions" aria-label="Search projects" />
                <button className="button button-primary" type="submit">Search</button>
                {loadState === "success" && <span className="jobs-count">{startResult}-{endResult} of {pagination.totalCount} projects</span>}
            </form>
            {loadState === "loading" && <div className="empty-state" role="status">Loading available jobs...</div>}
            {loadState === "error" && <div className="empty-state" role="alert"><p>{loadError || "Jobs are temporarily unavailable. Please try again."}</p><button className="button button-primary" onClick={() => { setLoadState("loading"); setRetryCount((count) => count + 1); }} type="button">Retry</button></div>}
            {loadState === "success" && jobs.length === 0 && <div className="empty-state"><strong>No jobs match your search.</strong><p>Try clearing a filter or check back later for new opportunities.</p><button className="button button-quiet" onClick={resetFilters} type="button">Clear filters</button></div>}
            {loadState === "success" && jobs.length > 0 && <div className="job-grid">{jobs.map((job) => <article className="job-card" key={job.id}>
                <div className="job-card-top"><div><span className="tag">{job.category}</span><h2>{job.title}</h2></div><div className="job-budget">{money.format(job.budget)}</div></div>
                <p>{job.description}</p>
                <div className="job-meta"><span>{job.posted}</span><span>Accepting applications</span>{job.employer?.id && <Link className="job-link" href={`/profiles/${job.employer.id}`}>Client: {job.employer.name}</Link>}<Link className="job-link" href={`${detailsHrefPrefix}${job.id}`}>View details &rarr;</Link></div>
            </article>)}</div>}
            {loadState === "success" && pagination.totalPages > 1 && <nav aria-label="Job result pages" className="job-pagination">
                <button className="button button-quiet" disabled={pagination.page <= 1} onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))} type="button">Previous</button>
                <span>Page {pagination.page} of {pagination.totalPages}</span>
                <button className="button button-quiet" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))} type="button">Next</button>
            </nav>}
        </div>
    </section>;
}
