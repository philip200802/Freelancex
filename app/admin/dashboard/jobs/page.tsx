import Link from "next/link";
import { redirect } from "next/navigation";
import mongoose from "mongoose";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, CheckCircle2, CircleDot, ShieldAlert, WalletCards } from "lucide-react";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Task from "@/models/Task";
import User from "@/models/User";

const pageSize = 10;
const categories = ["Development", "Design", "Writing", "Marketing"] as const;
const statuses = ["pending_approval", "open", "awaiting_funding", "funded", "in_progress", "submitted", "revision_requested", "completed", "disputed", "cancelled"] as const;
const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const statusLabels: Record<string, string> = {
    pending_approval: "Pending approval",
    awaiting_funding: "Awaiting funding",
    in_progress: "In progress",
};
type JobFilter = {
    status?: typeof statuses[number];
    category?: typeof categories[number];
    $or?: Array<{
        title?: RegExp;
        description?: RegExp;
        employerNameSnapshot?: RegExp;
        freelancerNameSnapshot?: RegExp;
        employer?: { $in: mongoose.Types.ObjectId[] };
        freelancer?: { $in: mongoose.Types.ObjectId[] };
    }>;
};

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatStatus(status: string) {
    return statusLabels[status] || status.replace(/_/g, " ");
}

function pageHref(page: number, query: string, status: string, category: string) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return `/admin/dashboard/jobs${search ? `?${search}` : ""}`;
}

