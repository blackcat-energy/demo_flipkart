import React from 'react';
import { TopBar } from './TopBar';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden text-[14px]">
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 relative overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
