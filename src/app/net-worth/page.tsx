
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { getConversionRate } from '@/services/currency-service';
import { getHistoricalData, HistoricalDataPoint } from '@/services/investment-service';
import { useToast } from '@/hooks/use-toast';
import { Loader2, TrendingUp, TrendingDown, Scale, PiggyBank, Landmark, Banknote, CandlestickChart, ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { defaultAssetTypes, DefaultCategory } from '@/lib/categories';
import DynamicIcon from '@/components/dynamic-icon';
import { useFinancialTargets } from '@/context/financial-targets-context';
import { Progress } from '@/components/ui/progress';
import { addMonths, format as formatDate, isWithinInterval, subMonths, endOfMonth, isSameMonth, startOfDay } from 'date-fns';
import { useProjectionSettings } from '@/context/projection-settings-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';


// Types
type AssetValueChange = { id: string; value: number; date: Date; };
type AssetContribution = { id: string; amount: number; date: Date; };
type Asset = { id: string; userId: string; name: string; type: string; currency: string; valueHistory: AssetValueChange[]; contributions: AssetContribution[]; };

type SavingGoalContribution = { id: string; amount: number; date: Date; };
type SavingGoal = { id: string; userId: string; name: string; targetAmount: number; targetDate: Date; startDate: Date; contributions: SavingGoalContribution[]; };

type Liability = { id: string; userId: string; name: string; type: 'credit_card' | 'loan' | 'mortgage' | 'other'; currentBalance: number; apr: number; };

type InvestmentTransaction = { id: string; date: Date; shares: number; price: number; currency: string; };
type Investment = { id: string; userId: string; ticker: string; name: string; transactions: InvestmentTransaction[]; };

type CombinedAsset = {
  id: string;
  name: string;
  type: string;
  icon: string;
  value: number;
  kind: 'asset' | 'savings' | 'investment';
  href: string;
};

type Category = DefaultCategory & {
  id:string;
  userId?:string;
  isDefault?: boolean;
}

type SortableKey = 'name' | 'type' | 'value';

const liabilityIcons: Record<Liability['type'], React.ReactNode> = {
  credit_card: <Banknote className="h-6 w-6 text-muted-foreground" />,
  loan: <Banknote className="h-6 w-6 text-muted-foreground" />,
  mortgage: <Banknote className="h-6 w-6 text-muted-foreground" />,
  other: <Banknote className="h-6 w-6 text-muted-foreground" />,
};

function NetWorth() {
    const user = useAuth();
    const { currency } = useCurrency();
    const { toast } = useToast();
    const [assets, setAssets] = useState<Asset[]>([]);
    const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
    const [liabilities, setLiabilities] = useState<Liability[]>([]);
    const [investments, setInvestments] = useState<Investment[]>([]);
    const [historicalInvestmentData, setHistoricalInvestmentData] = useState(new Map<string, HistoricalDataPoint[]>());
    const [assetTypes, setAssetTypes] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const { netWorthTarget } = useFinancialTargets();
    const { defaultMonthlyContribution: savedDefaultContribution } = useProjectionSettings();
    
    const [selectedMonth, setSelectedMonth] = useState(new Date());
    const [conversionRates, setConversionRates] = useState(new Map<string, number>());
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey, direction: 'ascending' | 'descending' }>({ key: 'value', direction: 'descending' });
    const [liabilitySortConfig, setLiabilitySortConfig] = useState<{ key: SortableKey, direction: 'ascending' | 'descending' }>({ key: 'value', direction: 'descending' });


    useEffect(() => {
        if (!user) return;
        async function fetchData() {
            setLoading(true);
            try {
                const assetsQuery = query(collection(db, 'assets'), where('userId', '==', user.uid));
                const savingsQuery = query(collection(db, 'savings'), where('userId', '==', user.uid));
                const liabilitiesQuery = query(collection(db, 'liabilities'), where('userId', '==', user.uid));
                const assetTypesQuery = query(collection(db, 'assetTypes'), where('userId', '==', user.uid));
                const investmentsQuery = query(collection(db, 'investments'), where('userId', '==', user.uid));

                const [assetsSnapshot, savingsSnapshot, liabilitiesSnapshot, assetTypesSnapshot, investmentsSnapshot] = await Promise.all([
                    getDocs(assetsQuery),
                    getDocs(savingsQuery),
                    getDocs(liabilitiesQuery),
                    getDocs(assetTypesQuery),
                    getDocs(investmentsQuery),
                ]);
                
                // Asset Types
                const customAssetTypes = assetTypesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
                setAssetTypes([
                    ...defaultAssetTypes.map(c => ({...c, id: `default-${c.name}`, isDefault: true})), 
                    ...customAssetTypes
                ]);

                // Liabilities
                const liabilitiesList = liabilitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Liability));
                setLiabilities(liabilitiesList);

                // Savings Goals
                const savingsList = savingsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return { id: doc.id, ...data, contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() })) } as SavingGoal;
                });
                setSavingsGoals(savingsList);

                // Assets (without currency conversion)
                const assetsToProcess = assetsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id, ...data,
                        currency: data.currency || 'USD',
                        valueHistory: (data.valueHistory || []).map((v: any) => ({ ...v, date: v.date.toDate() })),
                        contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
                    } as Asset;
                });
                setAssets(assetsToProcess);

                // Investments
                const investmentsToProcess = investmentsSnapshot.docs.map(doc => {
                  const data = doc.data();
                  return {
                    id: doc.id, ...data,
                    transactions: (data.transactions || []).map((t: any) => ({ ...t, date: t.date.toDate() })),
                  } as Investment;
                });
                setInvestments(investmentsToProcess);
                
                // Fetch all unique conversion rates needed
                const rates = new Map<string, number>();
                rates.set(currency, 1);
                const uniqueCurrencies = [...new Set(assetsToProcess.map(a => a.currency).filter(c => c !== currency))];
                uniqueCurrencies.push('USD'); // For investment prices
                
                await Promise.all(uniqueCurrencies.map(async (assetCurrency) => {
                    if (!rates.has(assetCurrency) && assetCurrency) {
                        const rate = await getConversionRate(assetCurrency, currency);
                        rates.set(assetCurrency, rate);
                    }
                }));
                setConversionRates(rates);
                
                // Fetch historical investment prices
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
                console.error("Error fetching net worth data:", error);
                toast({ variant: 'destructive', title: "Error", description: "Could not load your financial data." });
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [user, currency, toast]);
    
    const handleMonthChange = (months: number) => {
        setSelectedMonth(current => addMonths(current, months));
    };
    
    const isCurrentMonth = isSameMonth(selectedMonth, new Date());

    const formatLiabilityType = (type: Liability['type']) => {
        if (!type) return 'Other';
        return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    };
    
    const { totalAssets, totalLiabilities, totalNetWorth, sortedCombinedAssets, sortedLiabilities, estimatedTargetDate, assetTypeBreakdown, liabilityTypeBreakdown } = useMemo(() => {
        if (loading) return { totalAssets: 0, totalLiabilities: 0, totalNetWorth: 0, sortedCombinedAssets: [], sortedLiabilities: [], estimatedTargetDate: '', assetTypeBreakdown: [], liabilityTypeBreakdown: [] };

        const endDate = endOfMonth(selectedMonth);

        const getAssetValueForDate = (asset: Asset): number => {
            const rate = conversionRates.get(asset.currency) || 1;
            const relevantValueEntry = asset.valueHistory
                .filter(vh => vh.date <= endDate)
                .sort((a,b) => b.date.getTime() - a.date.getTime())[0];
            const nativeValue = relevantValueEntry ? relevantValueEntry.value : 0;
            return nativeValue * rate;
        };

        const getSavingsValueForDate = (goal: SavingGoal): number => {
            return goal.contributions
                .filter(c => c.date <= endDate)
                .reduce((sum, c) => sum + c.amount, 0);
        };
        
        const getInvestmentValueForDate = (investment: Investment): number => {
            const sharesOnDate = investment.transactions
                .filter(t => t.date <= endDate)
                .reduce((sum, t) => sum + t.shares, 0);

            if (sharesOnDate === 0) return 0;
            
            const history = historicalInvestmentData.get(investment.ticker);
            if (!history || history.length === 0) return 0;

            const relevantPrice = [...history]
                .filter(p => new Date(p.date) <= endDate)
                .pop(); // Already sorted by date ascending from service
            
            const price = relevantPrice?.close ?? 0;
            const usdToGlobalRate = conversionRates.get('USD') || 1;
            
            return sharesOnDate * price * usdToGlobalRate;
        };

        const assetsWithValue = assets.map(a => ({ ...a, value: getAssetValueForDate(a) }));
        const savingsWithValue = savingsGoals.map(g => ({ ...g, value: getSavingsValueForDate(g) }));
        const investmentsWithValue = investments.map(i => ({...i, value: getInvestmentValueForDate(i)}));

        const assetsValue = assetsWithValue.reduce((sum, asset) => sum + asset.value, 0);
        const savingsValue = savingsWithValue.reduce((sum, goal) => sum + goal.value, 0);
        const investmentsValue = investmentsWithValue.reduce((sum, inv) => sum + inv.value, 0);
        const liabilitiesValue = liabilities.reduce((sum, liability) => sum + liability.currentBalance, 0);
        const netWorth = assetsValue + savingsValue + investmentsValue - liabilitiesValue;

        const assetTypesMap = new Map(assetTypes.map(t => [t.name, t]));
        
        const combined: CombinedAsset[] = [
            ...assetsWithValue.map(a => ({ id: a.id, name: a.name, type: a.type, icon: assetTypesMap.get(a.type)?.icon || 'Landmark', value: a.value, kind: 'asset' as const, href: `/asset/${a.id}`})),
            ...savingsWithValue.map(g => ({ id: g.id, name: g.name, type: 'Savings Goal', icon: 'PiggyBank', value: g.value, kind: 'savings' as const, href: `/savings/${g.id}`})),
            ...investmentsWithValue.map(i => ({ id: i.id, name: i.name, type: 'Investment', icon: 'CandlestickChart', value: i.value, kind: 'investment' as const, href: `/investments/${i.id}`}))
        ];

        const sortedAssets = [...combined].sort((a, b) => {
            const key = sortConfig.key;
            const direction = sortConfig.direction === 'ascending' ? 1 : -1;
            
            if (key === 'name' || key === 'type') {
                return a[key].localeCompare(b[key]) * direction;
            }
            if (key === 'value') {
                return (a.value - b.value) * direction;
            }
            return 0;
        });

        const sortedLia = [...liabilities].sort((a, b) => {
            const key = liabilitySortConfig.key === 'value' ? 'currentBalance' : liabilitySortConfig.key;
            const direction = liabilitySortConfig.direction === 'ascending' ? 1 : -1;

            const valA = key === 'type' ? formatLiabilityType(a.type) : a[key as 'name' | 'currentBalance'];
            const valB = key === 'type' ? formatLiabilityType(b.type) : b[key as 'name' | 'currentBalance'];

            if (typeof valA === 'string' && typeof valB === 'string') {
                 return valA.localeCompare(valB) * direction;
            }
            if (typeof valA === 'number' && typeof valB === 'number') {
                return (valA - valB) * direction;
            }
            return 0;
        });

        const assetBreakdown = combined.reduce<Record<string, { value: number; icon: string }>>((acc, asset) => {
            if (!acc[asset.type]) {
                acc[asset.type] = { value: 0, icon: asset.icon };
            }
            acc[asset.type].value += asset.value;
            return acc;
        }, {});

        const assetTypeArray = Object.entries(assetBreakdown).map(([type, data]) => ({
            type,
            value: data.value,
            icon: data.icon,
        })).sort((a,b) => b.value - a.value);

        const liabilityBreakdown = liabilities.reduce<Record<string, { value: number }>>((acc, liability) => {
            const formattedType = formatLiabilityType(liability.type);
             if (!acc[formattedType]) {
                acc[formattedType] = { value: 0 };
            }
            acc[formattedType].value += liability.currentBalance;
            return acc;
        }, {});
        
        const liabilityTypeArray = Object.entries(liabilityBreakdown).map(([type, data]) => ({
            type,
            value: data.value
        })).sort((a,b) => b.value - a.value);

        let dateStr = '';
        if (isCurrentMonth && netWorthTarget && netWorth < netWorthTarget) {
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
                
            const calculatedContribution = (totalAssetContributions + totalSavingsContributions) / 12;
            const monthlyContribution = savedDefaultContribution !== null && savedDefaultContribution >= 0 ? savedDefaultContribution : calculatedContribution;

            const annualGrowthRate = 7;
            const monthlyGrowthRate = annualGrowthRate / 100 / 12;

            if (monthlyContribution > 0 || (netWorth > 0 && annualGrowthRate > 0)) {
                let projectedValue = netWorth;
                let monthsToTarget = 0;
                while (projectedValue < netWorthTarget) {
                    projectedValue += monthlyContribution;
                    projectedValue *= (1 + monthlyGrowthRate);
                    monthsToTarget++;
                    if (monthsToTarget > 1200) {
                        monthsToTarget = -1;
                        break;
                    }
                }
                if (monthsToTarget > 0) {
                    const estimatedDate = addMonths(new Date(), monthsToTarget);
                    dateStr = formatDate(estimatedDate, 'MMMM yyyy');
                }
            }
        }
        
        return {
            totalAssets: assetsValue + savingsValue + investmentsValue,
            totalLiabilities: liabilitiesValue,
            totalNetWorth: netWorth,
            sortedCombinedAssets: sortedAssets,
            sortedLiabilities: sortedLia,
            estimatedTargetDate: dateStr,
            assetTypeBreakdown: assetTypeArray,
            liabilityTypeBreakdown: liabilityTypeArray
        }
    }, [assets, savingsGoals, liabilities, investments, historicalInvestmentData, assetTypes, netWorthTarget, savedDefaultContribution, selectedMonth, conversionRates, isCurrentMonth, loading, sortConfig, liabilitySortConfig]);

    const currencyOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    
    const requestSort = (key: SortableKey) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
          direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const requestLiabilitySort = (key: SortableKey) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (liabilitySortConfig.key === key && liabilitySortConfig.direction === 'ascending') {
          direction = 'descending';
        }
        setLiabilitySortConfig({ key, direction });
    };

    const SortableHeader = ({ title, sortKey, onSort, currentSortConfig, className }: { title: string; sortKey: SortableKey; onSort: (key: SortableKey) => void; currentSortConfig: typeof sortConfig; className?: string; }) => (
        <TableHead className={cn('p-0', className)}>
          <Button variant="ghost" onClick={() => onSort(sortKey)} className={cn("w-full h-auto py-3 px-4 font-semibold", className?.includes('text-right') ? 'justify-end' : 'justify-start')}>
            {title}
            {currentSortConfig.key === sortKey && (
                currentSortConfig.direction === 'ascending' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        </TableHead>
    );

    const renderSkeleton = () => (
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <div className="flex justify-between items-center">
                 <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-10" />
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-10 w-10" />
                </div>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
                <Card><CardHeader><Skeleton className="h-5 w-3/5" /></CardHeader><CardContent><Skeleton className="h-10 w-4/5" /></CardContent></Card>
                <Card><CardHeader><Skeleton className="h-5 w-3/5" /></CardHeader><CardContent><Skeleton className="h-10 w-4/5" /></CardContent></Card>
                <Card><CardHeader><Skeleton className="h-5 w-3/5" /></CardHeader><CardContent><Skeleton className="h-10 w-4/5" /></CardContent></Card>
            </div>
        </div>
    );

    return (
        <>
            <Header title="Net Worth" />
            <main className="flex-1 space-y-6 p-4 sm:p-6">
                 {loading ? renderSkeleton() : (
                    <div className="max-w-7xl mx-auto w-full space-y-6">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="icon" onClick={() => handleMonthChange(-1)}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <h2 className="text-2xl font-semibold text-center w-48 sm:w-56">
                                    {formatDate(selectedMonth, 'MMMM yyyy')}
                                </h2>
                                <Button variant="outline" size="icon" onClick={() => handleMonthChange(1)} disabled={isCurrentMonth}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="grid gap-6 md:grid-cols-3">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Net Worth</CardTitle><Scale className="h-4 w-4 text-muted-foreground" /></CardHeader>
                                <CardContent><div className="text-2xl font-bold text-primary">{formatCurrency(totalNetWorth, currency, currencyOptions)}</div></CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Assets</CardTitle><TrendingUp className="h-4 w-4 text-muted-foreground" /></CardHeader>
                                <CardContent><div className="text-2xl font-bold">{formatCurrency(totalAssets, currency, currencyOptions)}</div></CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Liabilities</CardTitle><TrendingDown className="h-4 w-4 text-muted-foreground" /></CardHeader>
                                <CardContent><div className="text-2xl font-bold text-destructive">{formatCurrency(totalLiabilities, currency, currencyOptions)}</div></CardContent>
                            </Card>
                        </div>
                    </div>
                )}
                
                {netWorthTarget && netWorthTarget > 0 && !loading && isCurrentMonth && (
                    <div className="max-w-7xl mx-auto w-full">
                        <Card>
                            <CardHeader>
                                <CardTitle>Progress to Net Worth Target</CardTitle>
                                <CardDescription>
                                    {totalNetWorth >= netWorthTarget
                                        ? "Congratulations! You've reached your net worth target."
                                        : estimatedTargetDate
                                        ? `Based on your current savings rate, you're projected to reach your goal of ${formatCurrency(netWorthTarget, currency, currencyOptions)} around ${estimatedTargetDate}.`
                                        : `Your goal is to reach ${formatCurrency(netWorthTarget, currency, currencyOptions)}.`
                                    }
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Progress value={(totalNetWorth / netWorthTarget) * 100} className="h-4" />
                                <div className="mt-2 flex justify-between text-sm font-medium">
                                    <span>{formatCurrency(totalNetWorth, currency, currencyOptions)}</span>
                                    <span>{(((totalNetWorth / netWorthTarget) * 100) || 0).toFixed(1)}%</span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                <div className="max-w-7xl mx-auto w-full">
                    <Card>
                        <CardHeader>
                            <CardTitle>Net Worth Composition</CardTitle>
                            <CardDescription>A summary of your assets and liabilities by type for {formatDate(selectedMonth, 'MMMM yyyy')}.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid md:grid-cols-2 gap-x-6 gap-y-8">
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Asset Types</h3>
                                {assetTypeBreakdown.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Value</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {assetTypeBreakdown.map(item => (
                                                <TableRow key={item.type}>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2 font-medium">
                                                            <DynamicIcon name={item.icon} className="h-5 w-5 text-muted-foreground" />
                                                            <span>{item.type}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">{formatCurrency(item.value, currency, currencyOptions)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-4">No assets to display.</p>
                                )}
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Liability Types</h3>
                                {liabilityTypeBreakdown.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Balance</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {liabilityTypeBreakdown.map(item => (
                                                <TableRow key={item.type}>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2 font-medium">
                                                            {liabilityIcons[item.type.toLowerCase().replace(/ /g, '_') as Liability['type']]}
                                                            <span>{item.type}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-destructive">{formatCurrency(item.value, currency, currencyOptions)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-4">No liabilities to display.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="max-w-7xl mx-auto w-full">
                    <Card>
                        <CardHeader>
                            <CardTitle>Detailed Breakdown</CardTitle>
                            <CardDescription>A list of all your individual assets and liabilities.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Tabs defaultValue="assets">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="assets">Assets ({sortedCombinedAssets.length})</TabsTrigger>
                                    <TabsTrigger value="liabilities">Liabilities ({liabilities.length})</TabsTrigger>
                                </TabsList>
                                <TabsContent value="assets" className="mt-4">
                                    {loading ? <Loader2 className="mx-auto mt-8 h-8 w-8 animate-spin text-muted-foreground" /> : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <SortableHeader title="Name" sortKey="name" onSort={requestSort} currentSortConfig={sortConfig} />
                                                    <SortableHeader title="Type" sortKey="type" onSort={requestSort} currentSortConfig={sortConfig} />
                                                    <SortableHeader title="Value" sortKey="value" onSort={requestSort} currentSortConfig={sortConfig} className="text-right" />
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {sortedCombinedAssets.map(asset => (
                                                    <TableRow key={`${asset.kind}-${asset.id}`}>
                                                        <TableCell className="font-medium"><Link href={asset.href} className="hover:underline">{asset.name}</Link></TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                                <DynamicIcon name={asset.icon} className="h-5 w-5" />
                                                                <span>{asset.type}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono">{formatCurrency(asset.value, currency)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </TabsContent>
                                <TabsContent value="liabilities" className="mt-4">
                                    {loading ? <Loader2 className="mx-auto mt-8 h-8 w-8 animate-spin text-muted-foreground" /> : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <SortableHeader title="Name" sortKey="name" onSort={requestLiabilitySort} currentSortConfig={liabilitySortConfig} />
                                                    <SortableHeader title="Type" sortKey="type" onSort={requestLiabilitySort} currentSortConfig={liabilitySortConfig} />
                                                    <SortableHeader title="Value" sortKey="value" onSort={requestLiabilitySort} currentSortConfig={liabilitySortConfig} className="text-right" />
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {sortedLiabilities.map(liability => (
                                                    <TableRow key={liability.id}>
                                                        <TableCell className="font-medium"><Link href="/liabilities" className="hover:underline">{liability.name}</Link></TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                                {liabilityIcons[liability.type]}
                                                                <span>{formatLiabilityType(liability.type)}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-destructive">{formatCurrency(liability.currentBalance, currency)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </TabsContent>
                            </Tabs>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </>
    );
}

export default function NetWorthPage() {
    return (
        <MainLayout>
            <NetWorth />
        </MainLayout>
    );
}
