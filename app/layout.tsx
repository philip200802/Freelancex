import type { Metadata } from "next";
import { Suspense } from "react";
import GlobalNavigationLoader from "@/components/navigation/GlobalNavigationLoader";
import "./globals.css";

export const metadata: Metadata = {
    title: "FreelanceX | Work that moves forward",
    description: "A trusted marketplace for ambitious teams and independent talent.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en">
            <body><Suspense fallback={null}><GlobalNavigationLoader /></Suspense>{children}</body>
        </html>
    );
}
