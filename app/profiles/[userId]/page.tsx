import { notFound, redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import ProfileView from "@/components/profiles/ProfileView";
import { getCurrentUser } from "@/lib/current-user";
import User from "@/models/User";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({ params }: { params: Promise<{ userId: string }> }) {
    const viewer = await getCurrentUser();
    if (!viewer) redirect("/login");
    const { userId } = await params;
    const account = await User.findById(viewer.userId).select("name email").lean();
    if (!account) notFound();

    return <DashboardShell role={viewer.role} userName={account.name} userEmail={account.email} title="Profile" description="Professional information shared on FreelanceX.">
        <ProfileView userId={userId} viewerRole={viewer.role} />
    </DashboardShell>;
}
