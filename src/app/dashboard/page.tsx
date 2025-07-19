
'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { format, startOfMonth, endOfMonth, isWithinInterval, isAfter, isEqual, subMonths } from "date-fns";
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, ArrowUpCircle, ArrowDownCircle, PiggyBank, Wallet, Loader2, Scale, PieChart as PieChartIcon, CheckCircle2, XCircle, Banknote, TrendingUp, Landmark, ChevronDown } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { Area, AreaChart as RechartsAreaChart, CartesianGrid, Legend, XAxis, YAxis } from 'recharts';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Progress } from '@/components/ui/progress';
import { useProjectionSettings } from '@/context/projection-settings-context';
import DynamicIcon from '@/components/dynamic-icon';
import { NewUserTourPrompt } from '@/components/new-user-tour';
import { useAppTour } from '@/components/tour-guide';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getStockPrice } from '@/services/investment-service';
import { getConversionRate } from '@/services/currency-service';


type ValueChange = { id: string; value: number; date: Date; };
type AssetContribution = { id: string; amount: number; date: Date; };
type Asset = { id: string; name: string; valueHistory: ValueChange[]; type: string, contributions: AssetContribution[]; href?: string, currency: string; };

type Liability = { id: string; name: string; currentBalance: number };

type AmountChange = { id: string; amount: number; date: Date; };

type BaseTransaction = {
  id: string;
  userId: string;
  transactionType: 'income' | 'expense';
  name: string;
  amounts: AmountChange[];
  frequency: 'one-off' | 'recurring';
  endDate?: Date | null;
}
type Expense = BaseTransaction & {
    transactionType: 'expense',
    sharing: string,
    classification?: 'need' | 'want',
    categoryId?: string;
}
type Income = BaseTransaction & {
  transactionType: 'income';
  categoryId?: string;
  sharing: string;
};
type Transaction = Income | Expense;

type SavingGoalContribution = {
    id: string;
    amount: number;
    date: Date;
}
type SavingGoal = {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  targetDate: Date;
  startDate: Date;
  contributions: SavingGoalContribution[];
};

type Member = { id: string; name: string; email: string; income?: number };
type Household = { id: string; ownerId: string; name: string; members: Member[]; memberIds: string[]; splitType?: 'equal' | 'shares' | 'income_ratio'; splits?: { memberId: string, share: number }[]; };

type InvestmentTransaction = { id: string; date: Date; shares: number; price: number; };
type Investment = { id: string; ticker: string; name: string; transactions: InvestmentTransaction[]; };


const getAmountForDate = (transaction: Transaction, targetDate: Date): number => {
    if (!transaction.amounts || transaction.amounts.length === 0) return 0;
    
    const sortedAmounts = [...transaction.amounts].sort((a, b) => b.date.getTime() - a.date.getTime());
    const activeAmount = sortedAmounts.find(a => a.date <= targetDate);
    
    return activeAmount ? activeAmount.amount : 0;
};

