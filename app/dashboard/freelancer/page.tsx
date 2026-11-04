import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Task from "@/models/Task";
import User from "@/models/User";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default async function FreelancerDashboard() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "freelancer") redirect(currentUser.role === "employer" ? "/client/dashboard" : "/admin/dashboard");
    await connectToDatabase();
    const [user, contracts] = await Promise.all([User.findById(currentUser.userId).select("name email").lean(), Task.find({ freelancer: currentUser.userId }).sort({ updatedAt: -1 }).lean()]);
    if (!user) redirect("/login");
    const activeContracts = contracts.filter((contract) => ["funded", "in_progress", "submitted"].includes(contract.status));
    const completedContracts = contracts.filter((contract) => contract.status === "completed");
    const earnings = completedContracts.reduce((total, contract) => total + contract.amount, 0);

    return <DashboardShell role="freelancer" userName={user.name} title="Make room for your best work." description="Find opportunities, keep active work visible, and build a reliable record of delivery."><section className="dashboard-stat-grid"><article className="dashboard-stat-card"><span>Total earnings</span><strong>{naira.format(earnings)}</strong><small>Completed project value</small></article><article className="dashboard-stat-card"><span>Active contracts</span><strong>{activeContracts.length}</strong><small>Funded or in progress</small></article><article className="dashboard-stat-card"><span>Completed jobs</span><strong>{completedContracts.length}</strong><small>Approved projects</small></article><article className="dashboard-stat-card"><span>Pending proposals</span><strong>—</strong><small>Proposal records are not connected yet</small></article></section><div className="dashboard-two-column"><section className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="panel-kicker">Your work</span><h2>Active contracts</h2></div><Link className="text-link" href="/freelancer/dashboard/contracts">View all</Link></div>{activeContracts.length ? <div className="dashboard-list">{activeContracts.slice(0, 5).map((contract) => <Link className="dashboard-list-row" href={`/jobs/${contract.id}`} key={contract.id}><div><strong>{contract.title}</strong><span>{contract.category} &middot; {naira.format(contract.amount)}</span></div><span className={`status-badge status-${contract.status}`}>{contract.status.replace("_", " ")}</span></Link>)}</div> : <div className="dashboard-empty"><strong>No active contracts yet.</strong><p>Explore open projects and find work that fits your strengths.</p><Link className="button button-primary" href="/jobs">Find jobs</Link></div>}</section><aside className="dashboard-panel dashboard-quick-panel"><span className="panel-kicker">Quick actions</span><h2>Find your next move.</h2><p>Browse live projects and open the details page to submit an application.</p><Link className="button button-primary" href="/jobs">Find jobs</Link><Link className="button button-quiet" href="/freelancer/dashboard/profile">Complete profile</Link></aside></div><section className="dashboard-panel dashboard-placeholder-panel"><div className="dashboard-panel-heading"><div><span className="panel-kicker">From your activity</span><h2>Messages, proposals, and reviews</h2></div></div><p>These features will populate from their dedicated records once those models are connected to the dashboard.</p></section></DashboardShell>;
}