export default async function AdminJobsPage({ searchParams }: {
    searchParams: Promise<{ q?: string; status?: string; category?: string; page?: string }>;
}) {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "admin") {
        redirect(currentUser.role === "employer" ? "/client/dashboard" : "/freelancer/dashboard");
    }

    await connectToDatabase();
    const params = await searchParams;
    const query = params.q?.trim().slice(0, 100) || "";
    const status = statuses.find((item) => item === params.status) || "";
    const category = categories.find((item) => item === params.category) || "";
    const parsedPage = Number.parseInt(params.page || "1", 10);
    const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const regex = query ? new RegExp(escapeRegex(query), "i") : null;
    const filter: JobFilter = {};

    if (status) filter.status = status;
    if (category) filter.category = category;
    if (regex) {
        const matchingUsers = await User.find({ $or: [{ name: regex }, { email: regex }] }).select("_id").lean();
        const matchingUserIds = matchingUsers.map((user) => user._id);
        filter.$or = [
            { title: regex },
            { description: regex },
            { employerNameSnapshot: regex },
            { freelancerNameSnapshot: regex },
            ...(matchingUserIds.length ? [{ employer: { $in: matchingUserIds } }, { freelancer: { $in: matchingUserIds } }] : []),
        ];
    }

    const [admin, totalJobs, allJobsTotal, groupedStatuses] = await Promise.all([
        User.findById(currentUser.userId).select("name email").lean(),
        Task.countDocuments(filter),
        Task.countDocuments({}),
        Task.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    if (!admin) redirect("/login");

    const counts = new Map(groupedStatuses.map((item) => [item._id, item.count]));
    const pageCount = Math.max(1, Math.ceil(totalJobs / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const jobs = await Task.find(filter)
        .select("title description category amount status createdAt employer freelancer employerNameSnapshot freelancerNameSnapshot")
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean();
    const userIds = [...new Set(jobs.flatMap((job) => [job.employer?.toString(), job.freelancer?.toString()].filter((id): id is string => Boolean(id))))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name").lean() : [];
    const namesById = new Map(users.map((user) => [user._id.toString(), user.name]));
    const jobCards = jobs.map((job) => ({
        id: job._id.toString(),
        title: job.title,
        description: job.description,
        category: job.category,
        amount: job.amount,
        status: job.status,
        createdAt: job.createdAt,
        employer: job.employerNameSnapshot || (job.employer ? namesById.get(job.employer.toString()) : null) || "Unknown",
        freelancer: job.freelancerNameSnapshot || (job.freelancer ? namesById.get(job.freelancer.toString()) : null) || "Unassigned",
    }));

    const summary = [
        { label: "Total Jobs", value: allJobsTotal, icon: BriefcaseBusiness },
        { label: "Open Jobs", value: counts.get("open") || 0, icon: CircleDot },
        { label: "Funded Jobs", value: counts.get("funded") || 0, icon: WalletCards },
        { label: "Completed Jobs", value: counts.get("completed") || 0, icon: CheckCircle2 },
        { label: "Disputed Jobs", value: counts.get("disputed") || 0, icon: ShieldAlert },
    ];

    return <DashboardShell role="admin" userName={admin.name} userEmail={admin.email} title="Job Management" description="Manage, review and monitor all jobs posted on FreelanceX.">
        <section className="admin-jobs-summary" aria-label="Job status summary">
            {summary.map(({ label, value, icon: Icon }) => <article className="admin-jobs-summary-card" key={label}>
                <span>{label}</span>
                <div><strong>{value.toLocaleString()}</strong><Icon aria-hidden="true" size={20} /></div>
            </article>)}
        </section>

        <section className="dashboard-panel admin-jobs-panel">
            <form className="admin-jobs-filters" action="/admin/dashboard/jobs">
                <label className="admin-jobs-search">Search jobs, employers or freelancers
                    <input className="filter-input" type="search" name="q" defaultValue={query} placeholder="Search by title or person" />
                </label>
                <label>Status
                    <select className="filter-input" name="status" defaultValue={status}>
                        <option value="">All statuses</option>
                        {statuses.map((item) => <option key={item} value={item}>{formatStatus(item)}</option>)}
                    </select>
                </label>
                <label>Category
                    <select className="filter-input" name="category" defaultValue={category}>
                        <option value="">All categories</option>
                        {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                </label>
                <div className="admin-jobs-filter-actions">
                    <button className="button button-primary" type="submit">Apply filters</button>
                    <Link className="button button-quiet" href="/admin/dashboard/jobs">Clear</Link>
                </div>
            </form>

            <div className="admin-jobs-results-heading">
                <div><h2>Jobs</h2><span>{totalJobs.toLocaleString()} matching records</span></div>
                <span>Page {page} of {pageCount}</span>
            </div>

            {jobCards.length ? <>
                <div className="admin-jobs-table-wrap">
                    <table className="admin-jobs-table">
                        <thead><tr><th>Job</th><th>Category</th><th>Budget</th><th>Employer</th><th>Freelancer</th><th>Status</th><th>Date posted</th><th><span className="sr-only">Action</span></th></tr></thead>
                        <tbody>{jobCards.map((job) => <tr key={job.id}>
                            <td><strong className="admin-jobs-title">{job.title}</strong><span className="admin-jobs-description">{job.description}</span></td>
                            <td>{job.category}</td>
                            <td>{naira.format(job.amount)}</td>
                            <td>{job.employer}</td>
                            <td>{job.freelancer}</td>
                            <td><span className={`status-badge status-${job.status}`}>{formatStatus(job.status)}</span></td>
                            <td>{new Date(job.createdAt).toLocaleDateString()}</td>
                            <td><Link className="admin-jobs-detail-link" href={`/admin/dashboard/jobs/${job.id}`}>Details <ArrowRight aria-hidden="true" size={15} /></Link></td>
                        </tr>)}</tbody>
                    </table>
                </div>
                <div className="admin-jobs-mobile-list">{jobCards.map((job) => <article className="admin-jobs-mobile-card" key={job.id}>
                    <div className="admin-jobs-mobile-title"><strong>{job.title}</strong><span className={`status-badge status-${job.status}`}>{formatStatus(job.status)}</span></div>
                    <p className="admin-jobs-description">{job.description}</p>
                    <dl>
                        <div><dt>Category</dt><dd>{job.category}</dd></div>
                        <div><dt>Budget</dt><dd>{naira.format(job.amount)}</dd></div>
                        <div><dt>Employer</dt><dd>{job.employer}</dd></div>
                        <div><dt>Freelancer</dt><dd>{job.freelancer}</dd></div>
                        <div><dt>Date posted</dt><dd>{new Date(job.createdAt).toLocaleDateString()}</dd></div>
                    </dl>
                    <Link className="button button-quiet admin-jobs-mobile-action" href={`/admin/dashboard/jobs/${job.id}`}>View details <ArrowRight aria-hidden="true" size={15} /></Link>
                </article>)}</div>
            </> : <div className="dashboard-empty"><strong>{totalJobs ? "No jobs match these filters." : "No jobs yet."}</strong><p>{totalJobs ? "Clear or adjust the search and filters to see job records." : "Job records will appear here when they are posted."}</p></div>}

            {totalJobs > 0 && <nav className="admin-jobs-pagination" aria-label="Job pages">
                {page > 1 ? <Link className="button button-quiet" href={pageHref(page - 1, query, status, category)}><ArrowLeft aria-hidden="true" size={15} />Previous</Link> : <span />}
                <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalJobs)} of {totalJobs.toLocaleString()}</span>
                {page < pageCount ? <Link className="button button-quiet" href={pageHref(page + 1, query, status, category)}>Next<ArrowRight aria-hidden="true" size={15} /></Link> : <span />}
            </nav>}
        </section>
    </DashboardShell>;
}
