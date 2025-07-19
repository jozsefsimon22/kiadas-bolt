
'use client';

import { useTheme } from 'next-themes';
import { useUiSettings } from '@/context/ui-settings-context';
import { AccentColor, useAccentColor } from '@/context/accent-color-context';
import { MainLayout } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Monitor, Sun, Moon, Paintbrush } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

const accentColorOptions: AccentColor[] = [
    { name: 'Default Blue', primary: '217.2 91.2% 59.8%', foreground: '210 40% 98%' },
    { name: 'Teal', primary: '160 84% 39%', foreground: '160 100% 96%' },
    { name: 'Rose', primary: '346.8 77.2% 49.8%', foreground: '355.7 100% 97.3%' },
    { name: 'Indigo', primary: '262.1 83.3% 57.8%', foreground: '260 100% 97.6%' },
    { name: 'Forest', primary: '142.1 76.2% 36.3%', foreground: '144 60% 96.1%' },
    { name: 'Gold', primary: '47.9 95.8% 53.1%', foreground: '48 95% 9.8%' },
];

function AppearanceSettings() {
  const { expandSidebarMenus, setExpandSidebarMenus } = useUiSettings();
  const { setTheme, theme } = useTheme();
  const { accentColor, setAccentColor } = useAccentColor();
  const router = useRouter();

  return (
    <>
      <Header title="Appearance Settings" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-2xl mx-auto w-full">
          <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Paintbrush className="h-6 w-6" />Appearance</CardTitle>
                <CardDescription>Customize the look and feel of the application.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="theme-select">Theme</Label>
                    <Select value={theme} onValueChange={setTheme}>
                        <SelectTrigger id="theme-select"><SelectValue placeholder="Select a theme" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="light"><div className="flex items-center gap-2"><Sun className="h-4 w-4"/> Light</div></SelectItem>
                            <SelectItem value="dark"><div className="flex items-center gap-2"><Moon className="h-4 w-4"/> Dark</div></SelectItem>
                            <SelectItem value="system"><div className="flex items-center gap-2"><Monitor className="h-4 w-4"/> System</div></SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <Separator />
                
                <div className="space-y-2">
                    <Label>Accent Color</Label>
                    <div className="grid grid-cols-6 gap-2">
                        {accentColorOptions.map(color => (
                            <button
                                key={color.name}
                                type="button"
                                className={cn(
                                    'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                                    accentColor.name === color.name ? 'border-ring ring-2 ring-offset-2 ring-offset-background' : 'border-transparent'
                                )}
                                style={{ backgroundColor: `hsl(${color.primary})` }}
                                onClick={() => setAccentColor(color)}
                                aria-label={`Set accent color to ${color.name}`}
                            />
                        ))}
                    </div>
                </div>

                <Separator />
                
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label htmlFor="expand-menus" className="cursor-pointer">Keep navigation submenus open</Label>
                        <p className="text-sm text-muted-foreground">
                            Controls whether sidebar submenus are expanded by default.
                        </p>
                    </div>
                    <Switch
                      id="expand-menus"
                      checked={expandSidebarMenus}
                      onCheckedChange={setExpandSidebarMenus}
                    />
                </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}

export default function AppearanceSettingsPage() {
    return (
        <MainLayout>
            <AppearanceSettings />
        </MainLayout>
    )
}
