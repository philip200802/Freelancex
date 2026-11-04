import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import CreateProjectForm from "./CreateProjectForm";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Task from "@/models/Task";
import User from "@/models/User";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default async function EmployerDashboard() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "employer") redirect(currentUser.role === "freelancer" ? "/freelancer/dashboard" : "/admin/dashboard");
    await connectToDatabase();
    const [user, projects] = await Promise.all([User.findById(currentUser.userId).select("name email").lean(), Task.find({ employer: currentUser.userId }).sort({ createdAt: -1 }).lean()]);
    if (!user) redirect("/login");
    const activeCount = projects.filter((project) => ["funded", "in_progress", "submitted"].includes(project.status)).length;
    const completedCount = projects.filter((project) => project.status === "completed").length;
    const totalSpent = projects.filter((project) => project.status === "completed").reduce((total, project) => total + project.amount, 0);

    return <DashboardShell role="employer" userName={user.name} title="Keep good work moving." description="Post clear jobs, review your projects, and keep client-side work organized."><section className="dashboard-stat-grid"><article className="dashboard-stat-card"><span>Total jobs</span><strong>{projects.length}</strong><small>Created by you</small></article><article className="dashboard-stat-card"><span>Active projects</span><strong>{activeCount}</strong><small>Funded or in progress</small></article><article className="dashboard-stat-card"><span>Completed</span><strong>{completedCount}</strong><small>Approved projects</small></article><article className="dashboard-stat-card"><span>Total spent</span><strong>{naira.format(totalSpent)}</strong><small>Completed project value</small></article></section><div className="dashboard-two-column"><section className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="panel-kicker">Your workspace</span><h2>Recent jobs</h2></div><Link className="text-link" href="/client/dashboard/jobs">View all</Link></div>{projects.length ? <div className="dashboard-list">{projects.slice(0, 5).map((project) => <Link className="dashboard-list-row" href={`/jobs/${project.id}`} key={project.id}><div><strong>{project.title}</strong><span>{project.category} &middot; {naira.format(project.amount)}</span></div><span className={`status-badge status-${project.status}`}>{project.status.replace("_", " ")}</span></Link>)}</div> : <div className="dashboard-empty"><strong>Your first job starts here.</strong><p>Post a brief and find the independent talent to move it forward.</p><Link className="button button-primary" href="#post-job">Post a job</Link></div>}</section><aside className="dashboard-panel dashboard-quick-panel"><span className="panel-kicker">Quick actions</span><h2>Make the next move.</h2><p>These workflows will stay connected to your client records as the marketplace grows.</p><Link className="button button-primary" href="#post-job">Post a job</Link><Link className="button button-quiet" href="/jobs">Browse projects</Link></aside></div><section className="dashboard-panel dashboard-placeholder-panel"><div className="dashboard-panel-heading"><div><span className="panel-kicker">From your activity</span><h2>Proposals, messages, and contracts</h2></div></div><p>Those records are not yet present in the current database, so this dashboard does not invent placeholder counts.</p></section><section id="post-job" className="dashboard-create-section"><CreateProjectForm /></section></DashboardShell>;
}