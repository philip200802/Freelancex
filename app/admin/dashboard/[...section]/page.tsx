import DashboardSectionPage from "@/components/dashboard/DashboardSectionPage";

export default async function AdminDashboardSection({ params, searchParams }: {
    params: Promise<{ section: string[] }>;
    searchParams: Promise<{ q?: string }>;
}) {
    const { section } = await params;
    return <DashboardSectionPage role="admin" section={section.join("/")} searchParams={searchParams} />;
}
