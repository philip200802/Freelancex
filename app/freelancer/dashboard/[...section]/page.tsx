import DashboardEmptySection from "@/components/dashboard/DashboardEmptySection";

export default async function FreelancerDashboardSection({ params }: { params: Promise<{ section: string[] }> }) {
    const { section } = await params;
    return <DashboardEmptySection role="freelancer" section={section.join(" / ")} />;
}
