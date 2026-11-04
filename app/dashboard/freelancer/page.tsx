import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Application from "@/models/Application";
import Task from "@/models/Task";
import User from "@/models/User";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default async function FreelancerDashboard() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "freelancer") redirect(currentUser.role === "employer" ? "/client/dashboard" : "/admin/dashboard");
    await connectToDatabase();
    const [user, assignedTasks, pendingApplications, legacyApplicationCount] = await Promise.all([
        User.findById(currentUser.userId).select("name email").lean(),
        Task.find({ freelancer: currentUser.userId }).sort({ updatedAt: -1 }).lean(),
        Application.find({ freelancer: currentUser.userId, status: "pending" }).populate("task", "title category amount").sort({ createdAt: -1 }).limit(5).lean(),
        Task.countDocuments({ freelancer: currentUser.userId, status: "pending_approval" }),
    ]);
    if (!user) redirect("/login");
    const activeContracts = assignedTasks.filter((task) => ["funded", "in_progress", "submitted"].includes(task.status));
    const completedContracts = assignedTasks.filter((task) => task.status === "completed");
    const earnings = completedContracts.reduce((total, contract) => total + contract.amount, 0);

    return <DashboardShell
        role="freelancer"
        userName={user.name}
        title="Make room for your best work."
        description="Find opportunities, keep active work visible, and build a reliable record of delivery."
    >
        <section className="dashboard-stat-grid">
            <article className="dashboard-stat-card"><span>Total earnings</span><strong>{naira.format(earnings)}</strong><small>Completed project value</small></article>
            <article className="dashboard-stat-card"><span>Active contracts</span><strong>{activeContracts.length}</strong><small>Funded or in progress</small></article>
            <article className="dashboard-stat-card"><span>Completed jobs</span><strong>{completedContracts.length}</strong><small>Approved projects</small></article>
            <article className="dashboard-stat-card"><span>My applications</span><strong>{pendingApplications.length + legacyApplicationCount}</strong><small>Waiting for employer review</small></article>
        </section>
        <div className="dashboard-two-column">
            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Your work</span><h2>Active contracts</h2></div><Link className="text-link" href="/freelancer/dashboard/contracts">View all</Link></div>
                {activeContracts.length ? <div className="dashboard-list">{activeContracts.slice(0, 5).map((contract) => <Link className="dashboard-list-row" href={`/jobs/${String(contract._id)}`} key={String(contract._id)}><div><strong>{contract.title}</strong><span>{contract.category} &middot; {naira.format(contract.amount)}</span></div><span className={`status-badge status-${contract.status}`}>{contract.status.replace("_", " ")}</span></Link>)}</div> : <div className="dashboard-empty"><strong>No active contracts yet.</strong><p>Explore open projects and find work that fits your strengths.</p><Link className="button button-primary" href="/jobs">Find jobs</Link></div>}
            </section>
            <aside className="dashboard-panel dashboard-quick-panel"><span className="panel-kicker">Available jobs</span><h2>Find your next move.</h2><p>Browse live projects and open the details page to submit an application.</p><Link className="button button-primary" href="/jobs">Browse available jobs</Link><Link className="button button-quiet" href="/freelancer/dashboard/profile">Complete profile</Link></aside>
        </div>
        <div className="dashboard-two-column">
            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Your activity</span><h2>My applications</h2></div><Link className="text-link" href="/freelancer/dashboard/applications">View all</Link></div>
                {pendingApplications.length ? <div className="dashboard-list">{pendingApplications.map((application) => <Link className="dashboard-list-row" href={`/jobs/${String(application.task._id)}`} key={String(application._id)}><div><strong>{application.task.title}</strong><span>{application.task.category} &middot; {naira.format(application.task.amount)}</span></div><span className="status-badge">Pending review</span></Link>)}</div> : <div className="dashboard-empty"><strong>No pending applications.</strong><p>Jobs you apply to will appear here while the employer reviews them.</p><Link className="button button-quiet" href="/jobs">Find jobs</Link></div>}
            </section>
            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Completed work</span><h2>My completed jobs</h2></div></div>
                {completedContracts.length ? <div className="dashboard-list">{completedContracts.map((contract) => <Link className="dashboard-list-row" href={`/jobs/${String(contract._id)}`} key={String(contract._id)}><div><strong>{contract.title}</strong><span>{contract.category} &middot; {naira.format(contract.amount)}</span></div><span className="status-badge">Completed</span></Link>)}</div> : <div className="dashboard-empty"><strong>No completed jobs yet.</strong><p>Completed work assigned to your account will appear here.</p></div>}
            </section>
        </div>
        <section className="dashboard-panel dashboard-placeholder-panel"><div className="dashboard-panel-heading"><div><span className="panel-kicker">From your activity</span><h2>Messages and reviews</h2></div></div><p>Project messages are available in your dashboard. Reviews are not yet supported by a review-record model.</p><Link className="text-link" href="/freelancer/dashboard/messages">Open messages</Link></section>
    </DashboardShell>;
}