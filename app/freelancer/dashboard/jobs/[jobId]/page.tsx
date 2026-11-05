import { redirect } from "next/navigation";
import JobDetailsView from "@/components/jobs/JobDetailsView";
import { getCurrentUser } from "@/lib/current-user";

export default async function FreelancerJobDetailsPage({ params }: { params: Promise<{ jobId: string }> }) {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "freelancer") redirect(currentUser.role === "employer" ? "/client/dashboard" : "/admin/dashboard");

    const { jobId } = await params;
    return <JobDetailsView jobId={jobId} backHref="/freelancer/dashboard/jobs" emptyHref="/freelancer/dashboard/jobs" />;
}
