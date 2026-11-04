import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefcaseBusiness, CheckCircle2, FileText, MessageCircle, Settings, Star, Wallet } from "lucide-react";
import DashboardShell, { type DashboardRole } from "./DashboardShell";
import CreateProjectForm from "@/app/dashboard/employer/CreateProjectForm";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Task from "@/models/Task";
import User from "@/models/User";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const roleNames: Record<DashboardRole, string> = { freelancer: "Freelancer", employer: "Client", admin: "Admin" };

const copy: Record<string, { title: string; description: string; icon: typeof BriefcaseBusiness; action?: { label: string; href: string }; }> = {
    proposals: { title: "Proposals", description: "Review proposal activity as it becomes available in your workspace.", icon: FileText },
    contracts: { title: "Contracts", description: "Keep agreements, deadlines, and delivery status together.", icon: CheckCircle2 },
    messages: { title: "Messages", description: "Your project conversations will appear here.", icon: MessageCircle },
    earnings: { title: "Earnings", description: "Track verified project earnings and transaction history.", icon: Wallet },
    reviews: { title: "Reviews", description: "Review feedback connected to completed work.", icon: Star },
    profile: { title: "My Profile", description: "Review your account details and profile information.", icon: Settings },
    settings: { title: "Settings", description: "Manage your account preferences and security.", icon: Settings },
    freelancers: { title: "Hired Freelancers", description: "Freelancers connected to your accepted contracts will appear here.", icon: BriefcaseBusiness },
    payments: { title: "Payments", description: "Review verified payment records associated with your account.", icon: Wallet },
    disputes: { title: "Disputes & Reports", description: "Review reported activity and dispute cases.", icon: CheckCircle2 },
    categories: { title: "Categories & Skills", description: "Manage the taxonomy used to organize marketplace work.", icon: Settings },
    activity: { title: "Activity Logs", description: "Review recorded platform activity and administrative actions.", icon: FileText },
    transactions: { title: "Transactions", description: "Monitor verified payment-provider transactions.", icon: Wallet },
};

function EmptyPanel({ title, message, action }: { title: string; message: string; action?: { label: string; href: string } }) {
    return <div className="dashboard-empty"><strong>{title}</strong><p>{message}</p>{action && <Link className="button button-primary" href={action.href}>{action.label}</Link>}</div>;
}

