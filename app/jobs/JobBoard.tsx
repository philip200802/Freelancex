"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Job = {
    id?: string;
    title: string;
    description: string;
    category: string;
    budget: number;
    duration: string;
    posted: string;
};

const sampleJobs: Job[] = [
    { title: "Build a conversion-focused landing page", description: "We need a frontend partner to turn our product story into a fast, clear marketing page.", category: "Development", budget: 180000, duration: "2-3 weeks", posted: "2 hours ago" },
    { title: "Brand identity for a climate startup", description: "Create a flexible visual system that helps a climate team explain complex work simply.", category: "Design & Brand", budget: 320000, duration: "4-6 weeks", posted: "5 hours ago" },
    { title: "Write our founder story and launch emails", description: "Shape the story behind our product and turn it into a warm, compelling launch sequence.", category: "Writing & Content", budget: 95000, duration: "1-2 weeks", posted: "1 day ago" },
    { title: "Go-to-market plan for a B2B SaaS", description: "Help us find the sharpest path to our first 100 customers with a practical marketing plan.", category: "Marketing", budget: 240000, duration: "3-4 weeks", posted: "1 day ago" },
    { title: "Design a mobile onboarding experience", description: "Make the first five minutes of our app feel intuitive, useful, and distinctly ours.", category: "Design & Brand", budget: 210000, duration: "2-4 weeks", posted: "2 days ago" },
];

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function JobBoard() {
    const [jobs, setJobs] = useState<Job[]>(sampleJobs);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("All categories");
    const [maximum, setMaximum] = useState("Any budget");
    useEffect(() => {
        let isCurrent = true;
        fetch("/api/tasks")
            .then((response) => response.ok ? response.json() as Promise<{ tasks?: Array<{ _id: string; title: string; description: string; amount: number; category: string; createdAt: string }> }> : null)
            .then((result) => {
                if (!isCurrent || !result?.tasks?.length) {
                    return;
                }

                setJobs(result.tasks.map((task) => ({
                    id: task._id,
                    title: task.title,
                    description: task.description,
                    category: task.category === "Design" ? "Design & Brand" : task.category === "Writing" ? "Writing & Content" : task.category,
                    budget: task.amount,
                    duration: "Flexible timeline",
                    posted: new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round((new Date(task.createdAt).getTime() - Date.now()) / 86400000), "day"),
                })));
            })
            .catch(() => undefined);

        return () => { isCurrent = false; };
    }, []);

    const filteredJobs = useMemo(() => jobs.filter((job) => {
        const matchesQuery = `${job.title} ${job.description} ${job.category}`.toLowerCase().includes(query.toLowerCase());
        const matchesCategory = category === "All categories" || job.category === category;
        const matchesBudget = maximum === "Any budget" || job.budget <= Number(maximum);
        return matchesQuery && matchesCategory && matchesBudget;
    }), [category, maximum, query]);

    return <section className="jobs-layout"><aside className="filters"><label className="filter-label" htmlFor="category">Category</label><select className="filter-select" id="category" value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option><option>Development</option><option>Design & Brand</option><option>Writing & Content</option><option>Marketing</option></select><label className="filter-label" htmlFor="budget">Budget</label><select className="filter-select" id="budget" value={maximum} onChange={(event) => setMaximum(event.target.value)}><option>Any budget</option><option value="100000">Up to ₦100,000</option><option value="200000">Up to ₦200,000</option><option value="300000">Up to ₦300,000</option></select><button className="button button-quiet" onClick={() => { setCategory("All categories"); setMaximum("Any budget"); setQuery(""); }}>Clear filters</button></aside><div><div className="jobs-toolbar"><input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, skills, or keywords" aria-label="Search projects" /><span className="jobs-count">{filteredJobs.length} projects</span></div><div className="job-grid">{filteredJobs.map((job) => <article className="job-card" key={job.title}><div className="job-card-top"><div><span className="tag">{job.category}</span><h2>{job.title}</h2></div><div className="job-budget">{money.format(job.budget)}</div></div><p>{job.description}</p><div className="job-meta"><span>{job.duration}</span><span>{job.posted}</span><span>Milestone protected</span>{job.id && <Link className="job-link" href={`/jobs/${job.id}`}>View details &rarr;</Link>}</div></article>)}{filteredJobs.length === 0 && <div className="empty-state">No projects match those filters yet.</div>}</div></div></section>;
}
