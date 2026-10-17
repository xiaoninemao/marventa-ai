import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/layout/app_shell";
import { AuthProvider } from "@/contexts/auth_context";
import { I18nProvider } from "@/contexts/i18n_context";
import { ToastProvider } from "@/contexts/toast_context";
import { DEFAULT_LOCALE } from "@/i18n/locale";

export const metadata: Metadata = {
  title: "Marventa AI",
  description: "An agent workspace for marketing teams. Bring shared project knowledge into planning, creation, and delivery, and keep the work ready for the next brief.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang={DEFAULT_LOCALE}
      className="h-full antialiased"
    >
      <body className="h-full flex flex-col bg-white dark:bg-black text-zinc-900 dark:text-zinc-100 font-body">
        <AuthProvider>
          <I18nProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
            </ToastProvider>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
