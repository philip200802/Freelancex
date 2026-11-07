import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, BriefcaseBusiness, CheckCircle2, FileText, Mail, MessageCircle, Settings, Star, Wallet } from "lucide-react";
import AccountPanel from "@/components/dashboard/AccountPanel";
import ApplicationList from "@/components/dashboard/ApplicationList";
import ClientJobsManager from "@/components/dashboard/ClientJobsManager";
import AdminDisputesPage from "@/components/dashboard/AdminDisputesPage";
import AdminEmailDeliveryPage from "@/components/dashboard/AdminEmailDeliveryPage";
import DisputesDashboard from "@/components/dashboard/DisputesDashboard";
import DashboardShell, { type DashboardRole } from "@/components/dashboard/DashboardShell";
import MessagesPanel from "@/components/dashboard/MessagesPanel";
import NotificationsList from "@/components/dashboard/NotificationsList";
import PaymentsHistory from "@/components/dashboard/PaymentsHistory";
import CreateProjectForm from "@/app/dashboard/employer/CreateProjectForm";
import JobBoard from "@/app/jobs/JobBoard";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Task from "@/models/Task";
import User from "@/models/User";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

const pageDetails: Record<string, { title: string; description: string; icon: typeof BriefcaseBusiness }> = {
    applications: { title: "Applications", description: "Review and manage applications connected to your account.", icon: FileText },
    proposals: { title: "Applications", description: "Review and manage applications connected to your account.", icon: FileText },
    contracts: { title: "Active Projects", description: "Track assigned work and current project status.", icon: CheckCircle2 },
    projects: { title: "Projects", description: "Review work connected to your account.", icon: BriefcaseBusiness },
    completed: { title: "Completed Projects", description: "Review work completed on your account.", icon: CheckCircle2 },
    messages: { title: "Messages", description: "Continue conversations connected to your projects.", icon: MessageCircle },
    notifications: { title: "Notifications", description: "Stay up to date with activity on your account.", icon: Bell },
    earnings: { title: "Earnings", description: "Review completed work and its recorded project value.", icon: Wallet },
    reviews: { title: "Reviews", description: "Review feedback connected to completed work.", icon: Star },
    profile: { title: "My Profile", description: "Review and update your account profile.", icon: Settings },
    settings: { title: "Settings", description: "Manage account visibility and email preferences.", icon: Settings },
    jobs: { title: "My Jobs", description: "Manage the jobs you have posted.", icon: BriefcaseBusiness },
    "post-job": { title: "Post a Job", description: "Give independent professionals the context they need to do their best work.", icon: BriefcaseBusiness },
    freelancers: { title: "Hired Freelancers", description: "Review freelancers whose applications you accepted.", icon: BriefcaseBusiness },
    payments: { title: "Payments", description: "Payment history is unavailable until transaction records are connected.", icon: Wallet },
    transactions: { title: "Transactions", description: "Transaction records are not yet connected to this application.", icon: Wallet },
    disputes: { title: "Disputes & Reports", description: "Review project disputes, evidence, party responses, payment status, and recorded resolutions.", icon: CheckCircle2 },
    categories: { title: "Categories & Skills", description: "Category administration is not yet connected to this application.", icon: Settings },
    activity: { title: "Activity Logs", description: "Activity logs are not yet recorded in this application.", icon: FileText },
    "email-delivery": { title: "Email Delivery", description: "Review workflow email outbox status and retry eligible failed messages.", icon: Mail },
};

function EmptyPanel({ title, message, action }: { title: string; message: string; action?: { label: string; href: string } }) {
    return <div className="dashboard-empty"><strong>{title}</strong><p>{message}</p>{action && <Link className="button button-primary" href={action.href}>{action.label}</Link>}</div>;
}

function TaskList({ jobs, emptyMessage, action, role }: { jobs: Array<{ _id: unknown; title: string; category: string; amount: number; status: string }>; emptyMessage: string; action?: { label: string; href: string }; role: DashboardRole }) {
    if (!jobs.length) return <EmptyPanel title="No projects to show yet." message={emptyMessage} action={action} />;
    return <div className="dashboard-list">{jobs.map((job) => {
        const id = String(job._id);
        const href = role === "freelancer" ? `/freelancer/dashboard/projects/${id}` : `/client/dashboard/projects/${id}`;
        return <Link className="dashboard-list-row" href={href} key={id}><div><strong>{job.title}</strong><span>{job.category} &middot; {naira.format(job.amount)}</span></div><span className={`status-badge status-${job.status}`}>{job.status.replace("_", " ")}</span></Link>;
    })}</div>;
}

