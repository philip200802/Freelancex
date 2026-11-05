import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";

export default async function JobDetailsPage({ params }: { params: Promise<{ jobId: string }> }) {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role === "employer") redirect("/client/dashboard");
    if (currentUser.role === "admin") redirect("/admin/dashboard");
    const { jobId } = await params;
    if (currentUser.role === "freelancer") redirect(`/freelancer/dashboard/jobs/${jobId}`);
    redirect("/login");
}

export { default as JobDetailsView } from "@/components/jobs/JobDetailsView";
