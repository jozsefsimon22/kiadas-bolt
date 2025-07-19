
'use client';

import { useParams, useRouter } from 'next/navigation';
import React, { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, eachMonthOfInterval, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { CartesianGrid, AreaChart as RechartsAreaChart, Area, Legend, XAxis, YAxis } from "recharts";
import { BarChart, Home, Landmark, Wallet, TrendingUp, DollarSign, CalendarIcon, PlusCircle, Edit, Trash2, Loader2, ChevronLeft, CandlestickChart, ArrowUpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as ShadcnCalendar } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { getConversionRate } from '@/services/currency-service';
import { ScrollArea } from '@/components/ui/scroll-area';
import { defaultAssetTypes, DefaultCategory } from '@/lib/categories';
import DynamicIcon from '@/components/dynamic-icon';

type AssetType = string;
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
  type: AssetType;
  currency: string;
  valueHistory: ValueChange[];
  contributions: Contribution[];
};

type Category = DefaultCategory & {
  id: string;
  userId?: string;
  isDefault?: boolean;
};

const contributionSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Contribution amount must be positive.'),
  date: z.date({
    required_error: "A date for the contribution is required.",
  }),
});

const valueChangeSchema = z.object({
  value: z.coerce.number().min(0, 'Value must be a positive number.'),
  date: z.date({
    required_error: "A date for the value update is required.",
  }),
});

const assetSchema = z.object({
  name: z.string().min(1, 'Asset name is required.'),
  type: z.string().min(1, 'Asset type is required.'),
  currency: z.string().length(3, 'A currency is required.'),
});

const transactionIcons: Record<string, React.ReactNode> = {
    'Initial Value': <CandlestickChart className="h-5 w-5 text-muted-foreground" />,
    'Contribution': <DollarSign className="h-5 w-5 text-muted-foreground" />,
    'Value Update': <TrendingUp className="h-5 w-5 text-muted-foreground" />,
}

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

