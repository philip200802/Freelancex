import { redirect } from "next/navigation";
import AdminUsersPage from "@/components/dashboard/AdminUsersPage";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

export const dynamic = "force-dynamic";

export default async function AdminUsersRoute() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "admin") {
        redirect(currentUser.role === "employer" ? "/client/dashboard" : "/freelancer/dashboard");
    }

    await connectToDatabase();
    const admin = await User.findById(currentUser.userId).select("name email").lean();
    if (!admin) redirect("/login");

    return <DashboardShell role="admin" userName={admin.name} userEmail={admin.email} title="User Management" description="Review accounts, profile details, and verification status.">
        <AdminUsersPage />
    </DashboardShell>;
}
