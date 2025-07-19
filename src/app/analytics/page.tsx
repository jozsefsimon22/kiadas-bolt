
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { subMonths, startOfMonth, endOfMonth, format, isWithinInterval, isAfter, isEqual, eachMonthOfInterval, subYears, startOfYear, endOfYear } from 'date-fns';
import { Loader2, TrendingUp, Info, ArrowUpCircle, ArrowDownCircle, PiggyBank, Scale, CalendarIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import DynamicIcon from '@/components/dynamic-icon';
import { Button } from '@/components/ui/button';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { cn } from '@/lib/utils';
import { defaultExpenseCategories } from '@/lib/categories';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis } from 'recharts';

type TransactionType = 'income' | 'expense';
type Frequency = 'one-off' | 'recurring';

type AmountChange = {
  id: string;
  amount: number;
  date: Date;
};

type BaseTransaction = {
  id: string;
  userId: string;
  name: string;
  amounts: AmountChange[];
  frequency: Frequency;
  endDate?: Date | null;
};

type Income = BaseTransaction & {
  transactionType: 'income';
  categoryId?: string;
  sharing: string;
};

type Expense = BaseTransaction & {
  transactionType: 'expense';
  sharing: string;
  classification?: 'need' | 'want';
  categoryId?: string;
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

type AssetContribution = {
  id: string;
  amount: number;
  date: Date;
};
type Asset = {
  id: string;
  userId: string;
  name: string;
  valueHistory: any[];
  contributions: AssetContribution[];
};


type ExpenseCategory = {
    id: string;
    userId?: string;
    name: string;
    icon: string;
    color: string;
    isDefault?: boolean;
}

type Household = { id: string; name: string; members: { id: string; name: string; income?: number; }[]; splitType?: 'equal' | 'shares' | 'income_ratio'; splits?: { memberId: string, share: number }[]; };

const getAmountForDate = (transaction: Transaction, targetDate: Date): number => {
    if (!transaction.amounts || transaction.amounts.length === 0) return 0;
    const sortedAmounts = [...transaction.amounts].sort((a, b) => b.date.getTime() - a.date.getTime());
    const activeAmount = sortedAmounts.find(a => a.date <= targetDate);
    return activeAmount ? activeAmount.amount : 0;
};

function Analytics() {
    const user = useAuth();
    const { currency } = useCurrency();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [households, setHouseholds] = useState<Household[]>([]);
    const [loading, setLoading] = useState(true);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    
    const [date, setDate] = useState<DateRange | undefined>({
        from: startOfMonth(subMonths(new Date(), 11)),
        to: endOfMonth(new Date()),
    });
    
    const [activeIndex, setActiveIndex] = useState<number | undefined>();
    const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
    const [hoveredBar, setHoveredBar] = useState<string | null>(null);

    const onPieEnter = (_: any, index: number) => {
        setActiveIndex(index);
    };

    useEffect(() => {
        if (!user) return;
        async function fetchData() {
            setLoading(true);
            try {
                const categoriesQuery = query(collection(db, 'expenseCategories'), where('userId', '==', user.uid));
                const categoriesSnapshot = await getDocs(categoriesQuery);
                const customCategories = categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseCategory));
                const mappedDefaultCategories = defaultExpenseCategories.map(cat => ({
                    ...cat,
                    id: `default-expenseCategories-${cat.name.replace(/\s+/g, '-')}`,
                    isDefault: true,
                }));
                const categoriesList = [...mappedDefaultCategories, ...customCategories];
                setExpenseCategories(categoriesList);

                const householdQuery = query(collection(db, "households"), where("memberIds", "array-contains", user.uid));
                const householdSnap = await getDocs(householdQuery);
                const householdData = householdSnap.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Household[];
                setHouseholds(householdData);
                const householdIds = householdData.map(h => h.id);

                const userTransactionsQuery = query(collection(db, 'transactions'), where('userId', '==', user.uid));
                const sharedTransactionsQuery = householdIds.length > 0 
                    ? query(collection(db, 'transactions'), where('sharing', 'in', householdIds))
                    : null;

                const queries = [
                    getDocs(userTransactionsQuery),
                    getDocs(query(collection(db, 'savings'), where('userId', '==', user.uid))),
                    getDocs(query(collection(db, 'assets'), where('userId', '==', user.uid))),
                ];
                if (sharedTransactionsQuery) {
                    queries.push(getDocs(sharedTransactionsQuery));
                }

                const [userTxSnap, savingsSnapshot, assetsSnapshot, sharedTxSnap] = await Promise.all(queries);

                const allTransactions = new Map<string, Transaction>();
                const processSnapshot = (snapshot: any) => {
                    snapshot.docs.forEach((doc: any) => {
                        const data = doc.data();
                        let amounts = (data.amounts || []).map((a: any) => ({ ...a, date: a.date.toDate() }));
                        if (amounts.length === 0 && data.amount && data.startDate) {
                            amounts.push({ id: 'legacy-0', amount: data.amount, date: data.startDate.toDate() });
                        }
                        const transaction: Transaction = { id: doc.id, ...data, amounts, endDate: data.endDate ? data.endDate.toDate() : null } as Transaction;
                        if (transaction.sharing === 'personal' && transaction.userId !== user.uid) return;
                        allTransactions.set(doc.id, transaction);
                    });
                };
                processSnapshot(userTxSnap);
                if (sharedTxSnap) processSnapshot(sharedTxSnap);
                setTransactions(Array.from(allTransactions.values()));

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

                const assetsList = assetsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        valueHistory: (data.valueHistory || []).map((v: any) => ({ ...v, date: v.date.toDate() })),
                        contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
                    } as Asset;
                });
                setAssets(assetsList);
            } catch (error) {
                console.error("Error fetching analytics data:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [user]);

    const analyticsData = useMemo(() => {
        if (!date || !date.from || !user) {
             return {
                totalIncome: 0, totalExpenses: 0, totalSavings: 0, expensePercentage: 0, savingsPercentage: 0, netCashflowPercentage: 0, cashflowChartData: [], expensePieChartData: [], categoryTrendsData: [], allCategoryNamesForPeriod: [], categoryColors: {}, categoryIcons: {}
            };
        }
        const fromDate = startOfMonth(date.from);
        const toDate = endOfMonth(date.to || date.from);
        
        const months = eachMonthOfInterval({ start: fromDate, end: toDate });
    
        const allSavingGoalContributions = savingsGoals.flatMap(goal => goal.contributions);
        const allAssetContributions = assets.flatMap(asset => asset.contributions || []);
        const allContributions = [...allSavingGoalContributions, ...allAssetContributions];

        const categoriesMap = new Map(expenseCategories.map(c => [c.id, c]));
    
        const monthlyData = months.map(month => {
            const monthStart = startOfMonth(month);
            const monthEnd = endOfMonth(month);
    
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
            
            const incomeForMonth = activeTransactions
                .filter(t => t.transactionType === 'income')
                .reduce((sum, t) => sum + getAmountForDate(t, monthEnd), 0);
                
            const expensesForMonth = activeTransactions
                .filter((t): t is Expense => t.transactionType === 'expense')
                .reduce((sum, t) => {
                    const totalAmount = getAmountForDate(t, monthEnd);
                    if (t.sharing === 'personal' || !user) {
                        return sum + totalAmount;
                    }

                    const household = households.find(h => h.id === t.sharing);
                    if (!household) return sum;

                    let userShare = 0;
                    const userIsMember = household.members.some(m => m.id === user.uid);

                    if(userIsMember) {
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
                   return sum + userShare;
                }, 0);
    
            const savingsForMonth = allContributions
              .filter(c => isWithinInterval(c.date, { start: monthStart, end: monthEnd }))
              .reduce((sum, c) => sum + c.amount, 0);
            
            const expenseBreakdownForMonth: {[key: string]: number} = {};
            activeTransactions
                .filter((t): t is Expense => t.transactionType === 'expense')
                .forEach(t => {
                    let amount = getAmountForDate(t, monthEnd);
                    if (t.sharing !== 'personal' && user) {
                        const household = households.find(h => h.id === t.sharing);
                        if(household) {
                            let userShare = 0;
                            const userIsMember = household.members.some(m => m.id === user.uid);
                            if(userIsMember) {
                                if (household.splitType === 'shares' && household.splits?.length) {
                                    const totalShares = household.splits.reduce((s, split) => s + (split.share || 0), 0);
                                    if (totalShares > 0) {
                                        const userSplit = household.splits.find(s => s.memberId === user.uid);
                                        const userShares = userSplit?.share || 0;
                                        userShare = (amount * userShares) / totalShares;
                                    } else {
                                        userShare = household.members.length > 0 ? amount / household.members.length : 0;
                                    }
                                } else if (household.splitType === 'income_ratio') {
                                    const totalIncome = household.members.reduce((s, member) => s + (member.income || 0), 0);
                                    if (totalIncome > 0) {
                                        const userIncome = household.members.find(m => m.id === user.uid)?.income || 0;
                                        userShare = (amount * userIncome) / totalIncome;
                                    } else {
                                        userShare = household.members.length > 0 ? amount / household.members.length : 0;
                                    }
                                } else { // Equal split
                                   userShare = household.members.length > 0 ? amount / household.members.length : 0;
                                }
                           }
                           amount = userShare;
                        } else {
                            amount = 0;
                        }
                    }

                    const category = t.categoryId ? categoriesMap.get(t.categoryId) : undefined;
                    const categoryName = category?.name || 'Uncategorized';
                    
                    if (!expenseBreakdownForMonth[categoryName]) {
                        expenseBreakdownForMonth[categoryName] = 0;
                    }
                    expenseBreakdownForMonth[categoryName] += amount;
                });
    
            return {
                name: format(month, 'MMM yy'),
                Income: incomeForMonth,
                Expenses: expensesForMonth,
                Savings: savingsForMonth,
                ...expenseBreakdownForMonth
            };
        });
    
        const grandTotalIncome = monthlyData.reduce((sum, d) => sum + d.Income, 0);
        const grandTotalExpenses = monthlyData.reduce((sum, d) => sum + d.Expenses, 0);
        const grandTotalSavings = monthlyData.reduce((sum, d) => sum + d.Savings, 0);
        const netCashflow = grandTotalIncome - grandTotalExpenses - grandTotalSavings;

        const expensePercentage = grandTotalIncome > 0 ? (grandTotalExpenses / grandTotalIncome) * 100 : 0;
        const savingsPercentage = grandTotalIncome > 0 ? (grandTotalSavings / grandTotalIncome) * 100 : 0;
        const netCashflowPercentage = grandTotalIncome > 0 ? (netCashflow / grandTotalIncome) * 100 : 0;
        
        const cashflowChartData = monthlyData.map(d => ({
            name: d.name,
            Income: d.Income,
            Expenses: d.Expenses,
            Savings: d.Savings,
        }));
        
        const expenseCategoryTotals: { [key: string]: { value: number; color: string } } = {};
        const categoryColors: { [key: string]: string } = {};
        const categoryIcons: { [key: string]: string } = {};
        expenseCategories.forEach(c => {
            expenseCategoryTotals[c.name] = { value: 0, color: c.color };
            categoryColors[c.name] = c.color;
            categoryIcons[c.name] = c.icon;
        });
        expenseCategoryTotals['Uncategorized'] = { value: 0, color: 'hsl(var(--muted))' };
        categoryColors['Uncategorized'] = 'hsl(var(--muted))';
        categoryIcons['Uncategorized'] = 'Paperclip';
    
        monthlyData.forEach(monthData => {
            Object.keys(monthData).forEach(key => {
                if (!['name', 'Income', 'Expenses', 'Savings'].includes(key)) {
                    if (expenseCategoryTotals[key]) {
                        expenseCategoryTotals[key].value += monthData[key as keyof typeof monthData] as number;
                    } else { // Handle case where category might not exist in main list but has data
                         if (!expenseCategoryTotals['Uncategorized']) expenseCategoryTotals['Uncategorized'] = {value: 0, color: 'hsl(var(--muted))'};
                         expenseCategoryTotals['Uncategorized'].value += monthData[key as keyof typeof monthData] as number;
                    }
                }
            });
        });
    
        const expensePieChartData = Object.entries(expenseCategoryTotals)
            .map(([name, { value, color }]) => ({
                name,
                value,
                fill: color,
                percentage: grandTotalExpenses > 0 ? (value / grandTotalExpenses) * 100 : 0,
            }))
            .filter(item => item.value > 0)
            .sort((a,b) => b.value - a.value);
    
        const allCategoryNamesForPeriod = Array.from(new Set(monthlyData.flatMap(d => Object.keys(d).filter(k => !['name', 'Income', 'Expenses', 'Savings'].includes(k)))));
    
        return {
            totalIncome: grandTotalIncome,
            totalExpenses: grandTotalExpenses,
            totalSavings: grandTotalSavings,
            expensePercentage,
            savingsPercentage,
            netCashflowPercentage,
            cashflowChartData,
            expensePieChartData,
            categoryTrendsData: monthlyData,
            allCategoryNamesForPeriod,
            categoryColors,
            categoryIcons
        };
    }, [transactions, savingsGoals, assets, expenseCategories, date, user?.uid, households]);
    
    const handlePresetClick = (months: number) => {
        setDate({
            from: startOfMonth(subMonths(new Date(), months - 1)),
            to: endOfMonth(new Date())
        });
        setIsPickerOpen(false);
    };

    const handleThisYearClick = () => {
        setDate({
            from: startOfYear(new Date()),
            to: endOfMonth(new Date())
        });
        setIsPickerOpen(false);
    };

    const handleLastYearClick = () => {
        const lastYearDate = subYears(new Date(), 1);
        setDate({
            from: startOfYear(lastYearDate),
            to: endOfYear(lastYearDate)
        });
        setIsPickerOpen(false);
    };

    const currencyOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    
    const renderCustomLegend = (props: any) => {
        const { payload } = props;
        return (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-4 text-xs">
            {payload.map((entry: any, index: number) => {
              const { value, color } = entry;
              const iconName = analyticsData.categoryIcons[value] || 'Paperclip';
              return (
                <div 
                    key={`item-${index}`} 
                    className="flex items-center gap-1.5 cursor-pointer transition-opacity"
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(undefined)}
                    style={{ opacity: activeIndex === undefined || activeIndex === index ? 1 : 0.5 }}
                >
                  <DynamicIcon name={iconName} style={{ color }} className="h-3.5 w-3.5" />
                  <span className="font-medium" style={{ color }}>{value}</span>
                </div>
              );
            })}
          </div>
        );
      };

    const renderAreaLegend = (props: any) => {
        const { payload } = props;
        return (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-4 text-xs">
            {payload.map((entry: any, index: number) => {
              const { dataKey, color } = entry;
              const iconName = analyticsData.categoryIcons[dataKey] || 'Paperclip';
              return (
                <div 
                    key={`item-${index}`} 
                    className="flex items-center gap-1.5 cursor-pointer transition-opacity"
                    onMouseEnter={() => setHoveredCategory(dataKey)}
                    onMouseLeave={() => setHoveredCategory(null)}
                    style={{ opacity: hoveredCategory === null || hoveredCategory === dataKey ? 1 : 0.5 }}
                >
                  <DynamicIcon name={iconName} style={{ color }} className="h-3.5 w-3.5" />
                  <span className="font-medium" style={{ color }}>{dataKey}</span>
                </div>
              );
            })}
          </div>
        );
      };

    const barChartIcons: { [key: string]: React.ReactElement } = {
        Income: <ArrowUpCircle className="h-3.5 w-3.5" />,
        Expenses: <ArrowDownCircle className="h-3.5 w-3.5" />,
        Savings: <PiggyBank className="h-3.5 w-3.5" />,
    };

    const renderBarLegend = (props: any) => {
        const { payload } = props;
        return (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-4 text-xs">
            {payload.map((entry: any, index: number) => {
              const { dataKey, color } = entry;
              const icon = barChartIcons[dataKey];
              return (
                <div 
                    key={`item-${index}`} 
                    className="flex items-center gap-1.5 cursor-pointer transition-opacity"
                    onMouseEnter={() => setHoveredBar(dataKey)}
                    onMouseLeave={() => setHoveredBar(null)}
                    style={{ opacity: hoveredBar === null || hoveredBar === dataKey ? 1 : 0.5 }}
                >
                  {React.cloneElement(icon, { style: { color } })}
                  <span className="text-muted-foreground">{dataKey}</span>
                </div>
              );
            })}
          </div>
        );
      };

    const CustomAreaTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const sortedPayload = [...payload].sort((a, b) => b.value - a.value);
            return (
                <div className="rounded-lg border bg-background/95 p-2 text-xs shadow-lg backdrop-blur-sm animate-in fade-in-0 zoom-in-95">
                    <div className="mb-1 border-b pb-1 text-center font-bold">
                        {label}
                    </div>
                    <div className="space-y-1">
                        {sortedPayload.map((pld: any) => (
                            <div key={pld.dataKey} className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-1.5">
                                    <DynamicIcon name={analyticsData.categoryIcons[pld.dataKey] || 'Paperclip'} className="h-3 w-3" style={{ color: pld.fill }} />
                                    <span className="text-muted-foreground">{pld.dataKey}</span>
                                </div>
                                <span className="font-mono font-semibold text-foreground">
                                    {formatCurrency(pld.value, currency, {minimumFractionDigits: 2})}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        return null;
    };

    if (loading) {
        return (
            <main className="flex-1 p-4 sm:p-6 text-center">
                <Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
            </main>
        );
    }
    
    if (transactions.length === 0 && savingsGoals.length === 0) {
        return (
            <main className="flex-1 space-y-6 p-4 sm:p-6">
                <div className="max-w-7xl mx-auto">
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertTitle>No analytics data yet!</AlertTitle>
                        <AlertDescription>
                            Add some income, expenses or savings goals to get started.
                        </AlertDescription>
                    </Alert>
                </div>
            </main>
        )
    }

    return (
        <main className="flex-1 space-y-6 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto w-full space-y-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <h2 className="text-2xl font-semibold">Insights</h2>
                    <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant={"outline"}
                                className={cn(
                                    "w-full md:w-[280px] justify-start text-left font-normal",
                                    !date && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date?.from ? (
                                    date.to ? (
                                        <>
                                            {format(date.from, "LLL dd, yyyy")} -{" "}
                                            {format(date.to, "LLL dd, yyyy")}
                                        </>
                                    ) : (
                                        format(date.from, "LLL dd, yyyy")
                                    )
                                ) : (
                                    <span>Pick a date</span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <div className="flex flex-col sm:flex-row">
                                <div className="flex flex-col gap-1 border-b sm:border-r sm:border-b-0 p-3">
                                    <h4 className="font-medium text-sm leading-none mb-2">Presets</h4>
                                    <Button variant="ghost" size="sm" className="justify-start" onClick={() => handlePresetClick(3)}>Last 3 Months</Button>
                                    <Button variant="ghost" size="sm" className="justify-start" onClick={() => handlePresetClick(6)}>Last 6 Months</Button>
                                    <Button variant="ghost" size="sm" className="justify-start" onClick={() => handlePresetClick(12)}>Last 12 Months</Button>
                                    <Button variant="ghost" size="sm" className="justify-start" onClick={handleThisYearClick}>This Year</Button>
                                    <Button variant="ghost" size="sm" className="justify-start" onClick={handleLastYearClick}>Last Year</Button>
                                </div>
                                <Calendar
                                    initialFocus
                                    mode="range"
                                    defaultMonth={date?.from}
                                    selected={date}
                                    onSelect={(range) => {
                                        setDate(range);
                                        if (range?.from && range?.to) {
                                            setIsPickerOpen(false);
                                        }
                                    }}
                                    numberOfMonths={1}
                                />
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
                
                <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Income</CardTitle>
                            <ArrowUpCircle className="h-4 w-4 text-chart-2" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-chart-2">{formatCurrency(analyticsData.totalIncome, currency, currencyOptions)}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                            <ArrowDownCircle className="h-4 w-4 text-destructive" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-destructive">{formatCurrency(analyticsData.totalExpenses, currency, currencyOptions)}</div>
                            {analyticsData.totalIncome > 0 && (
                                <p className="text-xs text-muted-foreground">{analyticsData.expensePercentage.toFixed(1)}% of income</p>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Savings &amp; Investments</CardTitle>
                            <PiggyBank className="h-4 w-4 text-chart-1" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-chart-1">{formatCurrency(analyticsData.totalSavings, currency, currencyOptions)}</div>
                            {analyticsData.totalIncome > 0 && (
                                <p className="text-xs text-muted-foreground">{analyticsData.savingsPercentage.toFixed(1)}% of income</p>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Net Cashflow</CardTitle>
                            <Scale className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${analyticsData.totalIncome - analyticsData.totalExpenses - analyticsData.totalSavings >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(analyticsData.totalIncome - analyticsData.totalExpenses - analyticsData.totalSavings, currency, currencyOptions)}</div>
                            {analyticsData.totalIncome > 0 && (
                                <p className="text-xs text-muted-foreground">{analyticsData.netCashflowPercentage.toFixed(1)}% of income</p>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <Card className="lg:col-span-3">
                        <CardHeader>
                            <CardTitle>Cashflow Over Time</CardTitle>
                            <CardDescription>Income, expenses and savings for the selected period.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[350px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={analyticsData.cashflowChartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => formatCurrency(Number(value), currency, { notation: 'compact' })} />
                                    <Tooltip formatter={(value) => formatCurrency(Number(value), currency, currencyOptions)} cursor={{ fill: 'hsl(var(--muted))' }} />
                                    <Legend content={renderBarLegend} verticalAlign="bottom" />
                                    <Bar dataKey="Income" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} className="transition-opacity" fillOpacity={hoveredBar === null || hoveredBar === 'Income' ? 1 : 0.3}/>
                                    <Bar dataKey="Expenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} className="transition-opacity" fillOpacity={hoveredBar === null || hoveredBar === 'Expenses' ? 1 : 0.3}/>
                                    <Bar dataKey="Savings" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} className="transition-opacity" fillOpacity={hoveredBar === null || hoveredBar === 'Savings' ? 1 : 0.3}/>
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle>Expense Breakdown</CardTitle>
                            <CardDescription>How your expenses are categorized.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[350px]">
                            {analyticsData.expensePieChartData.length > 0 && analyticsData.totalExpenses > 0 ? (
                                <div className="relative w-full h-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                activeIndex={activeIndex}
                                                activeShape={(props) => {
                                                    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
                                                    return <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} />;
                                                }}
                                                data={analyticsData.expensePieChartData}
                                                cx="50%"
                                                cy="50%"
                                                labelLine={false}
                                                innerRadius={80}
                                                outerRadius={110}
                                                dataKey="value"
                                                onMouseEnter={onPieEnter}
                                                onMouseLeave={() => setActiveIndex(undefined)}
                                                className="cursor-pointer"
                                            >
                                                {analyticsData.expensePieChartData.map((entry, index) => (
                                                    <Cell
                                                        key={`cell-${index}`}
                                                        fill={entry.fill}
                                                        className="transition-opacity"
                                                        style={{ opacity: activeIndex === undefined || activeIndex === index ? 1 : 0.5 }}
                                                    />
                                                ))}
                                            </Pie>
                                            <Legend content={renderCustomLegend} verticalAlign="bottom" />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="absolute top-1/2 left-1/2 -translate-y-[60%] -translate-x-1/2 text-center pointer-events-none">
                                        {activeIndex !== undefined ? (
                                            <>
                                                <p className="text-sm font-medium text-muted-foreground truncate max-w-[120px]">{analyticsData.expensePieChartData[activeIndex].name}</p>
                                                <p className="text-2xl font-bold">
                                                    {analyticsData.expensePieChartData[activeIndex].percentage.toFixed(1)}%
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    {formatCurrency(analyticsData.expensePieChartData[activeIndex].value, currency, currencyOptions)}
                                                </p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-sm font-medium text-muted-foreground">Total Expenses</p>
                                                <p className="text-2xl font-bold">
                                                    {formatCurrency(analyticsData.totalExpenses, currency, currencyOptions)}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex h-full items-center justify-center text-muted-foreground">No expense data for this period.</div>
                            )}
                        </CardContent>
                    </Card>
                </div>
                
                <Card>
                    <CardHeader>
                        <CardTitle>Expense Trends by Category</CardTitle>
                        <CardDescription>Monthly spending breakdown across your categories.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[350px]">
                        {analyticsData.allCategoryNamesForPeriod.length > 0 && analyticsData.totalExpenses > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={analyticsData.categoryTrendsData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => formatCurrency(Number(value), currency, { notation: 'compact' })} />
                                    <Tooltip
                                        cursor={{ fill: 'hsl(var(--muted))' }}
                                        content={<CustomAreaTooltip />}
                                    />
                                    <Legend content={renderAreaLegend} verticalAlign="bottom" />
                                    {analyticsData.allCategoryNamesForPeriod.map((key) => (
                                        <Area
                                            key={key}
                                            type="monotone"
                                            dataKey={key}
                                            stackId="1"
                                            stroke={analyticsData.categoryColors[key] || '#8884d8'}
                                            fill={analyticsData.categoryColors[key] || '#8884d8'}
                                            fillOpacity={hoveredCategory === null || hoveredCategory === key ? 0.8 : 0.2}
                                            strokeOpacity={hoveredCategory === null || hoveredCategory === key ? 1 : 0.3}
                                            className="transition-opacity"
                                        />
                                    ))}
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground">No expense data for this period to show trends.</div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}

export default function AnalyticsPage() {
    return (
        <MainLayout>
            <Header title="Budget Analytics" />
            <Analytics />
        </MainLayout>
    );
}
