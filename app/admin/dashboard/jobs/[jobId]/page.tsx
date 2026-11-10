import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import DashboardShell from "@/components/dashboard/DashboardShell";
import ProjectSubmissions from "@/components/projects/ProjectSubmissions";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Application from "@/models/Application";
import CancellationRequest from "@/models/CancellationRequest";
import DeadlineExtensionRequest from "@/models/DeadlineExtensionRequest";
import PaymentTransaction from "@/models/PaymentTransaction";
import Task from "@/models/Task";
import User from "@/models/User";
import mongoose from "mongoose";
import { getProjectDeadlineStatus } from "@/lib/project-deadline";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const statusLabels: Record<string, string> = {
    pending_approval: "Pending approval",
    awaiting_funding: "Awaiting funding",
    in_progress: "In progress",
    cancelled: "Cancelled",
    disputed: "Disputed",
};

function formatStatus(status: string) {
    return statusLabels[status] || status.replace(/_/g, " ");
}

function formatDate(value: Date | string) {
    return new Date(value).toLocaleString();
}

export default async function AdminJobDetailsPage({ params }: { params: Promise<{ jobId: string }> }) {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "admin") {
        redirect(currentUser.role === "employer" ? "/client/dashboard" : "/freelancer/dashboard");
    }
    const { jobId } = await params;
    if (!mongoose.Types.ObjectId.isValid(jobId)) notFound();

    await connectToDatabase();
    const [admin, job] = await Promise.all([
        User.findById(currentUser.userId).select("name email").lean(),
        Task.findById(jobId).select("title description category amount status createdAt updatedAt employer freelancer employerNameSnapshot freelancerNameSnapshot deadlineAt projectStartedAt").lean(),
    ]);
    if (!admin) redirect("/login");
    if (!job) notFound();

    const [applications, payments, cancellations, extensions] = await Promise.all([
        Application.find({ task: job._id }).sort({ createdAt: -1 }).lean(),
        PaymentTransaction.find({ task: job._id }).sort({ createdAt: -1 }).lean(),
        CancellationRequest.find({ task: job._id }).sort({ createdAt: -1 }).lean(),
        DeadlineExtensionRequest.find({ task: job._id }).sort({ createdAt: -1 }).lean(),
    ]);
    const userIds = [...new Set([
        job.employer?.toString(),
        job.freelancer?.toString(),
        ...applications.flatMap((application) => [application.employer?.toString(), application.freelancer?.toString()]),
    ].filter((id): id is string => Boolean(id)))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name email role isActive").lean() : [];
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const employer = job.employer ? usersById.get(job.employer.toString()) : null;
    const freelancer = job.freelancer ? usersById.get(job.freelancer.toString()) : null;

    return <DashboardShell role="admin" userName={admin.name} userEmail={admin.email} title="Job Details" description="Review the job record, related applications, project submissions and recorded payments.">
        <Link className="button button-quiet admin-job-back-link" href="/admin/dashboard/jobs"><ArrowLeft aria-hidden="true" size={16} />Back to jobs</Link>
        <div className="admin-job-details-grid">
            <section className="dashboard-panel admin-job-details-panel">
                <div className="admin-job-details-heading"><div><span className="panel-kicker">Job information</span><h2>{job.title}</h2></div><span className={`status-badge status-${job.status}`}>{formatStatus(job.status)}</span></div>
                <p className="admin-job-full-description">{job.description}</p>
                <dl className="admin-job-info-grid">
                    <div><dt>Category</dt><dd>{job.category}</dd></div>
                    <div><dt>Budget</dt><dd>{naira.format(job.amount)}</dd></div>
                    <div><dt>Accepted on</dt><dd>{job.projectStartedAt ? formatDate(job.projectStartedAt) : "Not accepted"}</dd></div>
                    <div><dt>Deadline</dt><dd>{job.deadlineAt ? `${formatDate(job.deadlineAt)} · ${getProjectDeadlineStatus(job.deadlineAt, job.status)}` : "Not set"}</dd></div>
                    <div><dt>Date posted</dt><dd>{formatDate(job.createdAt)}</dd></div>
                    <div><dt>Last updated</dt><dd>{formatDate(job.updatedAt)}</dd></div>
                </dl>
            </section>

            <section className="dashboard-panel admin-job-details-panel">
                <span className="panel-kicker">Employer</span>
                <h2>{job.employerNameSnapshot || employer?.name || "Unknown"}</h2>
                {employer && <p className="admin-job-account-details">{employer.isActive === false ? "Former account" : employer.email}<span>{employer.role}</span></p>}
            </section>

            <section className="dashboard-panel admin-job-details-panel">
                <span className="panel-kicker">Assigned freelancer</span>
                <h2>{job.freelancerNameSnapshot || freelancer?.name || "Unassigned"}</h2>
                {freelancer && <p className="admin-job-account-details">{freelancer.isActive === false ? "Former account" : freelancer.email}<span>{freelancer.role}</span></p>}
            </section>

            <section className="dashboard-panel admin-job-details-panel admin-job-related-panel">
                <div className="admin-job-details-heading"><div><span className="panel-kicker">Applications</span><h2>{applications.length}</h2></div></div>
                {applications.length ? <div className="admin-job-related-list">{applications.map((application) => {
                    const applicant = application.freelancer ? usersById.get(application.freelancer.toString()) : null;
                    const name = application.freelancerNameSnapshot || applicant?.name || "Unknown applicant";
                    return <article className="admin-job-related-row" key={application._id.toString()}>
                        <div><strong>{name}</strong><span>{application.message || "No application message provided."}</span>{applicant && <small>{applicant.isActive === false ? "Former account" : applicant.email}</small>}</div>
                        <div><span className={`status-badge status-${application.status}`}>{application.status}</span><small>{new Date(application.createdAt).toLocaleDateString()}</small></div>
                    </article>;
                })}</div> : <div className="dashboard-empty"><strong>No applications recorded.</strong><p>Applications linked to this job will appear here.</p></div>}
            </section>
            <section className="dashboard-panel admin-job-details-panel admin-job-related-panel">
                <div className="admin-job-details-heading"><div><span className="panel-kicker">Cancellation history</span><h2>{cancellations.length}</h2></div></div>
                {cancellations.length ? <div className="admin-job-related-list">{cancellations.map((entry) => <article className="admin-job-related-row" key={entry._id.toString()}>
                    <div><strong>{entry.reason.replaceAll("_", " ")}</strong><span>{entry.description}</span><small>{formatDate(entry.createdAt)}</small></div>
                    <span className={`status-badge status-${entry.status}`}>{entry.status}</span>
                </article>)}</div> : <div className="dashboard-empty"><strong>No cancellation requests.</strong><p>Cancellation history will be preserved here.</p></div>}
            </section>
            <section className="dashboard-panel admin-job-details-panel admin-job-related-panel">
                <div className="admin-job-details-heading"><div><span className="panel-kicker">Deadline extension history</span><h2>{extensions.length}</h2></div></div>
                {extensions.length ? <div className="admin-job-related-list">{extensions.map((entry) => <article className="admin-job-related-row" key={entry._id.toString()}>
                    <div><strong>+{entry.duration} {entry.durationUnit} · {entry.reason}</strong><span>{formatDate(entry.currentDeadline)} → {formatDate(entry.proposedDeadline)}</span><small>{formatDate(entry.createdAt)}</small></div>
                    <span className={`status-badge status-${entry.status}`}>{entry.status}</span>
                </article>)}</div> : <div className="dashboard-empty"><strong>No deadline extensions.</strong><p>Extension requests and prior deadlines will appear here.</p></div>}
            </section>

            <section className="dashboard-panel admin-job-details-panel admin-job-related-panel">
                <div className="admin-job-details-heading"><div><span className="panel-kicker">Payment records</span><h2>{payments.length}</h2></div></div>
                {payments.length ? <div className="admin-job-related-list">{payments.map((payment) => <article className="admin-job-related-row" key={payment._id.toString()}>
                    <div><strong>{naira.format(payment.amount)}</strong><span>{payment.reference}</span><small>{payment.verifiedAt ? `Verified ${formatDate(payment.verifiedAt)}` : `Created ${formatDate(payment.createdAt)}`}</small></div>
                    <span className={`status-badge status-${payment.status}`}>{payment.status === "success" ? "verified" : payment.status}</span>
                </article>)}</div> : <div className="dashboard-empty"><strong>No payment records.</strong><p>Payment transactions associated with this job will appear here.</p></div>}
            </section>
        </div>
        <ProjectSubmissions projectId={job._id.toString()} role="admin" projectStatus={job.status} />
    </DashboardShell>;
}
