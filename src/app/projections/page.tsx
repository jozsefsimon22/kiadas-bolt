
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartLegend, ChartLegendContent, ChartConfig } from "@/components/ui/chart";
import { CartesianGrid, Area, ComposedChart, XAxis, YAxis, Line } from "recharts";
import { Info, TrendingUp, Loader2 } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCurrency } from '@/context/currency-context';
import { useProjectionSettings } from '@/context/projection-settings-context';
import { formatCurrency } from '@/lib/currency';
import { subMonths, isWithinInterval, addMonths, subYears, eachMonthOfInterval, endOfMonth, format, isAfter, isSameMonth } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getConversionRate } from '@/services/currency-service';
import { getHistoricalData, HistoricalDataPoint } from '@/services/investment-service';
import { useToast } from '@/hooks/use-toast';

type ValueChange = { id: string; value: number; date: Date; };
type Contribution = { id: string; amount: number; date: Date; };
type Asset = {
  id: string;
  name: string;
  currency: string;
  valueHistory: ValueChange[];
  contributions: Contribution[];
};

type SavingGoalContribution = {
  id: string;
  amount: number;
  date: Date;
};
type SavingGoal = {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  targetDate: Date;
  startDate: Date;
  contributions: SavingGoalContribution[];
};

type Liability = { 
    id: string; 
    currentBalance: number 
};

type InvestmentTransaction = { id: string; date: Date; shares: number; price: number; currency: string; };
type Investment = { id: string; userId: string; ticker: string; name: string; transactions: InvestmentTransaction[]; };


const projectionSchema = z.object({
  projectionYears: z.coerce.number().int().min(1, "Must project at least 1 year."),
  annualGrowthRate: z.coerce.number().min(0, "Growth rate can't be negative."),
  monthlyContribution: z.coerce.number().min(0, "Contribution can't be negative."),
});

