import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Application from "@/models/Application";
import FreelancerProfile from "@/models/FreelancerProfile";
import Notification from "@/models/Notification";
import Task from "@/models/Task";
import User from "@/models/User";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const activeTaskStatuses = ["awaiting_funding", "funded", "in_progress", "submitted", "revision_requested"];
const taskCategories = ["Development", "Design", "Writing", "Marketing"];
type RecentApplication = { id: string; taskId: string; title: string; category: string; amount: number; status: "pending" | "accepted" | "rejected"; createdAt: Date };

function internalHref(href?: string) {
    return href?.startsWith("/") && !href.startsWith("//") ? href : "/freelancer/dashboard/notifications";
}

export default async function FreelancerDashboard() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "freelancer") redirect(currentUser.role === "employer" ? "/client/dashboard" : "/admin/dashboard");
    await connectToDatabase();

    const freelancerId = currentUser.userId;
    const [
        user,
        activeContracts,
        completedContracts,
        activeContractCount,
        completedContractCount,
        pendingReviewCount,
        applicationCount,
        legacyApplicationCount,
        recentApplications,
        legacyApplications,
        openJobCount,
        freelancerProfile,
        recentActivity,
        appliedTaskIds,
    ] = await Promise.all([
        User.findById(freelancerId).select("name email").lean(),
        Task.find({ freelancer: freelancerId, status: { $in: activeTaskStatuses } }).select("title category amount status updatedAt").sort({ updatedAt: -1 }).limit(5).lean(),
        Task.find({ freelancer: freelancerId, status: "completed" }).select("title category amount status updatedAt").sort({ updatedAt: -1 }).limit(5).lean(),
        Task.countDocuments({ freelancer: freelancerId, status: { $in: activeTaskStatuses } }),
        Task.countDocuments({ freelancer: freelancerId, status: "completed" }),
        Task.countDocuments({ freelancer: freelancerId, status: "submitted" }),
        Application.countDocuments({ freelancer: freelancerId }),
        Task.countDocuments({ freelancer: freelancerId, status: "pending_approval" }),
        Application.find({ freelancer: freelancerId }).populate("task", "title category amount").sort({ createdAt: -1 }).limit(5).lean(),
        Task.find({ freelancer: freelancerId, status: "pending_approval" }).select("title category amount createdAt").sort({ createdAt: -1 }).limit(5).lean(),
        Task.countDocuments({ status: "open", $or: [{ freelancer: { $exists: false } }, { freelancer: null }] }),
        FreelancerProfile.findOne({ user: freelancerId }).select("category").lean(),
        Notification.find({ recipient: freelancerId }).select("title body href createdAt").sort({ createdAt: -1 }).limit(5).lean(),
        Application.distinct("task", { freelancer: freelancerId }),
    ]);
    if (!user) redirect("/login");

    const applicationActivity: RecentApplication[] = [
        ...recentApplications.flatMap((application) => {
            const task = application.task;
            if (!task || typeof task !== "object" || !("_id" in task)) return [];
            return [{
                id: String(application._id),
                taskId: String(task._id),
                title: task.title,
                category: task.category,
                amount: task.amount,
                status: application.status,
                createdAt: application.createdAt,
            }];
        }),
        ...legacyApplications.map((task) => ({
            id: `legacy-${String(task._id)}`,
            taskId: String(task._id),
            title: task.title,
            category: task.category,
            amount: task.amount,
            status: "pending" as const,
            createdAt: task.createdAt,
        })),
    ].sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime()).slice(0, 5);

    const preferredCategory = taskCategories.find((category) => category.toLowerCase() === freelancerProfile?.category?.trim().toLowerCase());
    const availableJobFilter = {
        status: "open",
        $or: [{ freelancer: { $exists: false } }, { freelancer: null }],
        _id: { $nin: appliedTaskIds },
    };
    let recommendedJobs = await Task.find({
        ...availableJobFilter,
        ...(preferredCategory ? { category: preferredCategory } : {}),
    }).select("title category amount").sort({ createdAt: -1 }).limit(3).lean();
    if (recommendedJobs.length === 0 && preferredCategory) {
        recommendedJobs = await Task.find(availableJobFilter).select("title category amount").sort({ createdAt: -1 }).limit(3).lean();
    }

    return <DashboardShell
        role="freelancer"
        userName={user.name}
        userEmail={user.email}
        title="Make room for your best work."
        description="Find opportunities, keep active work visible, and build a reliable record of delivery."
    >
        <section className="dashboard-stat-grid freelancer-stat-grid">
            <article className="dashboard-stat-card"><span>My applications</span><strong>{applicationCount + legacyApplicationCount}</strong><small>Across all application statuses</small></article>
            <article className="dashboard-stat-card"><span>Active projects</span><strong>{activeContractCount}</strong><small>Funded, in progress, or awaiting review</small></article>
            <article className="dashboard-stat-card"><span>Pending submissions</span><strong>{pendingReviewCount}</strong><small>Work awaiting employer review</small></article>
            <article className="dashboard-stat-card"><span>Completed projects</span><strong>{completedContractCount}</strong><small>Approved projects assigned to you</small></article>
            <article className="dashboard-stat-card"><span>Open opportunities</span><strong>{openJobCount}</strong><small>Projects currently accepting applications</small></article>
        </section>
        <div className="dashboard-two-column">
            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Your work</span><h2>Active projects</h2></div><Link className="text-link" href="/freelancer/dashboard/contracts">View all</Link></div>
                {activeContracts.length ? <div className="dashboard-list">{activeContracts.map((contract) => <Link className="dashboard-list-row" href={`/freelancer/dashboard/projects/${String(contract._id)}`} key={String(contract._id)}><div><strong>{contract.title}</strong><span>{contract.category} &middot; {naira.format(contract.amount)}</span></div><span className={`status-badge status-${contract.status}`}>{contract.status.replaceAll("_", " ")}</span></Link>)}</div> : <div className="dashboard-empty"><strong>No active projects yet.</strong><p>Explore open projects and find work that fits your strengths.</p><Link className="button button-primary" href="/freelancer/dashboard/jobs">Find jobs</Link></div>}
            </section>
            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Picked for you</span><h2>Recommended opportunities</h2></div><Link className="text-link" href="/freelancer/dashboard/jobs">Browse all</Link></div>
                {recommendedJobs.length ? <div className="dashboard-list">{recommendedJobs.map((job) => <Link className="dashboard-list-row" href={`/freelancer/dashboard/jobs/${String(job._id)}`} key={String(job._id)}><div><strong>{job.title}</strong><span>{job.category} &middot; {naira.format(job.amount)}</span></div><span className="text-link">View job</span></Link>)}</div> : <div className="dashboard-empty"><strong>No new recommendations yet.</strong><p>New projects that match your profile will appear here.</p><Link className="button button-quiet" href="/freelancer/dashboard/profile">Update profile</Link></div>}
            </section>
        </div>
        <div className="dashboard-two-column">
            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Your activity</span><h2>Recent applications</h2></div><Link className="text-link" href="/freelancer/dashboard/applications">View all</Link></div>
                {applicationActivity.length ? <div className="dashboard-list">{applicationActivity.map((application) => {
                    const statusLabel = application.status === "pending" ? "Pending review" : application.status === "accepted" ? "Accepted" : "Not selected";
                    return <Link className="dashboard-list-row" href={`/freelancer/dashboard/jobs/${application.taskId}`} key={application.id}><div><strong>{application.title}</strong><span>{application.category} &middot; {naira.format(application.amount)}</span></div><span className={`status-badge status-${application.status}`}>{statusLabel}</span></Link>;
                })}</div> : <div className="dashboard-empty"><strong>No applications yet.</strong><p>Jobs you apply to will appear here as employers review them.</p><Link className="button button-quiet" href="/freelancer/dashboard/jobs">Find jobs</Link></div>}
            </section>
            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Delivered work</span><h2>Recently completed</h2></div><Link className="text-link" href="/freelancer/dashboard/completed">View all</Link></div>
                {completedContracts.length ? <div className="dashboard-list">{completedContracts.map((contract) => <Link className="dashboard-list-row" href={`/freelancer/dashboard/projects/${String(contract._id)}`} key={String(contract._id)}><div><strong>{contract.title}</strong><span>{contract.category} &middot; {naira.format(contract.amount)}</span></div><span className="status-badge status-completed">Completed</span></Link>)}</div> : <div className="dashboard-empty"><strong>No completed projects yet.</strong><p>Projects approved by clients will appear here.</p></div>}
            </section>
        </div>
        <section className="dashboard-panel">
            <div className="dashboard-panel-heading"><div><span className="panel-kicker">Latest updates</span><h2>Recent activity</h2></div><Link className="text-link" href="/freelancer/dashboard/notifications">All notifications</Link></div>
            {recentActivity.length ? <div className="dashboard-list">{recentActivity.map((item) => <Link className="dashboard-list-row" href={internalHref(item.href)} key={String(item._id)}><div><strong>{item.title}</strong><span>{item.body}</span></div><time dateTime={item.createdAt.toISOString()}>{item.createdAt.toLocaleDateString()}</time></Link>)}</div> : <div className="dashboard-empty"><strong>No recent activity.</strong><p>Updates about your applications and projects will appear here.</p></div>}
        </section>
    </DashboardShell>;
}
