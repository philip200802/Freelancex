import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Application from "@/models/Application";
import Task from "@/models/Task";
import User from "@/models/User";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const activeProjectStatuses = ["awaiting_funding", "funded", "in_progress", "submitted", "revision_requested", "disputed"];

export default async function EmployerDashboard() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "employer") redirect(currentUser.role === "freelancer" ? "/freelancer/dashboard" : "/admin/dashboard");
    await connectToDatabase();
    const [user, projects, pendingApplications, legacyApplications] = await Promise.all([
        User.findById(currentUser.userId).select("name email").lean(),
        Task.find({ employer: currentUser.userId }).sort({ createdAt: -1 }).lean(),
        Application.countDocuments({ employer: currentUser.userId, status: "pending" }),
        Task.countDocuments({ employer: currentUser.userId, status: "pending_approval" }),
    ]);
    if (!user) redirect("/login");
    const activeCount = projects.filter((project) => !project.isDeleted && activeProjectStatuses.includes(project.status)).length;
    const completedCount = projects.filter((project) => project.status === "completed").length;
    return <DashboardShell role="employer" userName={user.name} title="Keep good work moving." description="Post clear jobs, review your projects, and keep client-side work organized."><section className="dashboard-stat-grid"><article className="dashboard-stat-card"><span>Total jobs</span><strong>{projects.length}</strong><small>Created by you</small></article><article className="dashboard-stat-card"><span>Active projects</span><strong>{activeCount}</strong><small>Funded or in progress</small></article><article className="dashboard-stat-card"><span>Completed</span><strong>{completedCount}</strong><small>Approved projects</small></article><article className="dashboard-stat-card"><span>Pending applications</span><strong>{pendingApplications + legacyApplications}</strong><small><Link href="/client/dashboard/applications">Review applications</Link></small></article></section><div className="dashboard-two-column"><section className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="panel-kicker">Your workspace</span><h2>Recent jobs</h2></div><Link className="text-link" href="/client/dashboard/jobs">View all</Link></div>    {projects.length ? <div className="dashboard-list">{projects.slice(0, 5).map((project) => <Link className="dashboard-list-row" href={`/client/dashboard/projects/${String(project._id)}`} key={String(project._id)}><div><strong>{project.title}</strong><span>{project.category} &middot; {naira.format(project.amount)}</span></div><span className={`status-badge status-${project.status}`}>{project.status.replace("_", " ")}</span></Link>)}</div> : <div className="dashboard-empty"><strong>Your first job starts here.</strong><p>Post a brief and find the independent talent to move it forward.</p><Link className="button button-primary" href="/client/dashboard/post-job">Post a job</Link></div>}</section><aside className="dashboard-panel dashboard-quick-panel"><span className="panel-kicker">Quick actions</span><h2>Make the next move.</h2><p>Manage your published jobs and incoming applications.</p><Link className="button button-primary" href="/client/dashboard/post-job">Post a job</Link><Link className="button button-quiet" href="/client/dashboard/applications">Review applications</Link></aside></div><section className="dashboard-panel dashboard-placeholder-panel"><div className="dashboard-panel-heading"><div><span className="panel-kicker">From your activity</span><h2>Messages and contracts</h2></div></div><p>Messages and project status are available in their dashboard sections.</p><Link className="text-link" href="/client/dashboard/messages">Open messages</Link></section></DashboardShell>;
}
