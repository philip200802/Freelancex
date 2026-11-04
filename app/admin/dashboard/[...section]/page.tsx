import DashboardEmptySection from "@/components/dashboard/DashboardEmptySection";

export default async function AdminDashboardSection({ params }: { params: Promise<{ section: string[] }> }) {
    const { section } = await params;
    return <DashboardEmptySection role="admin" section={section.join(" / ")} />;
}
