import { redirect } from "next/navigation";
import JobBoard from "@/app/jobs/JobBoard";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

export default async function FreelancerJobsPage() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "freelancer") redirect(currentUser.role === "employer" ? "/client/dashboard" : "/admin/dashboard");

    await connectToDatabase();
    const user = await User.findById(currentUser.userId).select("name email").lean();
    if (!user) redirect("/login");

    return <DashboardShell role="freelancer" userName={user.name} userEmail={user.email} title="Find Jobs" description="Discover open opportunities and apply from within your freelancer workspace.">
        <JobBoard detailsHrefPrefix="/freelancer/dashboard/jobs/" />
    </DashboardShell>;
}
