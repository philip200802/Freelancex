import { redirect } from "next/navigation";
import AdminBankAccountsPage from "@/components/dashboard/AdminBankAccountsPage";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

export const dynamic = "force-dynamic";

export default async function AdminBankAccountsRoute() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role !== "admin") {
        redirect(currentUser.role === "employer" ? "/client/dashboard" : "/freelancer/dashboard");
    }

    await connectToDatabase();
    const admin = await User.findById(currentUser.userId).select("name email").lean();
    if (!admin) redirect("/login");

    return <DashboardShell role="admin" userName={admin.name} userEmail={admin.email} title="Freelancer Bank Accounts" description="Review verified payout details with sensitive account numbers masked by default.">
        <AdminBankAccountsPage />
    </DashboardShell>;
}