const chartConfig = {
  initialCapital: {
    label: "Initial Capital",
    color: "hsl(var(--chart-3))",
  },
  contributions: {
    label: "Total Contributions",
    color: "hsl(var(--chart-2))",
  },
  interest: {
    label: "Interest Earned",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

type BreakdownItem = {
    id: string;
    name: string;
    amount: number;
    href?: string;
}

type DialogDataType = {
    title: string;
    items: BreakdownItem[];
};

// New display component that opens a dialog
const BudgetRuleDisplay = ({
  title,
  target,
  actualAmount,
  actualPercent,
  colorClass,
  comparisonType,
  onOpenDialog,
}: {
  title: string;
  target: number;
  actualAmount: number;
  actualPercent: number;
  colorClass: string;
  comparisonType: 'under' | 'over';
  onOpenDialog: () => void;
}) => {
  let onTrack = false;
  let isNegative = false;

  if (comparisonType === 'under') {
    onTrack = actualPercent <= target && actualPercent >= 0;
    if (actualPercent < 0) isNegative = true;
  } else {
    onTrack = actualPercent >= target;
  }

  const displayPercent = isNegative ? 0 : actualPercent;

  return (
    <div onClick={onOpenDialog} className="space-y-1 cursor-pointer group">
        <div className="flex justify-between items-baseline">
        <div className="flex items-center gap-2">
            {onTrack ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
            <XCircle className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm font-medium group-hover:underline">{title} &middot; {target}% Target</span>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{formatCurrency(actualAmount, 'USD', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}</span>
        </div>
        </div>
        <Progress value={Math.max(0, displayPercent)} className="h-2 [&>div]:bg-[var(--color)]" style={{ '--color': colorClass } as React.CSSProperties} />
        <p className="text-right text-xs font-medium">{actualPercent.toFixed(1)}% of Income</p>
    </div>
  );
};


function Dashboard() {
    const user = useAuth();
    const { currency } = useCurrency();
    const { defaultMonthlyContribution } = useProjectionSettings();
    const [assets, setAssets] = useState<Asset[]>([]);
    const [liabilities, setLiabilities] = useState<Liability[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
    const [investments, setInvestments] = useState<Investment[]>([]);
    const [households, setHouseholds] = useState<Household[]>([]);
    const [loading, setLoading] = useState(true);
    const searchParams = useSearchParams();
    const { startTour } = useAppTour();
    const [dialogData, setDialogData] = useState<DialogDataType | null>(null);
    const [investmentValues, setInvestmentValues] = useState<Map<string, number>>(new Map());
    const [rates, setRates] = useState<Map<string, number>>(new Map());

    const projectionLegendIcons: Record<string, string> = {
        'Initial Capital': 'Landmark',
        'Total Contributions': 'ArrowUpCircle',
        'Interest Earned': 'TrendingUp',
    };

    useEffect(() => {
        if (!user) return;
        
        async function fetchData() {
            setLoading(true);
            try {
                // Fetch households first to get their IDs for the transaction query
                const householdQuery = query(collection(db, 'households'), where('memberIds', 'array-contains', user.uid));
                const householdSnapshot = await getDocs(householdQuery);
                const householdData = householdSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Household[];
                setHouseholds(householdData);
                const householdIds = householdData.map(h => h.id);

                // Prepare transaction queries
                const userTransactionsQuery = query(collection(db, 'transactions'), where('userId', '==', user.uid));
                const sharedTransactionsQuery = householdIds.length > 0
                    ? query(collection(db, 'transactions'), where('sharing', 'in', householdIds))
                    : null;

                // Fetch all other data in parallel
                const otherQueries = [
                    getDocs(query(collection(db, 'assets'), where('userId', '==', user.uid))),
                    getDocs(query(collection(db, 'liabilities'), where('userId', '==', user.uid))),
                    getDocs(query(collection(db, 'savings'), where('userId', '==', user.uid))),
                    getDocs(query(collection(db, 'investments'), where('userId', '==', user.uid))),
                    getDocs(userTransactionsQuery)
                ];

                if (sharedTransactionsQuery) {
                    otherQueries.push(getDocs(sharedTransactionsQuery));
                }

                const [assetsSnapshot, liabilitiesSnapshot, savingsSnapshot, investmentsSnapshot, userTxSnap, sharedTxSnap] = await Promise.all(otherQueries);

                // Combine and de-duplicate transactions
                const allTransactions = new Map<string, Transaction>();
                const processSnapshot = (snapshot: any) => {
                    snapshot.docs.forEach((doc: any) => {
                        const data = doc.data();
                        let amounts = (data.amounts || []).map((a: any) => ({ ...a, date: a.date.toDate() }));
                        if (amounts.length === 0 && data.amount && data.startDate) {
                            amounts.push({ id: 'legacy-0', amount: data.amount, date: data.startDate.toDate() });
                        }
                        const transaction: Transaction = {
                            id: doc.id,
                            ...data,
                            amounts,
                            endDate: data.endDate ? data.endDate.toDate() : null
                        } as Transaction;

                        if (transaction.sharing === 'personal' && transaction.userId !== user.uid) {
                            return;
                        }

                        allTransactions.set(doc.id, transaction);
                    });
                };

                processSnapshot(userTxSnap);
                if (sharedTxSnap) {
                    processSnapshot(sharedTxSnap);
                }
                setTransactions(Array.from(allTransactions.values()));

                // Process other data
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
                setAssets(assetsList);
                
                const investmentsList = investmentsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id, ...data,
                        transactions: (data.transactions || []).map((t: any) => ({ ...t, date: t.date.toDate() })),
                    } as Investment;
                });
                setInvestments(investmentsList);
                
                const uniqueAssetCurrencies = assetsList.map(a => a.currency);
                const tempRates = new Map();
                tempRates.set(currency, 1);
                const uniqueCurrencies = [...new Set([...uniqueAssetCurrencies, 'USD'])].filter(c => c !== currency);
                await Promise.all(uniqueCurrencies.map(async (assetCurrency) => {
                    const rate = await getConversionRate(assetCurrency, currency);
                    tempRates.set(assetCurrency, rate);
                }));
                setRates(tempRates);

                const liabilitiesList = liabilitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Liability[];
                setLiabilities(liabilitiesList);

                const savingsList = savingsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        startDate: data.startDate.toDate(),
                        targetDate: data.targetDate.toDate(),
                        contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
                    } as SavingGoal;
                });
                setSavingsGoals(savingsList);

            } catch (error) {
                console.error("Error fetching data:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [user, currency]);
    
    useEffect(() => {
        const fetchInvestmentPrices = async () => {
            if (investments.length === 0 || rates.size === 0) return;
            const usdToGlobalRate = rates.get('USD') || 1;
            
            const newValues = new Map<string, number>();
            await Promise.all(investments.map(async (inv) => {
                const priceData = await getStockPrice(inv.ticker);
                if (priceData) {
                    const totalShares = inv.transactions.reduce((sum, t) => sum + t.shares, 0);
                    const value = totalShares * priceData.price * usdToGlobalRate;
                    newValues.set(inv.id, value);
                }
            }));
            setInvestmentValues(newValues);
        };
        if(!loading) {
            fetchInvestmentPrices();
        }
    }, [investments, loading, rates]);

    useEffect(() => {
        if (searchParams.get('tour') === 'true') {
            const timer = setTimeout(() => startTour(), 500);
            return () => clearTimeout(timer);
        }
    }, [searchParams, startTour]);

    const { totalNetWorth } = useMemo(() => {
        const assetsTotal = assets.reduce((sum, asset) => {
            const latestValue = asset.valueHistory.length > 0 ? [...asset.valueHistory].sort((a,b) => b.date.getTime() - a.date.getTime())[0].value : 0;
            const rate = rates.get(asset.currency) || 1;
            return sum + (latestValue * rate);
        }, 0);
        
        const investmentsTotal = Array.from(investmentValues.values()).reduce((sum, value) => sum + value, 0);
        const savingsTotal = savingsGoals.reduce((total, goal) => total + goal.contributions.reduce((cTotal, c) => cTotal + c.amount, 0), 0);
        const liabilitiesTotal = liabilities.reduce((sum, liability) => sum + liability.currentBalance, 0);
        const totalGrossAssets = assetsTotal + savingsTotal + investmentsTotal;
        return { 
            totalNetWorth: totalGrossAssets - liabilitiesTotal,
        };
    }, [assets, savingsGoals, liabilities, investmentValues, rates]);

    const { monthlyIncome, monthlyExpenses, monthlySavings, netBalance, needsTotal, wantsTotal, needsBreakdown, wantsBreakdown, savingsBreakdown } = useMemo(() => {
        const selectedMonth = new Date();
        const monthStart = startOfMonth(selectedMonth);
        const monthEnd = endOfMonth(selectedMonth);

        const isTransactionActive = (t: Transaction) => {
            if (!t.amounts || t.amounts.length === 0) return false;
            const firstAmountDate = [...t.amounts].sort((a,b) => a.date.getTime() - b.date.getTime())[0].date;

            if (t.frequency === 'one-off') {
                return isWithinInterval(firstAmountDate, { start: monthStart, end: monthEnd });
            }
            const afterStart = isAfter(monthEnd, firstAmountDate) || isEqual(monthStart, startOfMonth(firstAmountDate));
            const beforeEnd = !t.endDate || isAfter(endOfMonth(t.endDate), monthStart) || isEqual(monthEnd, endOfMonth(t.endDate));
            return afterStart && beforeEnd;
        };

        const activeTransactions = transactions.filter(isTransactionActive);
        
        const income = activeTransactions
            .filter(t => t.transactionType === 'income')
            .reduce((sum, t) => sum + getAmountForDate(t, monthEnd), 0);
        
        let needs = 0;
        let wants = 0;
        let needsItems: BreakdownItem[] = [];
        let wantsItems: BreakdownItem[] = [];

        activeTransactions
            .filter((t): t is Expense => t.transactionType === 'expense')
            .forEach(t => {
                const totalAmount = getAmountForDate(t, monthEnd);
                let amount = totalAmount;

                if (t.sharing !== 'personal' && user) {
                    const household = households.find(h => h.id === t.sharing);
                    if (household) {
                        let userShare = 0;
                        const userIsMember = household.members.some(m => m.id === user.uid);
                        if (userIsMember) {
                            if (household.splitType === 'shares' && household.splits?.length) {
                                const totalShares = household.splits.reduce((s, split) => s + (split.share || 0), 0);
                                if (totalShares > 0) {
                                    const userSplit = household.splits.find(s => s.memberId === user.uid);
                                    const userShares = userSplit?.share || 0;
                                    userShare = (totalAmount * userShares) / totalShares;
                                } else {
                                    userShare = household.members.length > 0 ? totalAmount / household.members.length : 0;
                                }
                            } else if (household.splitType === 'income_ratio') {
                                const totalIncome = household.members.reduce((s, member) => s + (member.income || 0), 0);
                                if (totalIncome > 0) {
                                    const userIncome = household.members.find(m => m.id === user.uid)?.income || 0;
                                    userShare = (totalAmount * userIncome) / totalIncome;
                                } else {
                                    userShare = household.members.length > 0 ? totalAmount / household.members.length : 0;
                                }
                            } else { // Equal split
                                userShare = household.members.length > 0 ? totalAmount / household.members.length : 0;
                            }
                        }
                        amount = userShare;
                    } else {
                        amount = 0; // Household not found, user's share is 0
                    }
                }
                
                const item = { id: t.id, name: t.name, amount: amount, href: `/transaction/${t.id}` };
                if (t.classification === 'want') {
                    wants += amount;
                    wantsItems.push(item);
                } else { // Default to 'need' if undefined or explicitly 'need'
                    needs += amount;
                    needsItems.push(item);
                }
            });
        
        const totalExpenses = needs + wants;
        
        const savingsGoalContributions = savingsGoals
          .flatMap(goal => goal.contributions.filter(c => isWithinInterval(c.date, { start: monthStart, end: monthEnd })).map(c => ({ id: `${goal.id}-${c.id}`, name: `Goal: ${goal.name}`, amount: c.amount, href: `/savings/${goal.id}` })))
          .sort((a,b) => b.amount - a.amount);
          
        const assetContributions = assets
          .flatMap(asset => (asset.contributions || []).filter(c => isWithinInterval(c.date, { start: monthStart, end: monthEnd })).map(c => ({ id: `${asset.id}-${c.id}`, name: `Asset: ${asset.name}`, amount: c.amount, href: `/asset/${asset.id}` })))
          .sort((a,b) => b.amount - a.amount);
        
        const savingsForMonth = [...savingsGoalContributions, ...assetContributions].reduce((sum, c) => sum + c.amount, 0);
        
        const net = income - totalExpenses - savingsForMonth;
            
        return { 
            monthlyIncome: income, 
            monthlyExpenses: totalExpenses, 
            monthlySavings: savingsForMonth, 
            netBalance: net,
            needsTotal: needs,
            wantsTotal: wants,
            needsBreakdown: needsItems.sort((a,b) => b.amount - a.amount),
            wantsBreakdown: wantsItems.sort((a,b) => b.amount - a.amount),
            savingsBreakdown: [...savingsGoalContributions, ...assetContributions].sort((a,b) => b.amount - a.amount),
        };
    }, [transactions, savingsGoals, assets, user.uid, households]);

    const budgetAllocation = useMemo(() => {
        if (monthlyIncome === 0) {
            return { needs: 0, wants: 0, savings: 0 };
        }
        const needsPercent = (needsTotal / monthlyIncome) * 100;
        const wantsWithNetBalance = wantsTotal + netBalance;
        const wantsPercent = (wantsWithNetBalance / monthlyIncome) * 100;
        const savingsPercent = (monthlySavings / monthlyIncome) * 100;
        return { needs: needsPercent, wants: wantsPercent, savings: savingsPercent, wantsWithNetBalance };
    }, [monthlyIncome, needsTotal, wantsTotal, monthlySavings, netBalance]);

    const topSavingsGoals = useMemo(() => {
        return [...savingsGoals]
            .map(goal => {
                const currentAmount = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
                const progress = goal.targetAmount > 0 ? (currentAmount / goal.targetAmount) * 100 : 0;
                return { ...goal, currentAmount, progress };
            })
            .sort((a,b) => b.progress - a.progress)
            .slice(0, 5);
    }, [savingsGoals]);
    
    const { projectionData } = useMemo(() => {
        if (loading) return { projectionData: [] };
        
        const projectionYears = 10;
        const annualGrowthRate = 7;
        
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

        const monthlyContribution = 
            defaultMonthlyContribution !== null && defaultMonthlyContribution >= 0 
            ? defaultMonthlyContribution 
            : calculatedContribution;
        
        const data = [];
        let projectedValue = totalNetWorth;
        const monthlyGrowthRate = annualGrowthRate / 100 / 12;

        const currentYear = new Date().getFullYear();
        data.push({
          year: currentYear,
          projectedNetWorth: parseFloat(totalNetWorth.toFixed(2)),
          initialCapital: parseFloat(totalNetWorth.toFixed(2)),
          contributions: 0,
          interest: 0,
        });

        let cumulativeContributions = 0;

        for (let i = 1; i <= projectionYears; i++) {
          for (let month = 0; month < 12; month++) {
            projectedValue += monthlyContribution;
            projectedValue *= (1 + monthlyGrowthRate);
          }
          cumulativeContributions += monthlyContribution * 12;
          const interestSoFar = projectedValue - totalNetWorth - cumulativeContributions;

          data.push({
            year: currentYear + i,
            projectedNetWorth: parseFloat(projectedValue.toFixed(2)),
            initialCapital: parseFloat(totalNetWorth.toFixed(2)),
            contributions: parseFloat(cumulativeContributions.toFixed(2)),
            interest: parseFloat(interestSoFar.toFixed(2)),
          });
        }
        return { projectionData: data };
    }, [totalNetWorth, loading, assets, savingsGoals, defaultMonthlyContribution]);
    
    const isNewUser = !loading && assets.length === 0 && liabilities.length === 0 && transactions.length === 0 && savingsGoals.length === 0;

    if (loading) {
        return (
             <>
                <Header title="Dashboard" />
                <main className="flex-1 space-y-6 p-4 sm:p-6">
                   <div className="max-w-7xl mx-auto w-full">
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
                                <Card><CardHeader><Skeleton className="h-5 w-2/4" /></CardHeader><CardContent><Skeleton className="h-8 w-3/4" /></CardContent></Card>
                                <Card><CardHeader><Skeleton className="h-5 w-2/4" /></CardHeader><CardContent><Skeleton className="h-8 w-3/4" /></CardContent></Card>
                                <Card><CardHeader><Skeleton className="h-5 w-2/4" /></CardHeader><CardContent><Skeleton className="h-8 w-3/4" /></CardContent></Card>
                                <Card><CardHeader><Skeleton className="h-5 w-2/4" /></CardHeader><CardContent><Skeleton className="h-8 w-3/4" /></CardContent></Card>
                                <Card><CardHeader><Skeleton className="h-5 w-2/4" /></CardHeader><CardContent><Skeleton className="h-8 w-3/4" /></CardContent></Card>
                        </div>
                        <div className="grid gap-6 md:grid-cols-2 mt-6">
                            <Card><CardHeader><CardTitle>Savings Goals</CardTitle></CardHeader><CardContent><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></CardContent></Card>
                            <Card><CardHeader><CardTitle>Net Worth Projection</CardTitle></CardHeader><CardContent><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></CardContent></Card>
                        </div>
                   </div>
                </main>
            </>
        )
    }
    
    return (
        <>
            <Header title={`Welcome, ${user.displayName || user.email}!`} />
            <main className="flex-1 space-y-6 p-4 sm:p-6">
                <div className="max-w-7xl mx-auto w-full space-y-6">
                    {isNewUser && <NewUserTourPrompt />}

                    <div className="grid gap-6 grid-cols-2 sm:grid-cols-2 lg:grid-cols-5">
                        <Link href="/assets" className="col-span-1">
                            <Card id="tour-step-1-dashboard" className="hover:border-primary transition-colors h-full">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Total Net Worth</CardTitle>
                                    <Scale className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{formatCurrency(totalNetWorth, currency)}</div>
                                    <p className="text-xs text-muted-foreground">Assets minus liabilities</p>
                                </CardContent>
                            </Card>
                        </Link>
                        <Link href="/transactions" className="col-span-1">
                            <Card className="hover:border-primary transition-colors h-full">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Monthly Income</CardTitle>
                                    <ArrowUpCircle className="h-4 w-4 text-chart-2" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{formatCurrency(monthlyIncome, currency)}</div>
                                    <p className="text-xs text-muted-foreground">For {format(new Date(), 'MMMM yyyy')}</p>
                                </CardContent>
                            </Card>
                        </Link>
                        <Link href="/transactions" className="col-span-1">
                            <Card className="hover:border-primary transition-colors h-full">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Monthly Expenses</CardTitle>
                                    <ArrowDownCircle className="h-4 w-4 text-destructive" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{formatCurrency(monthlyExpenses, currency)}</div>
                                    <p className="text-xs text-muted-foreground">For {format(new Date(), 'MMMM yyyy')}</p>
                                </CardContent>
                            </Card>
                        </Link>
                        <Link href="/savings" className="col-span-1">
                            <Card className="hover:border-primary transition-colors h-full">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Monthly Wealth Growth</CardTitle>
                                    <PiggyBank className="h-4 w-4 text-chart-1" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{formatCurrency(monthlySavings, currency)}</div>
                                    <p className="text-xs text-muted-foreground">Contributions to savings & assets</p>
                                </CardContent>
                            </Card>
                        </Link>
                        <Link href="/budget" className="col-span-1">
                            <Card className="hover:border-primary transition-colors h-full">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Net Balance</CardTitle>
                                    <Scale className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className={`text-2xl font-bold ${netBalance < 0 ? 'text-destructive' : ''}`}>{formatCurrency(netBalance, currency)}</div>
                                    <p className="text-xs text-muted-foreground">For {format(new Date(), 'MMMM yyyy')}</p>
                                </CardContent>
                            </Card>
                        </Link>
                    </div>
                    
                    <div className="grid gap-6 lg:grid-cols-3">
                        <Link href="/projections" className="lg:col-span-2 block group">
                            <Card className="h-full hover:border-primary transition-colors">
                                <div className="md:hidden flex flex-col items-center justify-center h-full text-center p-8 rounded-lg border-2 border-dashed">
                                    <TrendingUp className="h-12 w-12 text-muted-foreground" />
                                    <p className="mt-4 font-medium">View Net Worth Projection</p>
                                    <p className="text-sm text-muted-foreground">Tap to see your financial future.</p>
                                </div>
                                <div className="hidden md:block h-full">
                                    <CardHeader>
                                        <CardTitle>10-Year Net Worth Projection</CardTitle>
                                        <CardDescription>
                                            {defaultMonthlyContribution !== null && defaultMonthlyContribution >= 0 
                                                ? 'A projection based on your custom monthly contribution.' 
                                                : 'A projection based on your average savings rate over the last 12 months.'}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <ChartContainer config={chartConfig} className="h-[300px] w-full">
                                            <RechartsAreaChart data={projectionData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                                <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => `'${value.toString().slice(-2)}`} />
                                                <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => formatCurrency(Number(value), currency, { notation: 'compact' })} />
                                                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                                                <Legend content={({ payload }) => (
                                                    <div className="flex gap-4 justify-center text-xs">
                                                    {payload?.map((item) => {
                                                        const iconName = projectionLegendIcons[item.value] || 'Circle';
                                                        const label = item.value
                                                            .replace('Total ', '')
                                                            .replace('Initial ', '');
                                                        return (
                                                            <div key={item.dataKey} className="flex items-center gap-1.5">
                                                                <DynamicIcon name={iconName} className="h-3 w-3" style={{ color: item.color }} />
                                                                <span>{label}</span>
                                                            </div>
                                                        )
                                                    })}
                                                    </div>
                                                )} />
                                                <Area dataKey="initialCapital" type="monotone" fill="var(--color-initialCapital)" stroke="var(--color-initialCapital)" stackId="1" name="Initial Capital" />
                                                <Area dataKey="contributions" type="monotone" fill="var(--color-contributions)" stroke="var(--color-contributions)" stackId="1" name="Total Contributions" />
                                                <Area dataKey="interest" type="monotone" fill="var(--color-interest)" stroke="var(--color-interest)" stackId="1" name="Interest Earned" />
                                            </RechartsAreaChart>
                                        </ChartContainer>
                                    </CardContent>
                                </div>
                            </Card>
                        </Link>

                        <div className="space-y-6">
                            <Link href="/savings" className="block">
                                <Card className="hover:border-primary transition-colors">
                                    <CardHeader>
                                        <CardTitle>Savings Goals</CardTitle>
                                        <CardDescription>A summary of your top savings goals.</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                    <div className="space-y-4">
                                            {topSavingsGoals.length > 0 ? topSavingsGoals.map(goal => (
                                            <div key={goal.id}>
                                                <div className="flex justify-between mb-1">
                                                    <span className="text-sm font-medium hover:underline">{goal.name}</span>
                                                    <span className="text-sm text-muted-foreground">{goal.progress.toFixed(0)}%</span>
                                                </div>
                                                <Progress value={goal.progress} />
                                            </div>
                                            )) : <div className="text-center text-muted-foreground py-8">No savings goals yet.</div>}
                                    </div>
                                    </CardContent>
                                </Card>
                            </Link>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <PieChartIcon className="h-5 w-5" />
                                        50/30/20 Budget Rule
                                    </CardTitle>
                                    <CardDescription>Your spending vs. the ideal budget. Click a category to see a breakdown.</CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-4 pt-4">
                                    {monthlyIncome > 0 ? (
                                        <>
                                            <BudgetRuleDisplay
                                                title="Needs"
                                                target={50}
                                                actualAmount={needsTotal}
                                                actualPercent={budgetAllocation.needs}
                                                colorClass="hsl(var(--chart-5))"
                                                comparisonType="under"
                                                onOpenDialog={() => setDialogData({ title: 'Needs Breakdown', items: needsBreakdown })}
                                            />
                                            <Separator />
                                            <BudgetRuleDisplay
                                                title="Wants"
                                                target={30}
                                                actualAmount={budgetAllocation.wantsWithNetBalance}
                                                actualPercent={budgetAllocation.wants}
                                                colorClass="hsl(var(--primary))"
                                                comparisonType="under"
                                                onOpenDialog={() => setDialogData({ title: 'Wants Breakdown', items: wantsBreakdown })}
                                            />
                                            <Separator />
                                            <BudgetRuleDisplay
                                                title="Savings & Investments"
                                                target={20}
                                                actualAmount={monthlySavings}
                                                actualPercent={budgetAllocation.savings}
                                                colorClass="hsl(var(--chart-2))"
                                                comparisonType="over"
                                                onOpenDialog={() => setDialogData({ title: 'Savings & Investments Breakdown', items: savingsBreakdown })}
                                            />
                                        </>
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-center text-muted-foreground py-10">
                                            Add some income this month to see your budget breakdown.
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                    <Dialog open={!!dialogData} onOpenChange={(isOpen) => !isOpen && setDialogData(null)}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>{dialogData?.title}</DialogTitle>
                                <DialogDescription>
                                    A list of all items contributing to this category for {format(new Date(), 'MMMM yyyy')}.
                                </DialogDescription>
                            </DialogHeader>
                            <ScrollArea className="max-h-[60vh]">
                                <div className="pr-6 space-y-2 py-4">
                                {dialogData?.items && dialogData.items.length > 0 ? (
                                    dialogData.items.map(item => (
                                    <div key={item.id} className="flex justify-between items-center text-sm">
                                        <Link href={item.href || '#'} className={`truncate pr-2 ${item.href ? 'hover:underline' : 'pointer-events-none'}`}>
                                            {item.name}
                                        </Link>
                                        <span className="font-mono shrink-0">{formatCurrency(item.amount, currency)}</span>
                                    </div>
                                    ))
                                ) : (
                                    <p className="text-sm text-center text-muted-foreground py-4">No items this month.</p>
                                )}
                                </div>
                            </ScrollArea>
                        </DialogContent>
                    </Dialog>
                </div>
            </main>
        </>
    );
}

export default function DashboardPage() {
    return (
        <MainLayout>
            <Dashboard />
        </MainLayout>
    );
}
