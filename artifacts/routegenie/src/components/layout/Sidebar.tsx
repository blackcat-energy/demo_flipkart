import React from 'react';
import { Link, useLocation } from 'wouter';
import { Map, PlusCircle, Clock, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: Map },
    { href: '/new-event', label: 'New Event', icon: PlusCircle },
    { href: '/history', label: 'Historical Events', icon: Clock },
  ];

  return (
    <div className="w-64 bg-card border-r border-border h-full flex flex-col">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <ShieldAlert className="h-6 w-6 text-primary" />
        <div className="font-bold text-lg tracking-tight">RouteGenie</div>
      </div>
      
      <div className="flex-1 py-4 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-secondary-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </div>
      
      <div className="p-4 border-t border-border mt-auto">
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">OPERATOR</div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
            OP
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-none">Traffic Ops</span>
            <span className="text-xs text-muted-foreground">Bengaluru City</span>
          </div>
        </div>
      </div>
    </div>
  );
}
