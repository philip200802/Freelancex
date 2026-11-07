import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import HelpCenter from "@/components/dashboard/HelpCenter";
import OnboardingGuide from "@/components/dashboard/OnboardingGuide";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { helpArticles } from "@/lib/onboarding-content";
import User from "@/models/User";

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ topic?: string | string[] }> }) {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");

    await connectToDatabase();
    const user = await User.findById(currentUser.userId).select("name role").lean();
    if (!user || user.role !== currentUser.role) redirect("/login");

    const { topic } = await searchParams;
    const initialTopic = typeof topic === "string" ? topic : undefined;
    return <DashboardShell role={user.role} userName={user.name} title="Help Center" description="Find practical answers for your FreelanceX workspace.">
        <OnboardingGuide role={user.role} userName={user.name} />
        <HelpCenter articles={helpArticles.filter((article) => article.roles.includes(user.role))} initialTopic={initialTopic} role={user.role} />
    </DashboardShell>;
}
