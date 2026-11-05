import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";

export default async function JobsPage() {
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    if (currentUser.role === "employer") redirect("/client/dashboard");
    if (currentUser.role === "admin") redirect("/admin/dashboard");
    redirect("/freelancer/dashboard/jobs");
}
