import { OrgProvider } from '@/hooks/use-org';
import { Sidebar } from '@/components/layout/sidebar';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </OrgProvider>
  );
}