export default async function DashboardSectionPage({ role, section, searchParams }: { role: DashboardRole; section: string; searchParams?: Promise<{ q?: string }> }) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    if (user.role !== role) redirect(user.role === "employer" ? "/client/dashboard" : user.role === "freelancer" ? "/freelancer/dashboard" : "/admin/dashboard");
    await connectToDatabase();
    const profile = await User.findById(user.userId).select("name email firstName lastName country city role").lean();
    if (!profile) redirect("/login");
    const query = (await searchParams)?.q?.trim().toLowerCase() || "";
    const pageCopy = copy[section] || { title: section.replace(/-/g, " "), description: "Manage this part of your FreelanceX workspace.", icon: BriefcaseBusiness };
    const PageIcon = pageCopy.icon;

    if (role === "employer" && section === "post-job") return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Post a Job" description="Give independent professionals the context they need to do their best work."><section className="dashboard-create-section"><CreateProjectForm /></section></DashboardShell>;

    if (section === "jobs" && role === "employer") {
        const jobs = await Task.find({ employer: user.userId }).sort({ createdAt: -1 }).lean();
        const filtered = query ? jobs.filter((job) => `${job.title} ${job.description} ${job.category}`.toLowerCase().includes(query)) : jobs;
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="My Jobs" description="Manage the briefs you have published and keep their status visible."><div className="dashboard-toolbar"><form className="dashboard-inline-search"><input className="filter-input" defaultValue={query} name="q" placeholder="Search your jobs" /><button className="button button-primary" type="submit">Search</button></form><Link className="button button-primary" href="/client/dashboard/post-job">Post a Job</Link></div><section className="dashboard-panel"><div className="dashboard-table-heading"><span>{filtered.length} of {jobs.length} jobs</span><select className="filter-input"><option>All statuses</option><option>Open</option><option>In progress</option><option>Completed</option></select></div>{filtered.length ? <div className="dashboard-table">{filtered.map((job) => <Link className="dashboard-table-row" href={`/jobs/${job.id}`} key={job.id}><div><strong>{job.title}</strong><span>{job.category} &middot; {naira.format(job.amount)}</span></div><span className="status-badge">{job.status.replace("_", " ")}</span></Link>)}</div> : <EmptyPanel title={jobs.length ? "No matching jobs" : "You haven't posted any jobs yet."} message={jobs.length ? "Try a different search term." : "Create a clear brief and start finding the right talent."} action={{ label: "Post Your First Job", href: "/client/dashboard/post-job" }} />}</section></DashboardShell>;
    }

    if (section === "jobs" && role === "freelancer") {
        const jobs = await Task.find({ status: "open", employer: { $ne: user.userId } }).populate("employer", "name").sort({ createdAt: -1 }).lean();
        const filtered = query ? jobs.filter((job) => `${job.title} ${job.description} ${job.category}`.toLowerCase().includes(query)) : jobs;
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Find Jobs" description="Discover open projects that match your strengths."><div className="dashboard-toolbar"><form className="dashboard-inline-search"><input className="filter-input" defaultValue={query} name="q" placeholder="Search jobs by title or category" /><button className="button button-primary" type="submit">Search</button></form><select className="filter-input"><option>All categories</option><option>Development</option><option>Design</option><option>Writing</option><option>Marketing</option></select></div><section className="dashboard-job-grid">{filtered.length ? filtered.map((job) => <article className="dashboard-job-card" key={job.id}><span className="project-category">{job.category}</span><h2>{job.title}</h2><p>{job.description}</p><strong>{naira.format(job.amount)}</strong><Link className="button button-quiet" href={`/jobs/${job.id}`}>View Details &rarr;</Link></article>) : <div className="dashboard-panel"><EmptyPanel title="No open jobs yet" message="New opportunities will appear here when clients publish them." action={{ label: "Refresh jobs", href: "/freelancer/dashboard/jobs" }} /></div>}</section></DashboardShell>;
    }

    if (role === "admin" && section === "users") {
        const users = await User.find({}).select("name email role isVerified createdAt").sort({ createdAt: -1 }).limit(50).lean();
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Users" description="Review registered accounts and verification status."><div className="dashboard-toolbar"><form className="dashboard-inline-search"><input className="filter-input" name="q" placeholder="Search users" /><button className="button button-primary" type="submit">Search</button></form><span className="form-hint">{users.length} recent users</span></div><section className="dashboard-panel"><div className="dashboard-table">{users.length ? users.map((account) => <div className="dashboard-table-row" key={account.id}><div><strong>{account.name}</strong><span>{account.email}</span></div><span className="status-badge">{account.role} &middot; {account.isVerified ? "verified" : "unverified"}</span></div>) : <EmptyPanel title="No users found" message="Registered users will appear here." />}</div></section></DashboardShell>;
    }

    if (role === "admin" && section === "jobs") {
        const jobs = await Task.find({}).populate("employer", "name").sort({ createdAt: -1 }).limit(50).lean();
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Jobs" description="Moderate job listings using live task records."><section className="dashboard-panel"><div className="dashboard-table-heading"><span>{jobs.length} recent jobs</span><select className="filter-input"><option>All statuses</option><option>Open</option><option>Completed</option><option>Disputed</option></select></div><div className="dashboard-table">{jobs.length ? jobs.map((job) => <Link className="dashboard-table-row" href={`/jobs/${job.id}`} key={job.id}><div><strong>{job.title}</strong><span>{job.category} &middot; {naira.format(job.amount)}</span></div><span className="status-badge">{job.status.replace("_", " ")}</span></Link>) : <EmptyPanel title="No jobs yet" message="New job listings will appear here." />}</div></section></DashboardShell>;
    }

    return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={pageCopy.title} description={pageCopy.description}><section className="dashboard-section-layout"><div className="dashboard-panel dashboard-section-hero"><PageIcon aria-hidden="true" size={28} /><div><h2>{pageCopy.title}</h2><p>{pageCopy.description}</p></div></div><div className="dashboard-section-controls"><input className="filter-input" placeholder={`Search ${pageCopy.title.toLowerCase()}`} /><select className="filter-input"><option>All statuses</option><option>Active</option><option>Completed</option><option>Needs attention</option></select></div><EmptyPanel title={`No ${pageCopy.title.toLowerCase()} to show yet`} message={`When ${pageCopy.title.toLowerCase()} are connected to your account, they will appear here with actions and status details.`} /></section></DashboardShell>;
}
