import { redirect } from "next/navigation";
import AdminPayoutsPage from "@/components/dashboard/AdminPayoutsPage";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

export const dynamic = "force-dynamic";

export default async function AdminPayoutsRoute() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "admin") {
        redirect(currentUser.role === "employer" ? "/client/dashboard" : "/freelancer/dashboard");
    }

    await connectToDatabase();
    const admin = await User.findById(currentUser.userId).select("name email").lean();
    if (!admin) redirect("/login");

    return <DashboardShell role="admin" userName={admin.name} userEmail={admin.email} title="Manual Freelancer Payouts" description="Record completed manual transfers for approved, paid projects. FreelanceX does not initiate transfers.">
        <AdminPayoutsPage />
    </DashboardShell>;
}
