import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { Clock, Map, PlusCircle, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TopBar() {
  const [time, setTime] = useState(new Date());
  const [location] = useLocation();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: Map },
    { href: '/new-event', label: 'New Event', icon: PlusCircle },
    { href: '/history', label: 'Historical Events', icon: Clock },
  ];

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-5 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <h1 className="font-bold text-lg text-foreground m-0">RouteGenie</h1>
        </div>
        <div className="h-4 w-px bg-border"></div>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;

            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors cursor-pointer text-sm font-medium whitespace-nowrap",
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
        </nav>
      </div>
      
      <div className="flex items-center gap-4 text-sm font-medium text-foreground bg-muted/50 px-3 py-1.5 rounded-md border border-border/50 shrink-0">
        <span className="tracking-wider text-primary">{time.toLocaleTimeString('en-US', { hour12: false })}</span>
        <span className="text-muted-foreground">{time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  );
}