const chartConfig = {
  netWorth: {
    label: "Historical Net Worth",
    color: "hsl(var(--chart-2))",
  },
  initialCapital: {
    label: "Initial Capital",
    color: "hsl(var(--chart-3))",
  },
  contributions: {
    label: "Contributions",
    color: "hsl(var(--chart-4))",
  },
  interest: {
    label: "Growth",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;


function Projections() {
  const user = useAuth();
  const { toast } = useToast();
  const { currency } = useCurrency();
  const { defaultMonthlyContribution: savedDefaultContribution } = useProjectionSettings();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [historicalInvestmentData, setHistoricalInvestmentData] = useState(new Map<string, HistoricalDataPoint[]>());
  const [conversionRates, setConversionRates] = useState(new Map<string, number>());

  const [loading, setLoading] = useState(true);
  const [initialContributionSet, setInitialContributionSet] = useState(false);
  const [showHistory, setShowHistory] = useState(true);

  useEffect(() => {
    async function fetchData() {
        if (!user) return;
        setLoading(true);
        try {
            const assetsQuery = query(collection(db, 'assets'), where('userId', '==', user.uid));
            const savingsQuery = query(collection(db, 'savings'), where('userId', '==', user.uid));
            const liabilitiesQuery = query(collection(db, 'liabilities'), where('userId', '==', user.uid));
            const investmentsQuery = query(collection(db, 'investments'), where('userId', '==', user.uid));
            
            const [assetsSnapshot, savingsSnapshot, liabilitiesSnapshot, investmentsSnapshot] = await Promise.all([
              getDocs(assetsQuery),
              getDocs(savingsQuery),
              getDocs(liabilitiesQuery),
              getDocs(investmentsQuery)
            ]);

            const assetsList = assetsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    currency: data.currency || 'USD',
                    valueHistory: (data.valueHistory || []).map((v: any) => ({ ...v, date: v.date.toDate() })),
                    contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() })),
                } as Asset;
            });
            setAssets(assetsList);
            
            const savingsList = savingsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    startDate: data.startDate.toDate(),
                    targetDate: data.targetDate.toDate(),
                    contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() })),
                } as SavingGoal;
            });
            setSavingsGoals(savingsList);

            const liabilitiesList = liabilitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Liability[];
            setLiabilities(liabilitiesList);

            const investmentsToProcess = investmentsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                id: doc.id, ...data,
                transactions: (data.transactions || []).map((t: any) => ({ ...t, date: t.date.toDate() })),
                } as Investment;
            });
            setInvestments(investmentsToProcess);

            // Fetch conversion rates
            const rates = new Map<string, number>();
            rates.set(currency, 1);
            const uniqueAssetCurrencies = assetsList.map(a => a.currency);
            const uniqueInvestmentCurrencies = investmentsToProcess.flatMap(i => i.transactions.map(t => t.currency));
            const uniqueCurrencies = [...new Set([...uniqueAssetCurrencies, ...uniqueInvestmentCurrencies, 'USD'])].filter(c => c !== currency);
            

            await Promise.all(
              uniqueCurrencies.map(async (assetCurrency) => {
                if (!rates.has(assetCurrency) && assetCurrency) {
                  const rate = await getConversionRate(assetCurrency, currency);
                  rates.set(assetCurrency, rate);
                }
              })
            );
            setConversionRates(rates);
            
            // Fetch historical investment data
            if (investmentsToProcess.length > 0) {
                const allTransactions = investmentsToProcess.flatMap(inv => inv.transactions);
                const earliestTxDate = allTransactions.length > 0
                    ? allTransactions.reduce((earliest, tx) => tx.date < earliest ? tx.date : earliest, new Date())
                    : new Date();

                const uniqueTickers = [...new Set(investmentsToProcess.map(inv => inv.ticker))];
                const historicalData = new Map<string, HistoricalDataPoint[]>();
                
                await Promise.all(uniqueTickers.map(async (ticker) => {
                    const history = await getHistoricalData(ticker, earliestTxDate);
                    if (history) {
                        historicalData.set(ticker, history.prices);
                    }
                }));
                setHistoricalInvestmentData(historicalData);
            }

        } catch (error) {
            toast({ variant: 'destructive', title: "Error", description: "Could not load all financial data." });
        } finally {
            setLoading(false);
        }
    }
    fetchData();
  }, [user, currency, toast]);

  const monthlyContributionRate = useMemo(() => {
    if (loading || conversionRates.size === 0) return 0;

    const today = new Date();
    const twelveMonthsAgo = subMonths(today, 12);

    const totalAssetContributions = assets
      .flatMap(asset => asset.contributions || [])
      .filter(c => isWithinInterval(c.date, { start: twelveMonthsAgo, end: today }))
      .reduce((sum, c) => sum + c.amount, 0);

    const totalSavingsContributions = savingsGoals
      .flatMap(goal => goal.contributions)
      .filter(c => isWithinInterval(c.date, { start: twelveMonthsAgo, end: today }))
      .reduce((sum, c) => sum + c.amount, 0);
    
    const totalInvestmentContributions = investments
        .flatMap(inv => inv.transactions || [])
        .filter(t => t.shares > 0 && isWithinInterval(t.date, { start: twelveMonthsAgo, end: today }))
        .reduce((sum, t) => {
            const rate = conversionRates.get(t.currency) || 1;
            return sum + (t.price * t.shares * rate);
        }, 0);

    const totalContributions = totalAssetContributions + totalSavingsContributions + totalInvestmentContributions;
    
    return totalContributions / 12;
  }, [assets, savingsGoals, investments, loading, conversionRates]);

  const form = useForm<z.infer<typeof projectionSchema>>({
    resolver: zodResolver(projectionSchema),
    defaultValues: {
      projectionYears: 10,
      annualGrowthRate: 7,
      monthlyContribution: 0,
    },
  });
  
  const { setValue } = form;

  useEffect(() => {
    if (!loading && !initialContributionSet) {
      if (savedDefaultContribution !== null && savedDefaultContribution >= 0) {
        setValue('monthlyContribution', savedDefaultContribution);
      } else if (monthlyContributionRate >= 0) {
        setValue('monthlyContribution', parseFloat(monthlyContributionRate.toFixed(0)));
      }
      setInitialContributionSet(true);
    }
  }, [loading, monthlyContributionRate, setValue, initialContributionSet, savedDefaultContribution]);

  const formValues = form.watch();

  const { projectionData, finalValue, totalContributions, totalInterest, tableData } = useMemo(() => {
    const defaultResult = { projectionData: [], finalValue: 0, totalContributions: 0, totalInterest: 0, tableData: [] };
    if (loading || conversionRates.size === 0) return defaultResult;
    
    const rawFormValues = form.getValues();
    const projectionYears = Number(rawFormValues.projectionYears) || 0;
    const annualGrowthRate = Number(rawFormValues.annualGrowthRate) || 0;
    const monthlyContribution = Number(rawFormValues.monthlyContribution) || 0;

    if (isNaN(projectionYears) || isNaN(annualGrowthRate) || isNaN(monthlyContribution)) {
        return defaultResult;
    }
    
    const getInvestmentValueForDate = (investment: Investment, date: Date): number => {
        const sharesOnDate = investment.transactions
            .filter(t => t.date <= date)
            .reduce((sum, t) => sum + t.shares, 0);

        if (sharesOnDate === 0) return 0;
        
        const history = historicalInvestmentData.get(investment.ticker);
        if (!history || history.length === 0) return 0;

        const relevantPrice = [...history]
            .filter(p => new Date(p.date) <= date)
            .pop();
        
        const price = relevantPrice?.close ?? 0;
        const usdToGlobalRate = conversionRates.get('USD') || 1;
        
        return sharesOnDate * price * usdToGlobalRate;
    };
    
    const getAssetValueForDate = (asset: Asset, date: Date): number => {
        const rate = conversionRates.get(asset.currency) || 1;
        const relevantValueEntry = asset.valueHistory
            .filter(vh => vh.date <= date)
            .sort((a,b) => b.date.getTime() - a.date.getTime())[0];
        const nativeValue = relevantValueEntry ? relevantValueEntry.value : 0;
        return nativeValue * rate;
    };

    const assetsTotal = assets.reduce((sum, asset) => sum + getAssetValueForDate(asset, new Date()), 0);
    const savingsTotal = savingsGoals.reduce((total, goal) => total + goal.contributions.reduce((cTotal, c) => cTotal + c.amount, 0), 0);
    const liabilitiesTotal = liabilities.reduce((sum, liability) => sum + liability.currentBalance, 0);
    const investmentsTotal = investments.reduce((sum, inv) => sum + getInvestmentValueForDate(inv, new Date()), 0);
    const currentNetWorth = assetsTotal + savingsTotal + investmentsTotal - liabilitiesTotal;
    
    let chartData: { date: Date, netWorth?: number | null, initialCapital?: number | null, contributions?: number | null, interest?: number | null }[] = [];

    const allAssetStartDates = assets.flatMap(a => a.valueHistory.map(vh => vh.date));
    const allSavingsStartDates = savingsGoals.map(g => g.startDate);
    const allInvestmentStartDates = investments.flatMap(i => i.transactions.map(t => t.date));
    const allStartDates = [...allAssetStartDates, ...allSavingsStartDates, ...allInvestmentStartDates];

    const today = new Date();
    if (allStartDates.length > 0) {
        const fiveYearsAgo = subYears(today, 5);
        const earliestDate = allStartDates.reduce((earliest, date) => date < earliest ? date : earliest, today);
        const startDate = isAfter(fiveYearsAgo, earliestDate) ? fiveYearsAgo : earliestDate;
        
        if (isAfter(today, startDate)) {
            const months = eachMonthOfInterval({ start: startDate, end: today });
            for (const month of months) {
                const monthEnd = endOfMonth(month);
                if (isAfter(today, monthEnd) || isSameMonth(today, monthEnd)) {
                    const assetsValue = assets.reduce((sum, asset) => sum + getAssetValueForDate(asset, monthEnd), 0);
                    const savingsValue = savingsGoals.reduce((total, goal) => total + goal.contributions.filter(c => c.date <= monthEnd).reduce((sum, c) => sum + c.amount, 0), 0);
                    const investmentsValue = investments.reduce((sum, inv) => sum + getInvestmentValueForDate(inv, monthEnd), 0);
                    const netWorthForMonth = assetsValue + savingsValue + investmentsValue - liabilitiesTotal;
                    chartData.push({ date: month, netWorth: parseFloat(netWorthForMonth.toFixed(2)) });
                }
            }
        }
    }
    
    const historicalDataPoints = chartData.map(d => ({ ...d }));
    // The connection point between history and future
    historicalDataPoints.push({ date: today, netWorth: currentNetWorth, initialCapital: currentNetWorth, contributions: 0, interest: 0 });

    let projectedValue = currentNetWorth;
    const monthlyGrowthRate = annualGrowthRate / 100 / 12;
    let cumulativeContributions = 0;
    
    const futureDataPoints = [];
    for (let i = 0; i < projectionYears * 12; i++) {
      projectedValue += monthlyContribution;
      projectedValue *= (1 + monthlyGrowthRate);
      cumulativeContributions += monthlyContribution;
      const interestSoFar = projectedValue - currentNetWorth - cumulativeContributions;

      futureDataPoints.push({
        date: addMonths(today, i + 1),
        netWorth: null,
        initialCapital: currentNetWorth,
        contributions: cumulativeContributions,
        interest: interestSoFar,
      });
    }

    const fullProjectionData = [...historicalDataPoints, ...futureDataPoints];
    
    const chartDataForRender = showHistory
      ? fullProjectionData
      : [historicalDataPoints[historicalDataPoints.length - 1], ...futureDataPoints];

    const finalDataPoint = fullProjectionData[fullProjectionData.length - 1];
    const finalVal = finalDataPoint.initialCapital! + finalDataPoint.contributions! + finalDataPoint.interest!;
    const totalContrib = finalDataPoint.contributions!;
    const totalInt = finalDataPoint.interest!;
    
    const yearlyTableData: {year: number, projectedNetWorth: number}[] = [];
    const currentYear = today.getFullYear();
    yearlyTableData.push({ year: currentYear, projectedNetWorth: currentNetWorth });

    for (let i = 1; i <= projectionYears; i++) {
        const yearDataPoint = futureDataPoints[(i * 12) - 1];
        if(yearDataPoint) {
            const projectedNetWorth = yearDataPoint.initialCapital! + yearDataPoint.contributions! + yearDataPoint.interest!;
            yearlyTableData.push({ year: currentYear + i, projectedNetWorth });
        }
    }
    
    return { projectionData: chartDataForRender, finalValue: finalVal, totalContributions: totalContrib, totalInterest: totalInt, tableData: yearlyTableData };
  }, [assets, savingsGoals, liabilities, investments, historicalInvestmentData, conversionRates, formValues, loading, showHistory]);

  const currencyOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        const isHistory = data.netWorth !== null && data.netWorth !== undefined;
        
        const totalProjected = data.initialCapital + data.contributions + data.interest;

        return (
            <div className="rounded-lg border bg-background/95 p-2 text-xs shadow-lg backdrop-blur-sm animate-in fade-in-0 zoom-in-95">
                <p className="font-bold mb-1 border-b pb-1">{format(new Date(data.date), 'MMMM yyyy')}</p>
                {isHistory ? (
                     <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">Historical Net Worth</span>
                        <span className="font-mono font-semibold">{formatCurrency(data.netWorth, currency, currencyOptions)}</span>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4">
                            <span className="font-semibold">Projected Net Worth</span>
                            <span className="font-mono font-semibold">{formatCurrency(totalProjected, currency, currencyOptions)}</span>
                        </div>
                        <div className="pl-2 space-y-1 text-muted-foreground">
                             <div className="flex items-center justify-between gap-4">
                                <span>Initial</span>
                                <span className="font-mono">{formatCurrency(data.initialCapital, currency, currencyOptions)}</span>
                            </div>
                             <div className="flex items-center justify-between gap-4">
                                <span>Contributions</span>
                                <span className="font-mono">{formatCurrency(data.contributions, currency, currencyOptions)}</span>
                            </div>
                             <div className="flex items-center justify-between gap-4">
                                <span>Growth</span>
                                <span className="font-mono">{formatCurrency(data.interest, currency, currencyOptions)}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }
    return null;
  };

  return (
    <>
      <Header title="Net Worth Projections" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-6 w-6 text-primary" />
                        Projection Settings
                    </CardTitle>
                    <CardDescription>
                        Your default monthly contribution is now based on the last 12 months of savings. Adjust any value to see your financial future change instantly.
                    </CardDescription>
                </CardHeader>
                <Form {...form}>
                    <form>
                        <CardContent className="grid gap-4 sm:grid-cols-3">
                            <FormItem className="pt-2">
                                <FormLabel>Projection Period (Years)</FormLabel>
                                <div className="pt-2">
                                    <div className="grid grid-cols-5 gap-2">
                                        {[5, 10, 15, 20, 30].map((years) => (
                                            <Button
                                                key={years}
                                                type="button"
                                                variant={formValues.projectionYears === years ? 'default' : 'outline'}
                                                onClick={() => form.setValue('projectionYears', years)}
                                                className="w-full"
                                            >
                                                {years}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            </FormItem>
                            <FormItem className="pt-2">
                                <FormLabel>Avg. Annual Growth Rate (%)</FormLabel>
                                <FormControl className="pt-2">
                                    <Input type="number" step="0.1" {...form.register('annualGrowthRate')} onFocus={(e) => e.target.select()} />
                                </FormControl>
                                <FormMessage>{form.formState.errors.annualGrowthRate?.message}</FormMessage>
                            </FormItem>
                            <FormItem className="pt-2">
                                <FormLabel>Monthly Contribution</FormLabel>
                                <FormControl className="pt-2">
                                    <Input type="number" step="50" {...form.register('monthlyContribution')} onFocus={(e) => e.target.select()} />
                                </FormControl>
                                <FormMessage>{form.formState.errors.monthlyContribution?.message}</FormMessage>
                            </FormItem>
                        </CardContent>
                    </form>
                </Form>
            </Card>
            
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                        <div>
                            <CardTitle>Your Projected Growth</CardTitle>
                            <CardDescription>
                                A visualization of your potential net worth over time, including historical data.
                            </CardDescription>
                        </div>
                        <div className="flex items-center space-x-2 self-start sm:self-center pt-2">
                            <Switch
                                id="show-history"
                                checked={showHistory}
                                onCheckedChange={setShowHistory}
                            />
                            <Label htmlFor="show-history">Show History</Label>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex flex-col items-center justify-center text-center h-[400px]">
                            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
                            <p className="mt-4 text-lg font-medium">Loading your financial data...</p>
                        </div>
                    ) : projectionData.length > 0 ? (
                        <>
                            <div className="md:hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Year</TableHead>
                                            <TableHead className="text-right">Projected Net Worth</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {tableData.map((data) => (
                                            <TableRow key={data.year}>
                                                <TableCell className="font-medium">{data.year}</TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {formatCurrency(data.projectedNetWorth, currency, currencyOptions)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            <div className="hidden md:block">
                                <ChartContainer config={chartConfig} className="h-[400px] w-full">
                                    <ComposedChart data={projectionData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" tickFormatter={(value) => format(new Date(value), 'MMM yy')} />
                                        <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => formatCurrency(Number(value), currency, { notation: 'compact' })} domain={['auto', 'auto']} />
                                        <ChartTooltip cursor={true} content={<CustomTooltip />} />
                                        <ChartLegend content={<ChartLegendContent />} />
                                        
                                        <Area dataKey="initialCapital" type="monotone" fill="var(--color-initialCapital)" stroke="var(--color-initialCapital)" stackId="1" name="Initial Capital" />
                                        <Area dataKey="contributions" type="monotone" fill="var(--color-contributions)" stroke="var(--color-contributions)" stackId="1" name="Contributions" />
                                        <Area dataKey="interest" type="monotone" fill="var(--color-interest)" stroke="var(--color-interest)" stackId="1" name="Growth" />
                                        
                                        <Line dataKey="netWorth" type="monotone" stroke="var(--color-netWorth)" strokeWidth={2} dot={false} name="Historical Net Worth" connectNulls />
                                    </ComposedChart>
                                </ChartContainer>

                                <div className="mt-6 border-t pt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                                    <div>
                                        <p className="text-sm text-muted-foreground">Ending Balance</p>
                                        <p className="text-xl font-bold tracking-tight">{formatCurrency(finalValue, currency, currencyOptions)}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-muted-foreground">Total Contributions</p>
                                        <p className="text-xl font-bold tracking-tight">{formatCurrency(totalContributions, currency, currencyOptions)}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-muted-foreground">Total Interest Earned</p>
                                        <p className="text-xl font-bold tracking-tight">{formatCurrency(totalInterest, currency, currencyOptions)}</p>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center h-[400px] border-2 border-dashed rounded-lg">
                            <Info className="h-12 w-12 text-muted-foreground" />
                            <p className="mt-4 text-lg font-medium">Add an asset to get started.</p>
                            <p className="text-muted-foreground">Projections require at least one asset to be tracked.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
      </main>
    </>
  );
}

export default function ProjectionsPage() {
    return (
        <MainLayout>
            <Projections />
        </MainLayout>
    )
}
