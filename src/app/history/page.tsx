
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { eachMonthOfInterval, endOfMonth, format, startOfToday, isAfter } from 'date-fns';
import { Loader2, Info, ArrowUp, ArrowDown } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { getHistoricalData, HistoricalDataPoint } from '@/services/investment-service';
import { getConversionRate } from '@/services/currency-service';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Contribution = {
  id: string;
  amount: number;
  date: Date;
};
type ValueChange = {
  id: string;
  value: number;
  date: Date;
}
type Asset = {
  id: string;
  userId: string;
  name: string;
  currency: string;
  valueHistory: ValueChange[];
  contributions: Contribution[];
};

type Liability = { 
    id: string; 
    name: string; 
    currentBalance: number 
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

type InvestmentTransaction = { id: string; date: Date; shares: number; price: number; currency: string; };
type Investment = { id: string; userId: string; ticker: string; name: string; transactions: InvestmentTransaction[]; };


type HistoricalData = {
  chartData: { month: string; netWorth: number }[];
  monthlyBreakdowns: { [month: string]: { name: string; value: number }[] };
}

type SelectedData = {
    month: string;
    netWorth: number;
    breakdown: { name: string; value: number; type: 'Asset' | 'Savings' | 'Investment' | 'Liability' }[];
}

type SortableKey = 'name' | 'type' | 'value';

const chartConfig = {
  netWorth: {
    label: "Net Worth",
    color: "hsl(var(--primary))",
  },
};

function History() {
  const user = useAuth();
  const { currency } = useCurrency();
  const { toast } = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [historicalInvestmentData, setHistoricalInvestmentData] = useState(new Map<string, HistoricalDataPoint[]>());
  const [conversionRates, setConversionRates] = useState(new Map<string, number>());
  const [loading, setLoading] = useState(true);
  const [selectedData, setSelectedData] = useState<SelectedData | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: SortableKey, direction: 'ascending' | 'descending' }>({ key: 'value', direction: 'descending' });

  useEffect(() => {
    if (!user) return;
    
    async function fetchData() {
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
                    contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
                } as Asset;
            });
            
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

            const liabilitiesList = liabilitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Liability));
            
            const investmentsToProcess = investmentsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                id: doc.id, ...data,
                transactions: (data.transactions || []).map((t: any) => ({ ...t, date: t.date.toDate() })),
                } as Investment;
            });

            setAssets(assetsList);
            setSavingsGoals(savingsList);
            setLiabilities(liabilitiesList);
            setInvestments(investmentsToProcess);
            
            const rates = new Map<string, number>();
            rates.set(currency, 1);
            const uniqueCurrencies = [...new Set(assetsList.map(a => a.currency).filter(c => c !== currency))];
            uniqueCurrencies.push('USD'); // Always need USD for stock prices

            await Promise.all(
              uniqueCurrencies.map(async (assetCurrency) => {
                if (!rates.has(assetCurrency) && assetCurrency) {
                  const rate = await getConversionRate(assetCurrency, currency);
                  rates.set(assetCurrency, rate);
                }
              })
            );
            setConversionRates(rates);

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
        } catch(error) {
            console.error("Error fetching net worth history:", error);
            toast({ variant: 'destructive', title: "Error", description: "Could not load history data." });
        } finally {
            setLoading(false);
        }
    }

    fetchData();
  }, [user, currency, toast]);

  const historicalData: HistoricalData = useMemo(() => {
    if (loading || (assets.length === 0 && savingsGoals.length === 0 && liabilities.length === 0 && investments.length === 0) || conversionRates.size === 0) {
      return { chartData: [], monthlyBreakdowns: {} };
    }

    const allAssetStartDates = assets.flatMap(a => a.valueHistory.map(vh => vh.date));
    const allSavingsStartDates = savingsGoals.map(g => g.startDate);
    const allInvestmentStartDates = investments.flatMap(i => i.transactions.map(t => t.date));
    const allStartDates = [...allAssetStartDates, ...allSavingsStartDates, ...allInvestmentStartDates];
    
    const totalCurrentLiabilities = liabilities.reduce((sum, l) => sum + l.currentBalance, 0);

    if (allStartDates.length === 0) {
        if (totalCurrentLiabilities > 0) {
            return {
                chartData: [{ month: format(new Date(), 'MMMM yyyy'), netWorth: -totalCurrentLiabilities }],
                monthlyBreakdowns: { [format(new Date(), 'MMMM yyyy')]: liabilities.map(l => ({ name: l.name, value: -l.currentBalance, type: 'Liability' })) }
            };
        }
        return { chartData: [], monthlyBreakdowns: {} };
    }

    const earliestDate = allStartDates.reduce((earliest, date) => 
        date < earliest ? date : earliest, 
        new Date()
    );

    const today = startOfToday();
    if (earliestDate > today) {
        return { chartData: [], monthlyBreakdowns: {} };
    }
    const months = eachMonthOfInterval({ start: earliestDate, end: today });

    const chartData: HistoricalData['chartData'] = [];
    const monthlyBreakdowns: HistoricalData['monthlyBreakdowns'] = {};
    const usdToGlobalRate = conversionRates.get('USD') || 1;

    months.forEach(month => {
      const monthEnd = endOfMonth(month);
      const monthKey = format(month, 'MMMM yyyy');
      
      let totalGrossWorthForMonth = 0;
      const breakdownForMonth: SelectedData['breakdown'] = [];

      assets.forEach(asset => {
        const sortedHistory = [...asset.valueHistory].sort((a,b) => a.date.getTime() - b.date.getTime());
        const lastValueBeforeMonthEnd = sortedHistory.filter(vh => vh.date <= monthEnd).pop();

        if (lastValueBeforeMonthEnd) {
          const rate = conversionRates.get(asset.currency) || 1;
          const convertedValue = lastValueBeforeMonthEnd.value * rate;
          totalGrossWorthForMonth += convertedValue;
          breakdownForMonth.push({ name: asset.name, value: convertedValue, type: 'Asset' });
        }
      });
      
      let totalSavingsForMonth = 0;
      savingsGoals.forEach(goal => {
        if (goal.startDate > monthEnd) {
          return;
        }
        const savedInGoalForMonth = goal.contributions
          .filter(c => c.date <= monthEnd)
          .reduce((sum, c) => sum + c.amount, 0);
        totalSavingsForMonth += savedInGoalForMonth;
      });

      if (totalSavingsForMonth > 0) {
        breakdownForMonth.push({ name: 'Savings Goals', value: totalSavingsForMonth, type: 'Savings' });
      }
      
      let totalInvestmentValueForMonth = 0;
      investments.forEach(investment => {
        const sharesOnDate = investment.transactions
          .filter(t => t.date <= monthEnd)
          .reduce((sum, t) => sum + t.shares, 0);

        if (sharesOnDate > 0) {
          const history = historicalInvestmentData.get(investment.ticker);
          if (history && history.length > 0) {
            const relevantPrice = [...history]
                .filter(p => new Date(p.date) <= monthEnd)
                .pop();
            const price = relevantPrice?.close ?? 0;
            const value = sharesOnDate * price * usdToGlobalRate;
            totalInvestmentValueForMonth += value;
            breakdownForMonth.push({ name: investment.name, value: value, type: 'Investment' });
          }
        }
      });

      totalGrossWorthForMonth += totalSavingsForMonth + totalInvestmentValueForMonth;

      chartData.push({ month: monthKey, netWorth: totalGrossWorthForMonth - totalCurrentLiabilities });
      monthlyBreakdowns[monthKey] = breakdownForMonth;
    });

    const currentAssetsNetWorth = assets.reduce((sum, asset) => {
        const latestValue = asset.valueHistory.length > 0 ? [...asset.valueHistory].sort((a,b) => b.date.getTime() - a.date.getTime())[0].value : 0;
        const rate = conversionRates.get(asset.currency) || 1;
        return sum + (latestValue * rate);
    }, 0);
    const currentSavingsNetWorth = savingsGoals.reduce((total, goal) => total + goal.contributions.reduce((cTotal, c) => cTotal + c.amount, 0), 0);
    
    let currentInvestmentNetWorth = 0;
    investments.forEach(investment => {
        const shares = investment.transactions.reduce((sum, t) => sum + t.shares, 0);
        if (shares > 0) {
            const history = historicalInvestmentData.get(investment.ticker);
            if (history && history.length > 0) {
                const lastPrice = history[history.length - 1].close;
                currentInvestmentNetWorth += shares * lastPrice * usdToGlobalRate;
            }
        }
    });

    const currentNetWorth = currentAssetsNetWorth + currentSavingsNetWorth + currentInvestmentNetWorth - totalCurrentLiabilities;
    const currentMonthKey = format(today, 'MMMM yyyy');
    const lastChartDataPoint = chartData[chartData.length - 1];

    if (lastChartDataPoint && lastChartDataPoint.month === currentMonthKey) {
        lastChartDataPoint.netWorth = currentNetWorth;
    } else if (isAfter(today, endOfMonth(new Date(chartData[chartData.length - 1]?.month))) || chartData.length === 0) {
        if (currentNetWorth !== 0 || liabilities.length > 0) {
           chartData.push({ month: currentMonthKey, netWorth: currentNetWorth });
        }
    }
    
    const currentBreakdown: SelectedData['breakdown'] = [
        ...assets.map(a => {
             const latestValue = a.valueHistory.length > 0 ? [...a.valueHistory].sort((a,b) => a.date.getTime() - b.date.getTime())[0].value : 0;
             const rate = conversionRates.get(a.currency) || 1;
            return { name: a.name, value: latestValue * rate, type: 'Asset' as const }
        }),
    ];
    if(currentSavingsNetWorth > 0) {
        currentBreakdown.push({name: 'Savings Goals', value: currentSavingsNetWorth, type: 'Savings' as const});
    }
     investments.forEach(investment => {
        const shares = investment.transactions.reduce((sum, t) => sum + t.shares, 0);
        if (shares > 0) {
            const history = historicalInvestmentData.get(investment.ticker);
            if (history && history.length > 0) {
                const lastPrice = history[history.length - 1].close;
                currentBreakdown.push({ name: investment.name, value: shares * lastPrice * usdToGlobalRate, type: 'Investment' as const });
            }
        }
    });

    monthlyBreakdowns[currentMonthKey] = currentBreakdown;

    return { chartData, monthlyBreakdowns };
  }, [assets, savingsGoals, liabilities, investments, historicalInvestmentData, conversionRates, loading]);
  
   useEffect(() => {
    if (historicalData.chartData.length > 0 && !selectedData) {
      const lastDataPoint = historicalData.chartData[historicalData.chartData.length - 1];
      const breakdown = historicalData.monthlyBreakdowns[lastDataPoint.month] || [];
      const fullBreakdown: SelectedData['breakdown'] = [
          ...breakdown,
          ...liabilities.map(l => ({ name: l.name, value: -l.currentBalance, type: 'Liability' as const})),
      ]
      setSelectedData({
        month: lastDataPoint.month,
        netWorth: lastDataPoint.netWorth,
        breakdown: fullBreakdown,
      });
    }
  }, [historicalData, selectedData, liabilities]);

  const handleChartClick = (data: any) => {
    if (data && data.activePayload && data.activePayload.length > 0) {
      const payload = data.activePayload[0].payload;
      const breakdown = historicalData.monthlyBreakdowns[payload.month] || [];
      const fullBreakdown: SelectedData['breakdown'] = [
          ...breakdown,
          ...liabilities.map(l => ({ name: l.name, value: -l.currentBalance, type: 'Liability' as const}))
      ];
      setSelectedData({ ...payload, breakdown: fullBreakdown });
    }
  };
  
  const summaryValues = useMemo(() => {
    if (!selectedData) return { totalAssets: 0, totalLiabilities: 0 };
    const totalAssets = selectedData.breakdown
      .filter(item => item.type === 'Asset' || item.type === 'Investment' || item.type === 'Savings')
      .reduce((sum, item) => sum + item.value, 0);
    const totalLiabilities = selectedData.breakdown
      .filter(item => item.type === 'Liability')
      .reduce((sum, item) => sum + Math.abs(item.value), 0);
    return { totalAssets, totalLiabilities };
  }, [selectedData]);

  const currencyOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

  const requestSort = (key: SortableKey) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
        direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const sortedBreakdown = useMemo(() => {
    if (!selectedData) return [];
    return [...selectedData.breakdown].sort((a, b) => {
        if (sortConfig.key === 'value') {
            return sortConfig.direction === 'ascending' ? a.value - b.value : b.value - a.value;
        }
        if (sortConfig.key === 'name' || sortConfig.key === 'type') {
            return sortConfig.direction === 'ascending' ? a[sortConfig.key].localeCompare(b[sortConfig.key]) : b[sortConfig.key].localeCompare(a[sortConfig.key]);
        }
        return 0;
    });
  }, [selectedData, sortConfig]);

  const SortableHeader = ({ title, sortKey, className }: { title: string, sortKey: SortableKey, className?: string }) => (
    <TableHead className={cn('p-0', className)}>
      <Button variant="ghost" onClick={() => requestSort(sortKey)} className={cn("w-full h-auto py-3 px-4 font-semibold", className?.includes('text-right') ? 'justify-end' : 'justify-start')}>
        {title}
        {sortConfig.key === sortKey && (
            sortConfig.direction === 'ascending' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />
        )}
      </Button>
    </TableHead>
  );

  if (loading) {
    return (
      <>
        <Header title="Net Worth History" />
        <main className="flex-1 p-4 sm:p-6 text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
        </main>
      </>
    );
  }

  if (assets.length === 0 && savingsGoals.length === 0 && liabilities.length === 0 && investments.length === 0) {
     return (
        <>
        <Header title="Net Worth History" />
        <main className="flex-1 space-y-6 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto w-full">
                <Alert>
                        <Info className="h-4 w-4" />
                        <AlertTitle>No historical data yet!</AlertTitle>
                        <AlertDescription>
                        Add some assets, investments, liabilities, or savings goals to start tracking your net worth history.
                        </AlertDescription>
                    </Alert>
            </div>
        </main>
        </>
     )
  }

  return (
    <>
      <Header title="Net Worth History" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            {selectedData && (
                <div className="grid gap-6 md:grid-cols-3">
                    <Card>
                        <CardHeader><CardTitle>Net Worth for {selectedData.month}</CardTitle></CardHeader>
                        <CardContent><p className="text-3xl font-bold tracking-tight text-primary">{formatCurrency(selectedData.netWorth, currency, currencyOptions)}</p></CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Total Assets</CardTitle></CardHeader>
                        <CardContent><p className="text-3xl font-bold tracking-tight">{formatCurrency(summaryValues.totalAssets, currency, currencyOptions)}</p></CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Total Liabilities</CardTitle></CardHeader>
                        <CardContent><p className="text-3xl font-bold tracking-tight text-destructive">{formatCurrency(summaryValues.totalLiabilities, currency, currencyOptions)}</p></CardContent>
                    </Card>
                </div>
            )}
        
            <Card>
            <CardHeader>
                <CardTitle>Net Worth Over Time</CardTitle>
                <CardDescription>
                A visual history of your net worth over time. Click on a point to see the breakdown.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ChartContainer config={chartConfig} className="h-[400px] w-full">
                <LineChart
                    accessibilityLayer
                    data={historicalData.chartData}
                    margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
                    onClick={handleChartClick}
                >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => value.slice(0, 3)}
                    />
                    <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => formatCurrency(Number(value), currency, { notation: 'compact' })}
                    domain={['auto', 'auto']}
                    />
                    <ChartTooltip
                    cursor={true}
                    content={<ChartTooltipContent 
                        formatter={(value) => formatCurrency(Number(value), currency, currencyOptions)}
                        indicator="dot"
                        labelFormatter={(label, payload) => payload?.[0]?.payload.month || label}
                    />}
                    />
                    <Line
                    dataKey="netWorth"
                    type="monotone"
                    stroke="var(--color-netWorth)"
                    strokeWidth={3}
                    dot={{ r: 6, fill: 'var(--color-netWorth)', strokeWidth: 2, stroke: 'hsl(var(--background))', cursor: 'pointer' }}
                    activeDot={{ r: 8, fill: 'var(--color-netWorth)', strokeWidth: 2, stroke: 'hsl(var(--background))', cursor: 'pointer' }}
                    />
                </LineChart>
                </ChartContainer>
            </CardContent>
            </Card>

            {selectedData && (
            <Card>
                <CardHeader>
                <CardTitle>Breakdown for {selectedData.month}</CardTitle>
                <CardDescription>
                    The estimated assets and liabilities that made up your net worth of {formatCurrency(selectedData.netWorth, currency, currencyOptions)}.
                </CardDescription>
                </CardHeader>
                <CardContent>
                <Table>
                    <TableHeader>
                    <TableRow>
                        <SortableHeader title="Item" sortKey="name" />
                        <SortableHeader title="Type" sortKey="type" />
                        <SortableHeader title="Value" sortKey="value" className="text-right" />
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {sortedBreakdown.map((item, index) => (
                        <TableRow key={`${item.type}-${item.name}-${index}`}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.type}</TableCell>
                        <TableCell className={`text-right font-mono ${item.value < 0 ? 'text-destructive' : ''}`}>{formatCurrency(item.value, currency, currencyOptions)}</TableCell>
                        </TableRow>
                    ))}
                    </TableBody>
                </Table>
                </CardContent>
            </Card>
            )}
        </div>
      </main>
    </>
  );
}


export default function HistoryPage() {
    return (
        <MainLayout>
            <History />
        </MainLayout>
    )
}
