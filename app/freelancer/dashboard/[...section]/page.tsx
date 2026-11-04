import DashboardSectionPage from "@/components/dashboard/DashboardSectionPage";

export default async function FreelancerDashboardSection({ params, searchParams }: {
    params: Promise<{ section: string[] }>;
    searchParams: Promise<{ q?: string }>;
}) {
    const { section } = await params;
    return <DashboardSectionPage role="freelancer" section={section.join("/")} searchParams={searchParams} />;
}
