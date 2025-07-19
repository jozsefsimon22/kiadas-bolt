
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, eachMonthOfInterval, endOfMonth, startOfDay, parseISO } from "date-fns";
import { cn } from '@/lib/utils';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CandlestickChart, PlusCircle, Edit, Trash2, Loader2, ChevronLeft, Landmark, ArrowUpCircle, TrendingUp, HandCoins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as ShadcnCalendar } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { getConversionRate } from '@/services/currency-service';
import { getStockPrice, getHistoricalData, HistoricalDataPoint, Dividend } from '@/services/investment-service';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon } from 'lucide-react';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart as RechartsAreaChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts";


type InvestmentTransaction = {
  id: string;
  date: Date;
  shares: number;
  price: number;
  currency: string;
};
type Investment = {
  id: string;
  userId: string;
  ticker: string;
  name: string;
  transactions: InvestmentTransaction[];
};

const transactionSchema = z.object({
  shares: z.coerce.number().refine(val => val !== 0, 'Shares cannot be zero.'),
  price: z.coerce.number().positive('Price per share must be positive.'),
  currency: z.string().length(3, 'A currency is required.'),
  date: z.date({
    required_error: "A date for the transaction is required.",
  }),
});

const formatDate = (date: Date) => {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

const chartConfig = {
  initialCapital: {
    label: "Initial Capital",
    color: "hsl(var(--chart-3))",
    icon: Landmark,
  },
  contributions: {
    label: "Contributions",
    color: "hsl(var(--chart-2))",
    icon: ArrowUpCircle,
  },
  growth: {
    label: "Growth",
    color: "hsl(var(--chart-1))",
    icon: TrendingUp,
  },
} satisfies ChartConfig;


function InvestmentDetail() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const investmentId = params.id as string;
  const { toast } = useToast();
  const { currency: globalCurrency } = useCurrency();
  
  const [investment, setInvestment] = useState<Investment | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [historicalPriceData, setHistoricalPriceData] = useState<HistoricalDataPoint[]>([]);
  const [dividendData, setDividendData] = useState<Dividend[]>([]);
  const [usdToGlobalRate, setUsdToGlobalRate] = useState(1);
  const [transactionRates, setTransactionRates] = useState<Map<string, number>>(new Map());
  const [currentPriceData, setCurrentPriceData] = useState<{price: number, change: number, changePercent: number} | null>(null);

  const [isTxDialogOpen, setIsTxDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  
  const [editingTransaction, setEditingTransaction] = useState<InvestmentTransaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<InvestmentTransaction | null>(null);

  const transactionForm = useForm<z.infer<typeof transactionSchema>>({
    resolver: zodResolver(transactionSchema),
  });

  async function fetchInvestment() {
    if (!investmentId || !user) return;
    setLoading(true);

    const investmentRef = doc(db, 'investments', investmentId);
    const investmentSnap = await getDoc(investmentRef);

    if (investmentSnap.exists()) {
      const data = investmentSnap.data();
      if (data.userId !== user.uid) {
        toast({ variant: 'destructive', title: 'Access Denied' });
        router.push('/investments');
        return;
      }
      const fetchedInvestment = {
        id: investmentSnap.id,
        ...data,
        transactions: (data.transactions || []).map((t: any) => ({ ...t, currency: t.currency || 'USD', date: t.date.toDate() })),
      } as Investment;
      setInvestment(fetchedInvestment);

      const priceData = await getStockPrice(fetchedInvestment.ticker);
      setCurrentPriceData(priceData);
      setIsPriceLoading(false);

      if (fetchedInvestment.transactions.length > 0) {
        const earliestTx = fetchedInvestment.transactions.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
        const history = await getHistoricalData(fetchedInvestment.ticker, earliestTx.date);
        setHistoricalPriceData(history?.prices || []);
        setDividendData(history?.dividends || []);
      }

      if (globalCurrency !== 'USD') {
        const rate = await getConversionRate('USD', globalCurrency);
        setUsdToGlobalRate(rate);
      } else {
        setUsdToGlobalRate(1);
      }
      
      const uniqueCurrencies = [...new Set(fetchedInvestment.transactions.map(t => t.currency))];
      const rates = new Map<string, number>();
      await Promise.all(
        uniqueCurrencies.map(async (curr) => {
          if (curr !== globalCurrency) {
            const rate = await getConversionRate(curr, globalCurrency);
rates.set(curr, rate);
          } else {
            rates.set(curr, 1);
          }
        })
      );
      setTransactionRates(rates);

    } else {
      toast({ variant: 'destructive', title: 'Not Found' });
      router.push('/investments');
    }
    setLoading(false);
  }
  
  useEffect(() => {
    fetchInvestment();
  }, [investmentId, user, globalCurrency]);
  
  useEffect(() => {
    if (isTxDialogOpen) {
      if (editingTransaction) {
        transactionForm.reset(editingTransaction);
      } else {
        transactionForm.reset({ shares: 0, price: 0, currency: globalCurrency, date: new Date() });
      }
    }
  }, [editingTransaction, isTxDialogOpen, transactionForm, globalCurrency]);

  const handleTransactionSubmit = async (values: z.infer<typeof transactionSchema>) => {
    if (!investment) return;

    let updatedTransactions;
    if (editingTransaction) {
      updatedTransactions = investment.transactions.map(t => 
        t.id === editingTransaction.id ? { ...t, ...values } : t
      );
    } else {
      const newTransaction = { ...values, id: crypto.randomUUID() };
      updatedTransactions = [...investment.transactions, newTransaction];
    }
    
    try {
      const investmentRef = doc(db, "investments", investment.id);
      await updateDoc(investmentRef, { transactions: updatedTransactions });
      toast({ title: editingTransaction ? "Transaction Updated" : "Transaction Added" });
      fetchInvestment();
    } catch(error) {
      console.error("Error saving transaction: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not save transaction." });
    } finally {
      setIsTxDialogOpen(false);
      setEditingTransaction(null);
    }
  };

  const handleDeleteTransaction = async () => {
    if (!investment || !transactionToDelete) return;
    
    if (investment.transactions.length <= 1) {
        toast({ variant: 'destructive', title: "Error", description: "An investment must have at least one transaction." });
        setIsDeleteConfirmOpen(false);
        setTransactionToDelete(null);
        return;
    }

    const updatedTransactions = investment.transactions.filter(t => t.id !== transactionToDelete.id);

    try {
      const investmentRef = doc(db, "investments", investment.id);
      await updateDoc(investmentRef, { transactions: updatedTransactions });
      toast({ title: "Transaction Deleted" });
      fetchInvestment();
    } catch (error) {
      console.error("Error deleting transaction: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not delete transaction." });
    } finally {
      setIsDeleteConfirmOpen(false);
      setTransactionToDelete(null);
    }
  };

  const {
    totalShares,
    currentValue,
    totalCost,
    totalGainLoss,
    totalGainLossPercent,
  } = useMemo(() => {
    if (!investment || !currentPriceData || transactionRates.size === 0) return { totalShares: 0, currentValue: 0, totalCost: 0, totalGainLoss: 0, totalGainLossPercent: 0 };

    const shares = investment.transactions.reduce((sum, t) => sum + t.shares, 0);
    const value = shares * currentPriceData.price * usdToGlobalRate;

    const cost = investment.transactions.reduce((sum, t) => {
        const rate = transactionRates.get(t.currency) || 1;
        return sum + (t.shares * t.price * rate);
    }, 0);
    
    const gainLoss = value - cost;
    const gainLossPercent = cost > 0 ? (gainLoss / cost) * 100 : 0;

    return { 
      totalShares: shares,
      currentValue: value,
      totalCost: cost,
      totalGainLoss: gainLoss,
      totalGainLossPercent: gainLossPercent
    };
  }, [investment, currentPriceData, usdToGlobalRate, transactionRates]);
  
  const { totalDividends, relevantDividends } = useMemo(() => {
    if (!investment || dividendData.length === 0) return { totalDividends: 0, relevantDividends: [] };
    
    const sortedTransactions = [...investment.transactions].sort((a,b) => a.date.getTime() - b.date.getTime());
    let currentShares = 0;
    
    const relevantDivs = dividendData.map(div => {
      const divDate = parseISO(div.date);
      currentShares = sortedTransactions
        .filter(t => t.date <= divDate)
        .reduce((sum, t) => sum + t.shares, 0);
      
      if (currentShares > 0) {
        return { ...div, sharesHeld: currentShares, totalPayout: currentShares * div.amount };
      }
      return null;
    }).filter(Boolean) as (Dividend & { sharesHeld: number, totalPayout: number })[];

    const total = relevantDivs.reduce((sum, div) => sum + div.totalPayout, 0) * usdToGlobalRate;

    return { totalDividends: total, relevantDividends: relevantDivs.sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()) };
  }, [investment, dividendData, usdToGlobalRate]);

  const {stackedChartData, gradientStops} = useMemo(() => {
    if (!investment || historicalPriceData.length === 0 || transactionRates.size === 0) return {stackedChartData: [], gradientStops: []};

    const sortedTransactions = [...investment.transactions].sort((a,b) => a.date.getTime() - b.date.getTime());
    if (sortedTransactions.length === 0) return {stackedChartData: [], gradientStops: []};
    
    const startDate = startOfDay(sortedTransactions[0].date);
    const today = new Date();

    const months = eachMonthOfInterval({ start: startDate, end: today });
    const historicalDataMap = new Map(historicalPriceData.map(d => [d.date.split('T')[0], d.close]));
    
    const firstTxDate = startOfDay(sortedTransactions[0].date);
    
    const initialTxs = sortedTransactions.filter(t => startOfDay(t.date).getTime() === firstTxDate.getTime());
    const initialCapitalNative = initialTxs.reduce((sum, t) => sum + (t.shares * t.price), 0);
    const initialCapital = initialCapitalNative * (transactionRates.get(initialTxs[0].currency) || 1);

    const dataPoints = [];
    for (const month of months) {
        const monthEnd = endOfMonth(month);
        const monthEndDateStr = monthEnd.toISOString().split('T')[0];
        
        // Find closest historical price
        let priceOnDate = historicalDataMap.get(monthEndDateStr);
        let tempDate = monthEnd;
        while(!priceOnDate && tempDate > startDate) {
            tempDate = new Date(tempDate.setDate(tempDate.getDate() - 1));
            priceOnDate = historicalDataMap.get(tempDate.toISOString().split('T')[0]);
        }
        priceOnDate = priceOnDate || 0;

        const sharesOnDate = sortedTransactions
            .filter(t => t.date <= monthEnd)
            .reduce((sum, t) => sum + t.shares, 0);

        const valueOnDate = sharesOnDate * priceOnDate * usdToGlobalRate;

        const contributionsOnDate = sortedTransactions
            .filter(t => t.date <= monthEnd && startOfDay(t.date).getTime() > firstTxDate.getTime())
            .reduce((sum, t) => {
                const rate = transactionRates.get(t.currency) || 1;
                return sum + (t.shares * t.price * rate);
            }, 0);

        const totalInvestedOnDate = initialCapital + contributionsOnDate;
        const growthOnDate = valueOnDate - totalInvestedOnDate;

        dataPoints.push({
            date: format(month, 'MMM yy'),
            initialCapital: initialCapital,
            contributions: contributionsOnDate,
            growth: growthOnDate,
            totalValue: valueOnDate,
        });
    }

    const stops: { offset: string; color: string }[] = [];
    if (dataPoints.length > 1) {
        const gainColor = "hsl(var(--chart-1))";
        const lossColor = "hsl(var(--destructive))";

        dataPoints.forEach((point, i) => {
            const isLoss = point.growth < 0;
            const currentOffset = i / (dataPoints.length - 1);
            
            if (i > 0) {
                const prevPoint = dataPoints[i - 1];
                const prevIsLoss = prevPoint.growth < 0;

                if (isLoss !== prevIsLoss) {
                    const zeroCrossing = (0 - prevPoint.growth) / (point.growth - prevPoint.growth);
                    const crossingOffset = ((i - 1) + zeroCrossing) / (dataPoints.length - 1);
                    
                    if (Math.abs(crossingOffset - (i - 1) / (dataPoints.length - 1)) > 1e-6) {
                        stops.push({ offset: `${crossingOffset * 100}%`, color: prevIsLoss ? lossColor : gainColor });
                    }
                }
            }
            stops.push({ offset: `${currentOffset * 100}%`, color: isLoss ? lossColor : gainColor });
        });
    }

    return {stackedChartData: dataPoints, gradientStops: stops};

  }, [investment, historicalPriceData, usdToGlobalRate, transactionRates]);

  if (loading) {
     return (
        <>
          <Header title="Loading Investment..." />
          <main className="flex-1 p-4 sm:p-6 text-center">
             <Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
          </main>
        </>
     )
  }

  if (!investment) {
    return null; // Or some not found component
  }

  const gainLossColor = totalGainLoss >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <>
      <Header title={investment.name} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <div className="flex justify-start">
                <Button asChild variant="outline">
                    <Link href="/investments"><ChevronLeft className="mr-2 h-4 w-4" />Back to Investments</Link>
                </Button>
            </div>
            
            <Card>
              <CardHeader>
                <div className="flex items-center gap-4">
                  <CandlestickChart className="h-8 w-8 text-primary" />
                  <div>
                    <CardTitle className="text-3xl">{investment.name} ({investment.ticker})</CardTitle>
                    <CardDescription>Values displayed in {globalCurrency}.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                 <Card className="flex flex-col">
                    <CardHeader className="flex-grow"><CardTitle className="text-base font-medium">Current Value</CardTitle></CardHeader>
                    <CardContent>
                        {isPriceLoading ? <Skeleton className="h-9 w-3/4" /> : <p className="text-3xl font-bold tracking-tight">{formatCurrency(currentValue, globalCurrency)}</p>}
                    </CardContent>
                 </Card>
                  <Card className="flex flex-col">
                    <CardHeader className="flex-grow"><CardTitle className="text-base font-medium">Total Shares</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold tracking-tight">{totalShares.toLocaleString()}</p>
                    </CardContent>
                 </Card>
                 <Card className="flex flex-col">
                    <CardHeader className="flex-grow"><CardTitle className="text-base font-medium">Total Cost</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold tracking-tight">{formatCurrency(totalCost, globalCurrency)}</p>
                    </CardContent>
                 </Card>
                 <Card className="flex flex-col">
                    <CardHeader className="flex-grow"><CardTitle className="text-base font-medium">Total Gain/Loss</CardTitle></CardHeader>
                    <CardContent>
                        <p className={`text-3xl font-bold tracking-tight ${gainLossColor}`}>
                            <span>{formatCurrency(totalGainLoss, globalCurrency)}</span>
                            <span className="text-lg ml-2">({totalGainLossPercent.toFixed(2)}%)</span>
                        </p>
                    </CardContent>
                 </Card>
              </CardContent>
            </Card>
            
            {stackedChartData.length > 0 && (
                 <Card>
                    <CardHeader>
                        <CardTitle>Value Over Time</CardTitle>
                        <CardDescription>A breakdown of your investment's value from contributions and market growth.</CardDescription>
                    </CardHeader>
                    <CardContent>
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                        <svg width="0" height="0" style={{ position: 'absolute' }}>
                            <defs>
                                <linearGradient id="growthGradient" x1="0" y1="0" x2="1" y2="0">
                                    {gradientStops.map((stop, index) => (
                                        <stop key={index} offset={stop.offset} stopColor={stop.color} />
                                    ))}
                                </linearGradient>
                            </defs>
                        </svg>
                        <RechartsAreaChart data={stackedChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid vertical={false} strokeDasharray="3 3" />
                            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                            <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => formatCurrency(Number(value), globalCurrency, { notation: 'compact' })} />
                            <ChartTooltip 
                                content={<ChartTooltipContent
                                    labelFormatter={(label, payload) => {
                                        if (!payload || !payload.length) return label;
                                        return (
                                            <div className="space-y-1">
                                                <div>{payload[0].payload.date}</div>
                                                <div className="font-bold">Total: {formatCurrency(payload[0].payload.totalValue, globalCurrency)}</div>
                                            </div>
                                        )
                                    }} 
                                    formatter={(value, name, props) => {
                                        const config = chartConfig[name as keyof typeof chartConfig];
                                        if (!config) return null;
                                        return (
                                            <div className="flex items-center gap-1.5">
                                                {config.icon && React.createElement(config.icon, {className: 'h-3.5 w-3.5', style: { color: props.color }})}
                                                <span>{config.label}: {formatCurrency(Number(value), globalCurrency)}</span>
                                            </div>
                                        )
                                    }}
                                    indicator="dot"
                                />}
                            />
                             <Legend content={({ payload }) => (
                                <div className="flex gap-4 justify-center text-xs mt-2">
                                    {payload?.map((item) => {
                                        const config = chartConfig[item.dataKey as keyof typeof chartConfig];
                                        if (!config) return null;
                                        const Icon = config.icon;
                                        return (
                                            <div key={item.dataKey} className="flex items-center gap-1.5">
                                                <Icon className="h-3 w-3" style={{ color: item.color }} />
                                                <span>{config.label}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )} />
                            <Area dataKey="initialCapital" type="monotone" fill="var(--color-initialCapital)" stroke="var(--color-initialCapital)" stackId="1" name="initialCapital" />
                            <Area dataKey="contributions" type="monotone" fill="var(--color-contributions)" stroke="var(--color-contributions)" stackId="1" name="contributions" />
                            <Area dataKey="growth" type="monotone" fill="url(#growthGradient)" stroke="url(#growthGradient)" stackId="1" name="growth" />
                        </RechartsAreaChart>
                    </ChartContainer>
                    </CardContent>
                </Card>
            )}
            
            {relevantDividends.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><HandCoins className="h-6 w-6 text-primary" />Dividend History</CardTitle>
                  <CardDescription>
                    You've received a total of <span className="font-bold">{formatCurrency(totalDividends, globalCurrency)}</span> in dividends.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ex-Dividend Date</TableHead>
                        <TableHead className="text-right">Amount per Share</TableHead>
                        <TableHead className="text-right">Shares Held</TableHead>
                        <TableHead className="text-right">Total Payout</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {relevantDividends.map((div, i) => (
                        <TableRow key={i}>
                          <TableCell>{format(parseISO(div.date), 'PP')}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(div.amount, 'USD')}</TableCell>
                          <TableCell className="text-right">{div.sharesHeld.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(div.totalPayout, 'USD')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Transaction History</CardTitle>
                        <CardDescription>All buy and sell transactions for this holding.</CardDescription>
                    </div>
                    <Button onClick={() => setIsTxDialogOpen(true)}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Add Transaction
                    </Button>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Shares</TableHead>
                                <TableHead className="text-right">Price</TableHead>
                                <TableHead className="text-right">Total Cost</TableHead>
                                <TableHead className="text-right w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {investment.transactions.sort((a,b) => b.date.getTime() - a.date.getTime()).map(tx => (
                                <TableRow key={tx.id}>
                                    <TableCell>{formatDate(tx.date)}</TableCell>
                                    <TableCell className={tx.shares > 0 ? 'text-green-400' : 'text-red-400'}>{tx.shares > 0 ? 'Buy' : 'Sell'}</TableCell>
                                    <TableCell className="text-right">{tx.shares}</TableCell>
                                    <TableCell className="text-right font-mono">{formatCurrency(tx.price, tx.currency)}</TableCell>
                                    <TableCell className="text-right font-mono">{formatCurrency(tx.shares * tx.price, tx.currency)}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => { setEditingTransaction(tx); setIsTxDialogOpen(true); }}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => { setTransactionToDelete(tx); setIsDeleteConfirmOpen(true); }}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
      </main>

      <Dialog open={isTxDialogOpen} onOpenChange={setIsTxDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTransaction ? 'Edit Transaction' : 'Add Transaction'}</DialogTitle>
          </DialogHeader>
          <Form {...transactionForm}>
            <form onSubmit={transactionForm.handleSubmit(handleTransactionSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={transactionForm.control} name="shares" render={({ field }) => (
                    <FormItem><FormLabel>Shares</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={transactionForm.control} name="price" render={({ field }) => (
                    <FormItem><FormLabel>Price per Share</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={transactionForm.control} name="currency" render={({ field }) => (
                <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                            <SelectItem value="USD">USD - US Dollar</SelectItem>
                            <SelectItem value="EUR">EUR - Euro</SelectItem>
                            <SelectItem value="GBP">GBP - British Pound</SelectItem>
                            <SelectItem value="HUF">HUF - Hungarian Forint</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
              )} />
              <FormField control={transactionForm.control} name="date" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Transaction Date</FormLabel>
                  <Popover><PopoverTrigger asChild><FormControl>
                      <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                        {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                  </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                    <ShadcnCalendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date > new Date() || date < new Date('1900-01-01')} initialFocus />
                  </PopoverContent></Popover>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsTxDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingTransaction ? 'Update' : 'Add'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. This will permanently delete this transaction record.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTransactionToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTransaction}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function InvestmentDetailPage() {
    return (
        <MainLayout>
            <InvestmentDetail />
        </MainLayout>
    );
}