export default async function DashboardSectionPage({ role, section, searchParams }: { role: DashboardRole; section: string; searchParams?: Promise<{ q?: string }> }) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    if (user.role !== role) redirect(user.role === "employer" ? "/client/dashboard" : user.role === "freelancer" ? "/freelancer/dashboard" : "/admin/dashboard");
    if (role === "admin" && ["messages", "freelancers", "employers", "clients", "client"].includes(section)) redirect("/admin/dashboard");

    await connectToDatabase();
    const profile = await User.findById(user.userId).select("name email").lean();
    if (!profile) redirect("/login");
    const query = (await searchParams)?.q?.trim().toLowerCase() || "";
    const details = pageDetails[section] || { title: section.replace(/-/g, " "), description: "This section is not connected to a data source yet.", icon: BriefcaseBusiness };
    const Icon = details.icon;

    if (section === "post-job" && role === "employer") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={details.title} description={details.description}>
            <section className="dashboard-create-section"><CreateProjectForm /></section>
        </DashboardShell>;
    }

    if ((section === "jobs" || section === "projects") && role === "employer") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="My Jobs" description="Manage your job postings and track their progress.">
            <ClientJobsManager />
        </DashboardShell>;
    }

    if (section === "jobs" && role === "freelancer") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Find Jobs" description="Browse open opportunities and apply from your freelancer workspace.">
            <JobBoard detailsHrefPrefix="/freelancer/dashboard/jobs/" />
        </DashboardShell>;
    }

    if (section === "payments" && role === "employer") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={details.title} description="Review payment attempts initialized through Paystack. Only real provider records are shown.">
            <PaymentsHistory />
        </DashboardShell>;
    }

    if (section === "applications" || section === "proposals") {
        const title = role === "freelancer" ? "My Applications" : "Applications";
        const description = role === "employer" ? "Review freelancers who applied to your jobs." : role === "freelancer" ? "Track applications you submitted to open jobs." : "Review platform application activity.";
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={title} description={description}>
            <ApplicationList role={role} />
        </DashboardShell>;
    }
    if (section === "freelancers" && role === "employer") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Hired Freelancers" description="Freelancers connected to applications you accepted."><ApplicationList role="employer" statusFilter="accepted" /></DashboardShell>;
    }
    if (section === "messages") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Messages" description="Conversations are organized by project and limited to their participants."><MessagesPanel role={role} /></DashboardShell>;
    }
    if (section === "notifications") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Notifications" description="Updates and activity for your account."><NotificationsList role={role} /></DashboardShell>;
    }
    if (section === "profile" || section === "settings") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={details.title} description={details.description}><AccountPanel role={role} section={section} /></DashboardShell>;
    }
    if (role === "admin" && section === "users") {
        const users = await User.find(query ? { $or: [{ name: { $regex: query, $options: "i" } }, { email: { $regex: query, $options: "i" } }] } : {})
            .select("name email role isVerified createdAt")
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="User Management" description="Review registered accounts and verification status.">
            <div className="dashboard-toolbar"><form className="dashboard-inline-search"><input className="filter-input" defaultValue={query} name="q" placeholder="Search users by name or email" /><button className="button button-primary" type="submit">Search</button></form><span className="form-hint">{users.length} accounts</span></div>
            <section className="dashboard-panel"><div className="dashboard-table">{users.length ? users.map((account) => <div className="dashboard-table-row" key={String(account._id)}><div><strong>{account.name}</strong><span>{account.email}</span></div><span className="status-badge">{account.role} &middot; {account.isVerified ? "verified" : "unverified"}</span></div>) : <EmptyPanel title="No users found." message="Registered accounts matching this search will appear here." />}</div></section>
        </DashboardShell>;
    }
    if (role === "admin" && section === "disputes") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={details.title} description={details.description}>
            <AdminDisputesPage />
        </DashboardShell>;
    }
    if (role === "admin" && section === "email-delivery") {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={details.title} description={details.description}>
            <AdminEmailDeliveryPage />
        </DashboardShell>;
    }
    if (section === "disputes" && (role === "employer" || role === "freelancer")) {
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title="Disputes" description="Review project concerns, share evidence, and communicate with the other parties.">
            <DisputesDashboard role={role} />
        </DashboardShell>;
    }
    if (role === "admin" && (section === "employers" || section === "freelancers")) {
        const accountRole = section === "employers" ? "employer" : "freelancer";
        const users = await User.find({ role: accountRole }).select("name email isVerified createdAt").sort({ createdAt: -1 }).limit(100).lean();
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={section === "employers" ? "Employers" : "Freelancers"} description={`Review ${accountRole} accounts on the platform.`}>
            <section className="dashboard-panel"><div className="dashboard-table">{users.length ? users.map((account) => <div className="dashboard-table-row" key={String(account._id)}><div><strong>{account.name}</strong><span>{account.email}</span></div><span className="status-badge">{account.isVerified ? "verified" : "unverified"}</span></div>) : <EmptyPanel title={`No ${section} yet.`} message={`New ${section} will appear here after registration.`} />}</div></section>
        </DashboardShell>;
    }

    if (section === "contracts" || section === "projects" || section === "completed" || section === "earnings") {
        const filter: Record<string, unknown> = role === "admin" ? {} : role === "employer" ? { employer: user.userId } : { freelancer: user.userId };
        if (section === "completed") filter.status = "completed";
        else if (section === "earnings") {
            if (role !== "freelancer") redirect(role === "employer" ? "/client/dashboard" : "/admin/dashboard");
            filter.status = "completed";
        }         else if (section === "contracts") filter.status = { $in: ["awaiting_funding", "funded", "in_progress", "submitted", "revision_requested", "disputed"] };
        else filter.status = { $in: ["awaiting_funding", "funded", "in_progress", "submitted", "revision_requested", "disputed", "completed"] };

        const jobs = await Task.find(filter).sort({ updatedAt: -1 }).lean();
        const total = jobs.filter((job) => job.status === "completed").reduce((sum, job) => sum + job.amount, 0);
        const title = section === "earnings" ? "Earnings" : section === "completed" ? "Completed Projects" : section === "contracts" ? "Active Projects" : "Projects";
        return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={title} description={details.description}>
            {section === "earnings" && <section className="dashboard-stat-grid"><article className="dashboard-stat-card"><span>Completed project value</span><strong>{naira.format(total)}</strong><small>{jobs.length} completed projects</small></article></section>}
            <section className="dashboard-panel"><TaskList jobs={jobs} emptyMessage={role === "freelancer" ? section === "completed" ? "No projects have been completed on your account yet." : "No projects have been assigned to you yet. Accepted and assigned projects will appear here." : "Projects connected to your account will appear here when they are assigned or completed."} action={role === "freelancer" && section !== "completed" ? { label: "Find Jobs", href: "/freelancer/dashboard/jobs" } : undefined} role={role} /></section>
        </DashboardShell>;
    }

    const emptyMessage = section === "payments" || section === "transactions"
        ? "Payment-provider transaction records are not currently stored. No payment activity is fabricated."
        : section === "reviews"
            ? "Review records are not connected to the database yet."
            : section === "disputes"
                ? "Dispute records are not connected to the database yet."
                : section === "activity"
                    ? "The platform does not yet store an administrative activity log."
                    : section === "categories"
                        ? "Category management is not connected to a persisted taxonomy yet."
                        : "This workflow is not connected to a database feature yet.";
    const action = role === "employer" && section === "payments" ? { label: "View My Jobs", href: "/client/dashboard/jobs" } : undefined;
    return <DashboardShell role={role} userName={profile.name} userEmail={profile.email} title={details.title} description={details.description}>
        <section className="dashboard-section-layout">
            <div className="dashboard-panel dashboard-section-hero"><Icon aria-hidden="true" size={28} /><div><h2>{details.title}</h2><p>{details.description}</p></div></div>
            <EmptyPanel title={`No ${details.title.toLowerCase()} to show yet.`} message={emptyMessage} action={action} />
        </section>
    </DashboardShell>;
}
