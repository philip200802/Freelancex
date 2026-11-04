import DashboardSectionPage from "@/components/dashboard/DashboardSectionPage";

export default async function ClientDashboardSection({ params, searchParams }: {
    params: Promise<{ section: string[] }>;
    searchParams: Promise<{ q?: string }>;
}) {
    const { section } = await params;
    return <DashboardSectionPage role="employer" section={section.join("/")} searchParams={searchParams} />;
}
