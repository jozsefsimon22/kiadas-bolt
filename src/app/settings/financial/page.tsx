
'use client';

import { useCurrency } from '@/context/currency-context';
import { useProjectionSettings } from '@/context/projection-settings-context';
import { MainLayout } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DollarSign, HelpCircle } from 'lucide-react';
import { useFinancialTargets } from '@/context/financial-targets-context';
import { Separator } from '@/components/ui/separator';


function FinancialSettings() {
  const { currency, setCurrency } = useCurrency();
  const { defaultMonthlyContribution, setDefaultMonthlyContribution } = useProjectionSettings();
  const { netWorthTarget, setNetWorthTarget } = useFinancialTargets();
  
  return (
    <>
      <Header title="Financial Settings" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-2xl mx-auto w-full">
          <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><DollarSign className="h-6 w-6" />Financial Settings</CardTitle>
                <CardDescription>Manage currency and other financial calculation settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="currency-select">Currency</Label>
                    <Select value={currency} onValueChange={(value) => setCurrency(value as any)}>
                        <SelectTrigger id="currency-select" className="w-full md:w-[300px]">
                            <SelectValue placeholder="Select a currency" />
                        </SelectTrigger>
                        <SelectContent>
                        <SelectItem value="USD">USD - United States Dollar</SelectItem>
                        <SelectItem value="EUR">EUR - Euro</SelectItem>
                        <SelectItem value="GBP">GBP - British Pound</SelectItem>
                        <SelectItem value="HUF">HUF - Hungarian Forint</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Separator />
                <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                        <Label htmlFor="projection-contribution">Default Projection Contribution</Label>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger type="button">
                                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p className="max-w-xs p-2">
                                        Automatically calculated based on the average contributions to assets and savings goals over the last 12 months. You can override it for custom projections.
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <Input 
                        id="projection-contribution"
                        type="number"
                        placeholder="Calculated automatically"
                        value={defaultMonthlyContribution ?? ''}
                        onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                                setDefaultMonthlyContribution(null);
                            } else {
                                setDefaultMonthlyContribution(Number(value));
                            }
                        }}
                        className="w-full md:w-[300px]"
                    />
                     <p className="text-sm text-muted-foreground">
                        Leave blank to use the automatic calculation.
                    </p>
                </div>
                <Separator />
                <div className="space-y-2">
                    <Label htmlFor="net-worth-target">Net Worth Target</Label>
                    <Input 
                        id="net-worth-target"
                        type="number"
                        placeholder="e.g. 1000000"
                        value={netWorthTarget ?? ''}
                        onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                                setNetWorthTarget(null);
                            } else {
                                setNetWorthTarget(Number(value));
                            }
                        }}
                         className="w-full md:w-[300px]"
                    />
                     <p className="text-sm text-muted-foreground">
                        Set a target for your total net worth to track your progress on the Net Worth page.
                    </p>
                </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}

export default function FinancialSettingsPage() {
    return (
        <MainLayout>
            <FinancialSettings />
        </MainLayout>
    )
}
