
'use client'

import React, { useEffect, useState, createContext, useContext } from 'react';
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
} from '@/components/ui/sidebar'
import {
  LayoutDashboard,
  Wallet,
  Landmark,
  TrendingUp,
  History,
  Loader2,
  ChevronRight,
  Settings,
  CalendarClock,
  ArrowRightLeft,
  PieChart,
  PiggyBank,
  User,
  Banknote,
  GitCompareArrows,
  Home,
  Paintbrush,
  DollarSign,
  List,
  LifeBuoy,
  Scale,
  CandlestickChart,
} from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CurrencyProvider } from '@/context/currency-context';
import { ProjectionSettingsProvider } from '@/context/projection-settings-context';
import { Logo } from '@/components/logo';
import { UiSettingsProvider, useUiSettings } from '@/context/ui-settings-context';
import { AppTourProvider } from './tour-guide';
import { FinancialTargetsProvider } from '@/context/financial-targets-context';

export const AuthContext = createContext<FirebaseUser | null>(null);

export function useAuth() {
    const user = useContext(AuthContext);
    if (!user) {
        throw new Error('useAuth must be used within a MainLayout component.');
    }
    return user;
}

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    label: 'Budget',
    icon: Landmark,
    id: 'tour-step-2-transactions-sidebar',
    children: [
      { href: '/budget', label: 'Monthly View', icon: CalendarClock },
      { href: '/analytics', label: 'Analytics', icon: PieChart },
      { href: '/budget/compare', label: 'Comparison', icon: GitCompareArrows },
      { href: '/savings', label: 'Savings Goals', icon: PiggyBank },
      { href: '/transactions', label: 'All Transactions', icon: ArrowRightLeft },
    ],
  },
  {
    label: 'Assets',
    icon: Wallet,
    id: 'tour-step-6-assets-sidebar',
    children: [
      { href: '/net-worth', label: 'Net Worth', icon: Scale },
      { href: '/assets', label: 'Assets', icon: Wallet },
      { href: '/liabilities', label: 'Liabilities', icon: Banknote },
      { href: '/investments', label: 'Investments', icon: CandlestickChart },
      { href: '/history', label: 'History', icon: History },
      { href: '/projections', label: 'Projections', icon: TrendingUp },
    ],
  },
  { href: '/household', label: 'Household', icon: Home, id: 'tour-step-4-household-sidebar' },
  { 
    label: 'Settings', 
    icon: Settings,
    children: [
        { href: '/settings/appearance', label: 'Appearance', icon: Paintbrush },
        { href: '/settings/financial', label: 'Financial', icon: DollarSign },
        { href: '/settings/categories', label: 'Categories', icon: List },
    ]
  },
]

function Navigation() {
    const pathname = usePathname();
    const { expandSidebarMenus } = useUiSettings();
    const [openCollapsibles, setOpenCollapsibles] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const newOpenState: Record<string, boolean> = {};
        navItems.forEach(item => {
            if (item.children) {
                if (expandSidebarMenus) {
                    newOpenState[item.label] = true;
                } else {
                    const isActive = item.children.some(c => pathname.startsWith(c.href));
                    newOpenState[item.label] = isActive;
                }
            }
        });
        setOpenCollapsibles(newOpenState);
    }, [pathname, expandSidebarMenus]);

    const isLinkActive = (href?: string) => {
        if (!href) return false;
        if (href === '/dashboard' || href === '/budget' || href === '/assets') {
            return pathname === href;
        }
        return pathname.startsWith(href);
    };
    
    return (
        <SidebarContent
            style={{
              "--accent": "hsl(var(--accent))",
              "--accent-foreground": "hsl(var(--accent-foreground))",
            } as React.CSSProperties}
          >
            <SidebarMenu>
              {navItems.map((item) =>
                item.children ? (
                  <Collapsible asChild key={item.label} open={openCollapsibles[item.label] || false} onOpenChange={(isOpen) => setOpenCollapsibles((prev) => ({ ...prev, [item.label]: isOpen }))}>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton id={item.id} isActive={item.children.some(c => isLinkActive(c.href))} tooltip={item.label}>
                          <item.icon />
                          <span>{item.label}</span>
                          <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="pl-4">
                          <SidebarMenu className="mt-1 border-l border-sidebar-border pl-2">
                            {item.children.map((child) => (
                              <SidebarMenuItem key={child.label}>
                                <SidebarMenuButton asChild isActive={isLinkActive(child.href)} tooltip={child.label} size="sm">
                                  <Link href={child.href}>
                                    <child.icon />
                                    <span>{child.label}</span>
                                  </Link>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            ))}
                          </SidebarMenu>
                        </div>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild id={item.id} isActive={isLinkActive(item.href)} tooltip={item.label}>
                      <Link href={item.href!}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              )}
            </SidebarMenu>
        </SidebarContent>
    );
}


export function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser(user);
      } else {
        router.push('/login');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);
  

  if (loading) {
    return (
        <div className="flex h-screen items-center justify-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    )
  }
  
  if (!user) {
    return null;
  }

  return (
    <AuthContext.Provider value={user}>
      <ProjectionSettingsProvider>
        <CurrencyProvider>
          <UiSettingsProvider>
            <FinancialTargetsProvider>
              <AppTourProvider>
                <SidebarProvider>
                  <Sidebar collapsible="icon" className="bg-card border-r">
                    <SidebarHeader className="group-data-[collapsible=icon]:justify-center">
                      <Link href="/dashboard" className="flex items-center gap-2 group-data-[collapsible=icon]:gap-0">
                          <Logo className="h-7 w-7 transition-all" />
                          <span className="text-lg font-semibold tracking-tight text-primary transition-opacity duration-200 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
                            Kiadas
                          </span>
                        </Link>
                    </SidebarHeader>
                    <Navigation />
                  </Sidebar>
                  <SidebarInset>
                    <div className="flex min-h-screen w-full flex-col">
                      {children}
                      <footer className="py-6 text-center text-muted-foreground text-sm">
                        <p>Kiadas © {new Date().getFullYear()}</p>
                      </footer>
                    </div>
                  </SidebarInset>
                </SidebarProvider>
              </AppTourProvider>
            </FinancialTargetsProvider>
          </UiSettingsProvider>
        </CurrencyProvider>
      </ProjectionSettingsProvider>
    </AuthContext.Provider>
  )
}