function AssetDetail() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const assetId = params.id as string;
  const { toast } = useToast();
  const { currency: globalCurrency } = useCurrency();
  
  const [asset, setAsset] = useState<Asset | null>(null);
  const [assetTypes, setAssetTypes] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [conversionRate, setConversionRate] = useState(1);

  const [isAssetDialogOpen, setIsAssetDialogOpen] = useState(false);
  const [isContribDialogOpen, setIsContribDialogOpen] = useState(false);
  const [isValueUpdateDialogOpen, setIsValueUpdateDialogOpen] = useState(false);
  
  const [isDeleteContribConfirmOpen, setIsDeleteContribConfirmOpen] = useState(false);
  const [isDeleteValueConfirmOpen, setIsDeleteValueConfirmOpen] = useState(false);
  
  const [editingContribution, setEditingContribution] = useState<Contribution | null>(null);
  const [contributionToDelete, setContributionToDelete] = useState<Contribution | null>(null);
  
  const [editingValueChange, setEditingValueChange] = useState<ValueChange | null>(null);
  const [valueChangeToDelete, setValueChangeToDelete] = useState<ValueChange | null>(null);

  const contributionForm = useForm<z.infer<typeof contributionSchema>>({
    resolver: zodResolver(contributionSchema),
  });
  
  const valueChangeForm = useForm<z.infer<typeof valueChangeSchema>>({
    resolver: zodResolver(valueChangeSchema),
  });

  const assetForm = useForm<z.infer<typeof assetSchema>>({
    resolver: zodResolver(assetSchema),
  });

  async function fetchAsset() {
    if (!assetId || !user) return;
    setLoading(true);

    const assetRef = doc(db, 'assets', assetId);
    const assetTypesQuery = query(collection(db, 'assetTypes'), where('userId', '==', user.uid));

    const [assetSnap, assetTypesSnapshot] = await Promise.all([
        getDoc(assetRef),
        getDocs(assetTypesQuery),
    ]);

    const customAssetTypes = assetTypesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
    const allAssetTypes = [
        ...defaultAssetTypes.map(c => ({...c, id: `default-${c.name}`, isDefault: true})), 
        ...customAssetTypes
    ].sort((a,b) => a.name.localeCompare(b.name));
    setAssetTypes(allAssetTypes);

    if (assetSnap.exists()) {
        const data = assetSnap.data();
        if (data.userId !== user.uid) {
            toast({ variant: 'destructive', title: 'Access Denied', description: 'You do not have permission to view this asset.'});
            router.push('/assets');
            return;
        }
        const fetchedAsset = {
            id: assetSnap.id,
            ...data,
            currency: data.currency || 'USD',
            valueHistory: (data.valueHistory || []).map((v: any) => ({ ...v, date: v.date.toDate() })),
            contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
        } as Asset;
        setAsset(fetchedAsset);

        if (fetchedAsset.currency !== globalCurrency) {
            const rate = await getConversionRate(fetchedAsset.currency, globalCurrency);
            setConversionRate(rate);
        } else {
            setConversionRate(1);
        }

    } else {
        toast({ variant: 'destructive', title: 'Not Found', description: 'This asset does not exist.'});
        setAsset(null);
    }
    setLoading(false);
  }
  
  useEffect(() => {
    fetchAsset();
  }, [assetId, user, globalCurrency]);
  
  useEffect(() => {
    if (asset && isAssetDialogOpen) {
      assetForm.reset({ name: asset.name, type: asset.type, currency: asset.currency });
    }
  }, [asset, isAssetDialogOpen, assetForm]);

  useEffect(() => {
    if (isContribDialogOpen) {
      if (editingContribution) {
        contributionForm.reset(editingContribution);
      } else {
        contributionForm.reset({ amount: 0, date: new Date() });
      }
    }
  }, [editingContribution, isContribDialogOpen, contributionForm]);
  
  useEffect(() => {
    if (isValueUpdateDialogOpen) {
      if (editingValueChange) {
        valueChangeForm.reset(editingValueChange);
      } else {
        const latestValue = asset?.valueHistory.sort((a,b) => b.date.getTime() - a.date.getTime())[0]?.value || 0;
        valueChangeForm.reset({ value: latestValue, date: new Date() });
      }
    }
  }, [editingValueChange, isValueUpdateDialogOpen, valueChangeForm, asset]);

  const handleContributionSubmit = async (values: z.infer<typeof contributionSchema>) => {
    if (!asset) return;

    let updatedContributions;
    if (editingContribution) {
      updatedContributions = asset.contributions.map(c => 
        c.id === editingContribution.id ? { ...c, ...values } : c
      );
    } else {
      const newContribution = { ...values, id: crypto.randomUUID() };
      updatedContributions = [...asset.contributions, newContribution];
    }
    
    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { contributions: updatedContributions });
        toast({ title: editingContribution ? "Contribution Updated" : "Contribution Added" });
        fetchAsset();
    } catch(error) {
        console.error("Error saving contribution: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not save contribution." });
    } finally {
        setIsContribDialogOpen(false);
        setEditingContribution(null);
    }
  };

  const handleDeleteContribution = async () => {
    if (!asset || !contributionToDelete) return;
    
    const updatedContributions = asset.contributions.filter(c => c.id !== contributionToDelete.id);

    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { contributions: updatedContributions });
        toast({ title: "Contribution Deleted" });
        fetchAsset();
    } catch (error) {
        console.error("Error deleting contribution: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not delete contribution." });
    } finally {
        setIsDeleteContribConfirmOpen(false);
        setContributionToDelete(null);
    }
  };
  
  const handleValueUpdateSubmit = async (values: z.infer<typeof valueChangeSchema>) => {
    if (!asset) return;

    let updatedValueHistory;
    if (editingValueChange) {
      updatedValueHistory = asset.valueHistory.map(v => 
        v.id === editingValueChange.id ? { ...v, ...values } : v
      );
    } else {
      const newValueChange = { ...values, id: crypto.randomUUID() };
      updatedValueHistory = [...asset.valueHistory, newValueChange];
    }
    
    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { valueHistory: updatedValueHistory });
        toast({ title: editingValueChange ? "Value Updated" : "Value Added" });
        fetchAsset();
    } catch(error) {
        console.error("Error saving value update: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not save value update." });
    } finally {
        setIsValueUpdateDialogOpen(false);
        setEditingValueChange(null);
    }
  };

  const handleDeleteValueChange = async () => {
    if (!asset || !valueChangeToDelete) return;
    
    if (asset.valueHistory.length <= 1) {
        toast({ variant: 'destructive', title: "Error", description: "An asset must have at least one value entry." });
        setIsDeleteValueConfirmOpen(false);
        setValueChangeToDelete(null);
        return;
    }

    const updatedValueHistory = asset.valueHistory.filter(v => v.id !== valueChangeToDelete.id);

    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { valueHistory: updatedValueHistory });
        toast({ title: "Value entry deleted" });
        fetchAsset();
    } catch (error) {
        console.error("Error deleting value entry: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not delete value entry." });
    } finally {
        setIsDeleteValueConfirmOpen(false);
        setValueChangeToDelete(null);
    }
  };

  const handleAssetSubmit = async (values: z.infer<typeof assetSchema>) => {
    if (!asset) return;
    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { name: values.name, type: values.type, currency: values.currency });
        toast({ title: "Asset Updated" });
        fetchAsset();
    } catch (error) {
        console.error("Error updating asset: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not update asset." });
    } finally {
        setIsAssetDialogOpen(false);
    }
  };

  const assetTypesMap = useMemo(() => new Map(assetTypes.map(t => [t.name, t])), [assetTypes]);

  const {
    assetEvents,
    recentAssetEvents,
    totalGrowth,
    totalInvested,
    currentValue,
    startDate,
    stackedChartData,
    nativeCurrentValue,
    nativeTotalInvested,
    nativeTotalGrowth
  } = useMemo(() => {
    const defaultReturn = { assetEvents: [], recentAssetEvents: [], totalGrowth: 0, totalInvested: 0, currentValue: 0, startDate: new Date(), stackedChartData: [], nativeCurrentValue: 0, nativeTotalInvested: 0, nativeTotalGrowth: 0 };
    if (!asset) return defaultReturn;

    const sortedHistory = [...asset.valueHistory].sort((a, b) => a.date.getTime() - b.date.getTime());
    if (sortedHistory.length === 0) return defaultReturn;

    const initialValueNative = sortedHistory[0].value;
    const startDt = sortedHistory[0].date;
    const currentValueNative = sortedHistory[sortedHistory.length - 1].value;
    
    const totalContributionsNative = asset.contributions.reduce((sum, c) => sum + c.amount, 0);
    const totalInvestedNative = initialValueNative + totalContributionsNative;
    const totalGrowthNative = currentValueNative - totalInvestedNative;

    const currentVal = currentValueNative * conversionRate;
    const totalInv = totalInvestedNative * conversionRate;
    const growth = currentVal - totalInv;

    const contributionEvents = asset.contributions.map(c => ({
      id: c.id,
      date: c.date,
      type: 'Contribution' as const,
      amount: c.amount,
      isContribution: true,
      original: c,
    }));
    
    const valueUpdateEvents = sortedHistory.map((vc, index) => ({
      id: vc.id,
      date: vc.date,
      type: (index === 0 ? 'Initial Value' : 'Value Update') as const,
      amount: vc.value,
      isContribution: false,
      original: vc,
    }));

    const allEvents = [...contributionEvents, ...valueUpdateEvents].sort((a, b) => b.date.getTime() - a.date.getTime());
    const recentEvents = allEvents.slice(0, 3);
    
    const dataPoints = [];
    if (asset && asset.valueHistory.length > 0) {
        const sortedContributions = [...asset.contributions].sort((a, b) => a.date.getTime() - b.date.getTime());
        const today = new Date();
        const intervalStart = startDt < today ? startDt : today;
        const months = eachMonthOfInterval({ start: intervalStart, end: today });
        
        for (const month of months) {
            const monthEnd = endOfMonth(month);

            const valueOnDateNative = sortedHistory.findLast(v => v.date <= monthEnd)?.value ?? 0;
            const contributionsOnDateNative = sortedContributions.filter(c => c.date <= monthEnd).reduce((sum, c) => sum + c.amount, 0);
            
            const totalInvestedOnDateNative = initialValueNative + contributionsOnDateNative;
            const growthOnDateNative = valueOnDateNative - totalInvestedOnDateNative;

            dataPoints.push({
                date: format(month, 'MMM yy'),
                initialCapital: initialValueNative * conversionRate,
                contributions: contributionsOnDateNative * conversionRate,
                growth: growthOnDateNative * conversionRate,
                totalValue: valueOnDateNative * conversionRate,
            });
        }
    }

    return { 
      assetEvents: allEvents,
      recentAssetEvents: recentEvents,
      totalGrowth: growth, 
      totalInvested: totalInv,
      currentValue: currentVal,
      startDate: startDt,
      stackedChartData: dataPoints,
      nativeCurrentValue: currentValueNative,
      nativeTotalInvested: totalInvestedNative,
      nativeTotalGrowth: totalGrowthNative,
    };
  }, [asset, conversionRate]);

  const contributionDisabledDates = useMemo(() => {
    const disabled: ({ after: Date } | { before: Date })[] = [{ after: new Date() }];
    if (startDate) {
      disabled.push({ before: startDate });
    }
    return disabled;
  }, [startDate]);
  
  if (loading) {
     return (
        <>
          <Header title="Loading Asset..." />
          <main className="flex-1 p-4 sm:p-6 text-center">
             <Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
          </main>
        </>
     )
  }

  if (!asset) {
    return (
      <>
        <Header title="Asset Not Found" />
        <main className="flex-1 space-y-4 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto w-full">
                <Button asChild variant="outline">
                    <Link href="/assets"><ChevronLeft className="mr-2 h-4 w-4" />Back to Assets</Link>
                </Button>
                <div className="text-center pt-8">
                    <Card className="inline-block">
                    <CardHeader>
                        <CardTitle>Asset not found</CardTitle>
                        <CardDescription>The asset you are looking for does not exist.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Please return to the assets page.</p>
                    </CardContent>
                    </Card>
                </div>
            </div>
        </main>
      </>
    );
  }

  const growthColor = totalGrowth >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <>
      <Header title={asset.name} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
                <Button asChild variant="outline">
                    <Link href="/assets"><ChevronLeft className="mr-2 h-4 w-4" />Back to Assets</Link>
                </Button>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsAssetDialogOpen(true)}><Edit className="mr-2 h-4 w-4" /> Edit Asset</Button>
                </div>
            </div>
            
            <Card>
            <CardHeader>
                <div className="flex items-center gap-4">
                    <DynamicIcon name={assetTypesMap.get(asset.type)?.icon || 'Landmark'} className="h-8 w-8 text-primary" />
                <div>
                    <CardTitle className="text-3xl">{asset.name} ({asset.currency})</CardTitle>
                    <CardDescription>Asset type: {asset.type} &middot; Values displayed in {globalCurrency}.</CardDescription>
                </div>
                </div>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-3">
                <Card>
                    <CardHeader><CardTitle>Current Value</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold tracking-tight">{formatCurrency(currentValue, globalCurrency)}</p>
                        {asset.currency !== globalCurrency && (
                            <p className="text-sm text-muted-foreground mt-1">{formatCurrency(nativeCurrentValue, asset.currency)}</p>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Total Invested</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold tracking-tight">{formatCurrency(totalInvested, globalCurrency)}</p>
                        {asset.currency !== globalCurrency && (
                            <p className="text-sm text-muted-foreground mt-1">{formatCurrency(nativeTotalInvested, asset.currency)}</p>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Total Growth</CardTitle></CardHeader>
                    <CardContent>
                        <p className={`text-3xl font-bold tracking-tight ${growthColor}`}>{formatCurrency(totalGrowth, globalCurrency)}</p>
                        {asset.currency !== globalCurrency && (
                            <p className={`text-sm mt-1 ${nativeTotalGrowth >= 0 ? 'text-muted-foreground' : 'text-red-400'}`}>
                                {formatCurrency(nativeTotalGrowth, asset.currency)}
                            </p>
                        )}
                    </CardContent>
                </Card>
            </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Value Over Time</CardTitle>
                        <CardDescription>A breakdown of your asset's value from contributions and market growth.</CardDescription>
                    </CardHeader>
                    <CardContent>
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
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
                            <Area dataKey="growth" type="monotone" fill="var(--color-growth)" stroke="var(--color-growth)" stackId="1" name="growth" />
                        </RechartsAreaChart>
                    </ChartContainer>
                    </CardContent>
                </Card>
                
                <Card className="flex flex-col">
                    <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>Recent Asset Events</CardTitle>
                            <CardDescription>A log of the last 3 financial events in {asset.currency}.</CardDescription>
                        </div>
                        <div className="flex w-full gap-2 sm:w-auto">
                            <Button size="sm" className="flex-1 sm:flex-grow-0" onClick={() => { setIsValueUpdateDialogOpen(true); }}><TrendingUp className="mr-2 h-4 w-4" /> Update Value</Button>
                            <Button size="sm" className="flex-1 sm:flex-grow-0" onClick={() => { setIsContribDialogOpen(true); }}><PlusCircle className="mr-2 h-4 w-4" /> Add Contribution</Button>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-grow">
                        {recentAssetEvents.length > 0 ? (
                            <ScrollArea className="h-full max-h-72">
                                <div className="space-y-4 pr-4">
                                    {recentAssetEvents.map(event => (
                                        <Card key={`${event.type}-${event.id}`} className="p-4 flex justify-between items-center">
                                            <div className="flex items-center gap-3">
                                                {transactionIcons[event.type]}
                                                <div>
                                                    <p className="font-medium">{event.type}</p>
                                                    <p className="text-sm text-muted-foreground">{formatDate(event.date)}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className={`font-mono ${event.type === 'Contribution' ? (event.amount > 0 ? 'text-green-400' : 'text-red-400') : ''}`}>{formatCurrency(event.amount, asset.currency)}</p>
                                                <div className="-mr-2">
                                                    <Button variant="ghost" size="icon" onClick={() => { 
                                                        if (event.isContribution) { setEditingContribution(event.original as Contribution); setIsContribDialogOpen(true); } 
                                                        else { setEditingValueChange(event.original as ValueChange); setIsValueUpdateDialogOpen(true); }
                                                    }}><Edit className="h-4 w-4" /></Button>
                                                    <Button variant="ghost" size="icon" onClick={() => { 
                                                        if (event.isContribution) { setContributionToDelete(event.original as Contribution); setIsDeleteContribConfirmOpen(true); } 
                                                        else { setValueChangeToDelete(event.original as ValueChange); setIsDeleteValueConfirmOpen(true); }
                                                    }}><Trash2 className="h-4 w-4" /></Button>
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            </ScrollArea>
                        ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                            No asset events yet.
                        </div>
                        )}
                    </CardContent>
                    {(assetEvents.length > 3) && (
                        <CardFooter>
                            <Button asChild variant="outline" className="w-full">
                                <Link href={`/asset/${asset.id}/history`}>
                                    View All Events
                                </Link>
                            </Button>
                        </CardFooter>
                    )}
                </Card>
            </div>
        </div>
      </main>

      {/* Contribution Add/Edit Dialog */}
      <Dialog open={isContribDialogOpen} onOpenChange={setIsContribDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingContribution ? 'Edit Contribution' : 'Add Contribution'}</DialogTitle>
          </DialogHeader>
          <Form {...contributionForm}>
            <form onSubmit={contributionForm.handleSubmit(handleContributionSubmit)} className="space-y-4 py-4">
              <FormField control={contributionForm.control} name="amount" render={({ field }) => (
                <FormItem><FormLabel>Amount ({asset.currency})</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={contributionForm.control} name="date" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date</FormLabel>
                  <Popover><PopoverTrigger asChild>
                      <FormControl>
                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                          {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                  </PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                      <ShadcnCalendar mode="single" selected={field.value} onSelect={field.onChange} disabled={contributionDisabledDates} />
                  </PopoverContent></Popover>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsContribDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingContribution ? 'Update' : 'Add'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Value Update Add/Edit Dialog */}
      <Dialog open={isValueUpdateDialogOpen} onOpenChange={setIsValueUpdateDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingValueChange ? 'Edit Value' : 'Add Value Update'}</DialogTitle>
          </DialogHeader>
          <Form {...valueChangeForm}>
            <form onSubmit={valueChangeForm.handleSubmit(handleValueUpdateSubmit)} className="space-y-4 py-4">
              <FormField control={valueChangeForm.control} name="value" render={({ field }) => (
                <FormItem><FormLabel>New Total Value ({asset.currency})</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={valueChangeForm.control} name="date" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date of Value</FormLabel>
                  <Popover><PopoverTrigger asChild>
                      <FormControl>
                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                          {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                  </PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                      <ShadcnCalendar mode="single" selected={field.value} onSelect={field.onChange} disabled={contributionDisabledDates} />
                  </PopoverContent></Popover>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsValueUpdateDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingValueChange ? 'Update' : 'Add'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Asset Edit Dialog */}
      <Dialog open={isAssetDialogOpen} onOpenChange={setIsAssetDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          <Form {...assetForm}>
            <form onSubmit={assetForm.handleSubmit(handleAssetSubmit)} className="space-y-4 py-4">
              <FormField control={assetForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Asset Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={assetForm.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                        {assetTypes.map(type => (
                            <SelectItem key={type.id} value={type.name}>{type.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={assetForm.control} name="currency" render={({ field }) => (
                <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                            <SelectItem value="USD">USD - US Dollar</SelectItem>
                            <SelectItem value="EUR">EUR - Euro</SelectItem>
                            <SelectItem value="GBP">GBP - British Pound</SelectItem>
                            <SelectItem value="JPY">JPY - Japanese Yen</SelectItem>
                            <SelectItem value="CAD">CAD - Canadian Dollar</SelectItem>
                            <SelectItem value="AUD">AUD - Australian Dollar</SelectItem>
                            <SelectItem value="HUF">HUF - Hungarian Forint</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAssetDialogOpen(false)}>Cancel</Button>
                <Button type="submit">Update Asset</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Delete Contribution Confirmation */}
      <AlertDialog open={isDeleteContribConfirmOpen} onOpenChange={setIsDeleteContribConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete this contribution record.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setContributionToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContribution}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Value Confirmation */}
      <AlertDialog open={isDeleteValueConfirmOpen} onOpenChange={setIsDeleteValueConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete this value entry.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setValueChangeToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteValueChange}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AssetDetailPage() {
    return (
        <MainLayout>
            <AssetDetail />
        </MainLayout>
    );
}
