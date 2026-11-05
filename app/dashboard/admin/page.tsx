import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import AdminActivityLog from "@/models/AdminActivityLog";
import PaymentTransaction from "@/models/PaymentTransaction";
import Task from "@/models/Task";
import User from "@/models/User";

export default async function AdminDashboard() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "admin") redirect(currentUser.role === "employer" ? "/client/dashboard" : "/freelancer/dashboard");
    await connectToDatabase();
    const activeUserFilter = { isActive: { $ne: false } };
    const [user, totalUsers, freelancers, employers, totalJobs, openJobs, verifiedTransactions, activityCount] = await Promise.all([
        User.findById(currentUser.userId).select("name email").lean(),
        User.countDocuments(activeUserFilter),
        User.countDocuments({ ...activeUserFilter, role: "freelancer" }),
        User.countDocuments({ ...activeUserFilter, role: "employer" }),
        Task.countDocuments(),
        Task.countDocuments({ status: "open" }),
        PaymentTransaction.countDocuments({ status: "success" }),
        AdminActivityLog.countDocuments(),
    ]);
    if (!user) redirect("/login");

    return <DashboardShell role="admin" userName={user.name} userEmail={user.email} title="Keep the marketplace trustworthy." description="Review platform activity from authorized, database-backed records.">
        <section className="dashboard-stat-grid">
            <article className="dashboard-stat-card"><span>Active users</span><strong>{totalUsers}</strong><small>Live accounts</small></article>
            <article className="dashboard-stat-card"><span>Freelancers</span><strong>{freelancers}</strong><small>Active professional accounts</small></article>
            <article className="dashboard-stat-card"><span>Clients</span><strong>{employers}</strong><small>Active employer accounts</small></article>
            <article className="dashboard-stat-card"><span>Open jobs</span><strong>{openJobs}</strong><small>{totalJobs} jobs total</small></article>
        </section>
        <div className="dashboard-two-column">
            <section className="dashboard-panel">
                <div className="dashboard-panel-heading"><div><span className="panel-kicker">Platform activity</span><h2>Current coverage</h2></div><Link className="text-link" href="/admin/dashboard/users">Manage users</Link></div>
                <div className="admin-coverage-list">
                    <div><span>Users and roles</span><strong>Connected</strong></div>
                    <div><span>Jobs and statuses</span><strong>Connected</strong></div>
                    <div><span>Paystack payments</span><strong>{verifiedTransactions} verified</strong></div>
                    <div><span>Admin activity</span><strong>{activityCount} records</strong></div>
                    <div><span>Messages</span><strong>Connected</strong></div>
                    <div><span>Disputes and reports</span><strong>Not implemented</strong></div>
                </div>
            </section>
            <aside className="dashboard-panel dashboard-quick-panel">
                <span className="panel-kicker">Admin actions</span><h2>Moderate with context.</h2>
                <p>Transactions only appear after Paystack initialization and provider verification; no payment activity is fabricated.</p>
                <Link className="button button-primary" href="/admin/dashboard/users">Review users</Link>
                <Link className="button button-quiet" href="/admin/dashboard/transactions">View transactions</Link>
            </aside>
        </div>
        <section className="dashboard-panel dashboard-placeholder-panel"><span className="panel-kicker">Audit boundary</span><h2>Protected administration</h2><p>Access is checked on the server from the signed session role. Admin accounts cannot be created through public registration.</p></section>
    </DashboardShell>;
}