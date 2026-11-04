import DashboardEmptySection from "@/components/dashboard/DashboardEmptySection";

export default async function ClientDashboardSection({ params }: { params: Promise<{ section: string[] }> }) {
    const { section } = await params;
    return <DashboardEmptySection role="employer" section={section.join(" / ")} />;
}
