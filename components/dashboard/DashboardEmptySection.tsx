import { redirect } from "next/navigation";
import Link from "next/link";
import DashboardShell, { type DashboardRole } from "./DashboardShell";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

const labels: Record<DashboardRole, string> = { freelancer: "Freelancer", employer: "Client", admin: "Admin" };

export default async function DashboardEmptySection({ role, section }: { role: DashboardRole; section: string }) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    if (user.role !== role) redirect(user.role === "employer" ? "/client/dashboard" : user.role === "freelancer" ? "/freelancer/dashboard" : "/admin/dashboard");
    await connectToDatabase();
    const profile = await User.findById(user.userId).select("name email").lean();
    if (!profile) redirect("/login");
    return <DashboardShell role={role} userName={profile.name} title={`${section} is ready for its data layer.`} description={`This ${labels[role].toLowerCase()} workspace route is protected and reserved for the ${section.toLowerCase()} workflow.`}><section className="dashboard-panel dashboard-empty-route"><span className="panel-kicker">Protected workspace</span><h2>No records to show yet</h2><p>The current database does not contain the records required for this section. The route is intentionally empty rather than displaying fabricated activity.</p><Link className="button button-primary" href={role === "employer" ? "/client/dashboard" : role === "freelancer" ? "/freelancer/dashboard" : "/admin/dashboard"}>Back to overview</Link></section></DashboardShell>;
}
