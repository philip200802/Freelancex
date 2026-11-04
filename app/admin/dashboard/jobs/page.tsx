import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Task from "@/models/Task";
import User from "@/models/User";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "admin") {
        redirect(currentUser.role === "employer" ? "/client/dashboard" : "/freelancer/dashboard");
    }

    await connectToDatabase();
    const [admin, jobs] = await Promise.all([
        User.findById(currentUser.userId).select("name email").lean(),
        Task.find({}).select("title category amount status createdAt employer freelancer").sort({ createdAt: -1 }).lean(),
    ]);
    if (!admin) redirect("/login");

    const userIds = [...new Set(jobs.flatMap((job) => [job.employer.toString(), ...(job.freelancer ? [job.freelancer.toString()] : [])]))];
    const users = await User.find({ _id: { $in: userIds } }).select("name").lean();
    const namesById = new Map(users.map((user) => [user._id.toString(), user.name]));

    return <DashboardShell role="admin" userName={admin.name} userEmail={admin.email} title="Jobs" description="Review job records across the FreelanceX marketplace.">
        <section className="dashboard-panel">
            <div className="dashboard-table-heading"><span>{jobs.length} jobs</span></div>
            {jobs.length ? <div className="dashboard-table">{jobs.map((job) => <Link className="dashboard-table-row" href={`/jobs/${job._id.toString()}`} key={job._id.toString()}>
                <div>
                    <strong>{job.title}</strong>
                    <span>{job.category} &middot; {naira.format(job.amount)} &middot; Employer: {namesById.get(job.employer.toString()) || "Unknown"}</span>
                    {job.freelancer && <span>Freelancer: {namesById.get(job.freelancer.toString()) || "Unknown"}</span>}
                </div>
                <span className="status-badge">{job.status.replace("_", " ")}</span>
            </Link>)}</div> : <div className="dashboard-empty"><strong>No jobs yet.</strong><p>Job records will appear here for platform moderation.</p></div>}
        </section>
    </DashboardShell>;
}
