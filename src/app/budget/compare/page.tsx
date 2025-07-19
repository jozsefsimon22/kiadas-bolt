
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
import { Loader2, Info, ArrowUp, ArrowDown, TrendingUp, TrendingDown, Scale, CalendarIcon, ChevronDown, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import DynamicIcon from '@/components/dynamic-icon';
import { Button } from '@/components/ui/button';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { cn } from '@/lib/utils';
import { defaultExpenseCategories } from '@/lib/categories';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

// Data types from other pages, necessary for calculations
type TransactionType = 'income' | 'expense';
type Frequency = 'one-off' | 'recurring';
type AmountChange = { id: string; amount: number; date: Date; };
type BaseTransaction = { id: string; userId: string; name: string; amounts: AmountChange[]; frequency: Frequency; endDate?: Date | null; };
type Income = BaseTransaction & { transactionType: 'income'; categoryId?: string; sharing: string; };
type Expense = BaseTransaction & { transactionType: 'expense'; sharing: string; classification?: 'need' | 'want'; categoryId?: string; };
type Transaction = Income | Expense;
type ExpenseCategory = { id: string; userId?: string; name: string; icon: string; color: string; isDefault?: boolean; }
type Household = { id: string; name: string; members: { id: string; name: string; income?: number; }[]; splitType?: 'equal' | 'shares' | 'income_ratio'; splits?: { memberId: string, share: number }[]; };


const getAmountForDate = (transaction: Transaction, targetDate: Date): number => {
    if (!transaction.amounts || transaction.amounts.length === 0) return 0;
    const sortedAmounts = [...transaction.amounts].sort((a, b) => b.date.getTime() - a.date.getTime());
    const activeAmount = sortedAmounts.find(a => a.date <= targetDate);
    return activeAmount ? activeAmount.amount : 0;
};

type PeriodMetrics = {
    totalIncome: number;
    totalExpenses: number;
    categoryTotals: Record<string, number>;
    categoryTransactions: Record<string, { id: string; name: string; amount: number }[]>;
};

type SortableKey = 'category' | 'amountA' | 'amountB' | 'changeAbs' | 'changePerc';
type Preset = 'month' | 'monthVsLastYear' | 'year' | 'custom';

const presetLabels: Record<Preset, string> = {
    month: 'This Month vs Last Month',
    monthVsLastYear: 'This Month vs This Month Last Year',
    year: 'This Year (YTD) vs Last Year (YTD)',
    custom: 'Custom Range'
};


function BudgetComparison() {
    const user = useAuth();
    const { currency } = useCurrency();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [households, setHouseholds] = useState<Household[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

    const [periodA, setPeriodA] = useState<DateRange | undefined>({
        from: startOfMonth(subMonths(new Date(), 1)),
        to: endOfMonth(subMonths(new Date(), 1)),
    });
    const [periodB, setPeriodB] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfMonth(new Date()),
    });
    
    const [activePreset, setActivePreset] = useState<Preset>('month');
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey; direction: 'ascending' | 'descending' }>({ key: 'changeAbs', direction: 'descending' });

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
                setExpenseCategories([...mappedDefaultCategories, ...customCategories]);
                
                const householdQuery = query(collection(db, "households"), where("memberIds", "array-contains", user.uid));
                const householdSnap = await getDocs(householdQuery);
                const householdData = householdSnap.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Household[];
                setHouseholds(householdData);
                const householdIds = householdData.map(h => h.id);

                const userTransactionsQuery = query(collection(db, 'transactions'), where('userId', '==', user.uid));
                const sharedTransactionsQuery = householdIds.length > 0 
                    ? query(collection(db, 'transactions'), where('sharing', 'in', householdIds))
                    : null;
                
                const queries = [getDocs(userTransactionsQuery)];
                if (sharedTransactionsQuery) {
                    queries.push(getDocs(sharedTransactionsQuery));
                }
                
                const [userTxSnap, sharedTxSnap] = await Promise.all(queries);

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

            } catch (error) {
                console.error("Error fetching comparison data:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [user]);

    const comparisonData = useMemo(() => {
        const categoriesMap = new Map(expenseCategories.map(c => [c.id, c]));

        const calculateMetrics = (range: DateRange | undefined): PeriodMetrics => {
            if (!range?.from || !user) return { totalIncome: 0, totalExpenses: 0, categoryTotals: {}, categoryTransactions: {} };
            
            const fromDate = range.from;
            const toDate = range.to || range.from;
            const months = eachMonthOfInterval({ start: fromDate, end: toDate });
            
            let totalIncome = 0;
            let totalExpenses = 0;
            const categoryTotals: Record<string, number> = {};
            const transactionAmountsInPeriod: Record<string, number> = {};

            months.forEach(month => {
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
                
                totalIncome += activeTransactions
                    .filter(t => t.transactionType === 'income')
                    .reduce((sum, t) => sum + getAmountForDate(t, monthEnd), 0);
                    
                activeTransactions
                    .filter((t): t is Expense => t.transactionType === 'expense')
                    .forEach(t => {
                        let amount = getAmountForDate(t, monthEnd);
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

                        totalExpenses += amount;
                        const categoryName = t.categoryId ? categoriesMap.get(t.categoryId)?.name || 'Uncategorized' : 'Uncategorized';
                        if (!categoryTotals[categoryName]) {
                            categoryTotals[categoryName] = 0;
                        }
                        categoryTotals[categoryName] += amount;

                        if (!transactionAmountsInPeriod[t.id]) {
                            transactionAmountsInPeriod[t.id] = 0;
                        }
                        transactionAmountsInPeriod[t.id] += amount;
                    });
            });

            const categoryTransactions: Record<string, {id: string, name: string, amount: number}[]> = {};
            transactions.forEach(t => {
                if (t.transactionType === 'expense' && transactionAmountsInPeriod[t.id] > 0) {
                    const categoryName = t.categoryId ? categoriesMap.get(t.categoryId)?.name || 'Uncategorized' : 'Uncategorized';
                     if (!categoryTransactions[categoryName]) {
                        categoryTransactions[categoryName] = [];
                    }
                    categoryTransactions[categoryName].push({
                        id: t.id,
                        name: t.name,
                        amount: transactionAmountsInPeriod[t.id],
                    });
                }
            });

            return { totalIncome, totalExpenses, categoryTotals, categoryTransactions };
        };

        const metricsA = calculateMetrics(periodA);
        const metricsB = calculateMetrics(periodB);

        const allCategoryNames = Array.from(new Set([...Object.keys(metricsA.categoryTotals), ...Object.keys(metricsB.categoryTotals)]));

        const breakdown = allCategoryNames.map(name => {
            const amountA = metricsA.categoryTotals[name] || 0;
            const amountB = metricsB.categoryTotals[name] || 0;
            const transactionsA = metricsA.categoryTransactions[name] || [];
            const transactionsB = metricsB.categoryTransactions[name] || [];
            const changeAbs = amountB - amountA;
            const changePerc = amountA !== 0 ? (changeAbs / amountA) * 100 : (changeAbs > 0 ? Infinity : -Infinity);
            return {
                category: name,
                amountA,
                amountB,
                changeAbs,
                changePerc,
                transactionsA,
                transactionsB,
            };
        });

        breakdown.sort((a, b) => {
            const valA = a[sortConfig.key];
            const valB = b[sortConfig.key];
            if (sortConfig.key === 'category') {
                return sortConfig.direction === 'ascending' ? a.category.localeCompare(b.category) : b.category.localeCompare(a.category);
            }
            if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
            return 0;
        });

        const categoryIcons = Object.fromEntries(expenseCategories.map(c => [c.name, c.icon]));
        categoryIcons['Uncategorized'] = 'Paperclip';

        const categoryColors = Object.fromEntries(expenseCategories.map(c => [c.name, c.color]));
        categoryColors['Uncategorized'] = 'hsl(var(--muted-foreground))';

        return {
            periodA: metricsA,
            periodB: metricsB,
            breakdown,
            categoryIcons,
            categoryColors,
        };
    }, [transactions, expenseCategories, periodA, periodB, sortConfig, user, households]);

    const requestSort = (key: SortableKey) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const handlePreset = (preset: 'month' | 'monthVsLastYear' | 'year') => {
        setActivePreset(preset);
        const today = new Date();
        if (preset === 'month') {
            setPeriodA({ from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) });
            setPeriodB({ from: startOfMonth(today), to: endOfMonth(today) });
        } else if (preset === 'monthVsLastYear') {
            const thisMonthThisYearStart = startOfMonth(today);
            const thisMonthThisYearEnd = endOfMonth(today);
            const thisMonthLastYearStart = startOfMonth(subYears(today, 1));
            const thisMonthLastYearEnd = endOfMonth(subYears(today, 1));
            setPeriodA({ from: thisMonthLastYearStart, to: thisMonthLastYearEnd });
            setPeriodB({ from: thisMonthThisYearStart, to: thisMonthThisYearEnd });
        } else if (preset === 'year') {
            const lastYearToday = subYears(today, 1);
            setPeriodA({ from: startOfYear(lastYearToday), to: lastYearToday });
            setPeriodB({ from: startOfYear(today), to: today });
        }
    };
    
    const handlePeriodChange = (setter: React.Dispatch<React.SetStateAction<DateRange | undefined>>) => (range: DateRange | undefined) => {
        setter(range);
        setActivePreset('custom');
    }

    const PeriodPicker = ({ period, setPeriod, title }: { period: DateRange | undefined, setPeriod: (p: DateRange | undefined) => void, title: string }) => {
    
        const handleDateChange = (part: 'from' | 'to') => (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value;
            const newDate = value ? new Date(value) : undefined;
            
            let adjustedDate: Date | undefined = undefined;
            if (newDate) {
                const timezoneOffset = newDate.getTimezoneOffset() * 60000;
                adjustedDate = new Date(newDate.getTime() + timezoneOffset);
            }
    
            const newPeriod = {
                from: part === 'from' ? adjustedDate : period?.from,
                to: part === 'to' ? adjustedDate : period?.to
            };

            if (newPeriod.from && newPeriod.to && isAfter(newPeriod.from, newPeriod.to)) {
                // Swap if from is after to
                setPeriod({ from: newPeriod.to, to: newPeriod.from });
            } else {
                setPeriod(newPeriod);
            }
        };
        
        const toISODateString = (date: Date | undefined | null) => {
            if (!date) return '';
            return format(date, 'yyyy-MM-dd');
        }
    
        const displayFormat = (p: DateRange | undefined): string => {
            if (!p?.from) return "Pick a date range";
    
            const fromDate = format(p.from, "LLL dd, yyyy");
    
            if (!p.to || isEqual(p.from, p.to)) {
                return fromDate;
            }
    
            const toDate = format(p.to, "LLL dd, yyyy");
            
            if (isEqual(p.from, startOfMonth(p.from)) && isEqual(p.to, endOfMonth(p.from))) {
                return format(p.from, 'MMMM yyyy');
            }
            
            if (isEqual(p.from, startOfYear(p.from)) && isEqual(p.to, endOfYear(p.from))) {
                return format(p.from, 'yyyy');
            }
    
            return `${fromDate} - ${toDate}`;
        }
    
        return (
            <div className="flex flex-col gap-2 w-full">
                <h4 className="font-medium text-sm">{title}</h4>
                
                {/* Mobile: Native Date Pickers */}
                <div className="grid grid-cols-2 gap-2 md:hidden">
                    <div className="space-y-1">
                        <Label htmlFor={`from-input-${title.replace(/\s+/g, '-')}`} className="text-xs text-muted-foreground">From</Label>
                        <Button variant="outline" asChild className="w-full justify-start text-left font-normal h-10 px-3">
                            <label htmlFor={`from-input-${title.replace(/\s+/g, '-')}`}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {period?.from ? format(period.from, "MMM d, y") : <span>Pick date</span>}
                            </label>
                        </Button>
                        <input
                            type="date"
                            id={`from-input-${title.replace(/\s+/g, '-')}`}
                            aria-label={`${title} start date`}
                            value={toISODateString(period?.from)}
                            onChange={handleDateChange('from')}
                            className="sr-only"
                        />
                    </div>
                    <div className="space-y-1">
                         <Label htmlFor={`to-input-${title.replace(/\s+/g, '-')}`} className="text-xs text-muted-foreground">To</Label>
                         <Button variant="outline" asChild className="w-full justify-start text-left font-normal h-10 px-3">
                            <label htmlFor={`to-input-${title.replace(/\s+/g, '-')}`}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {period?.to ? format(period.to, "MMM d, y") : <span>Pick date</span>}
                            </label>
                        </Button>
                        <input
                            type="date"
                            id={`to-input-${title.replace(/\s+/g, '-')}`}
                            aria-label={`${title} end date`}
                            value={toISODateString(period?.to)}
                            onChange={handleDateChange('to')}
                            className="sr-only"
                        />
                    </div>
                </div>
    
                {/* Desktop: Popover with Calendar */}
                <div className="hidden md:block">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                id={`date-${title.replace(' ','')}`}
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !period && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                <span>{displayFormat(period)}</span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar initialFocus mode="range" defaultMonth={period?.from} selected={period} onSelect={setPeriod} numberOfMonths={2} />
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
        );
    };
    
    const SummaryCard = ({ title, valueA, valueB }: { title: string, valueA: number, valueB: number }) => {
        const change = valueB - valueA;
        const isIncrease = change > 0;
        
        let trendColorClass = 'text-muted-foreground';
        let trendIcon = <Scale className="h-4 w-4" />;
    
        let headerIcon;
        let mainValueColor = 'text-foreground';
    
        let percChangeText = 'N/A';
    
        if(valueA !== 0) {
            const percChange = (change / valueA) * 100;
            if (isFinite(percChange)) percChangeText = `${percChange.toFixed(1)}%`;
        } else if(change > 0) {
            percChangeText = 'New';
        }
    
        if (title === 'Income') {
            headerIcon = <ArrowUpCircle className="h-4 w-4 text-chart-2" />;
            mainValueColor = 'text-chart-2';
            if (change !== 0) {
                trendColorClass = isIncrease ? 'text-green-500' : 'text-red-500';
                trendIcon = isIncrease ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />;
            }
        } else if (title === 'Expenses') {
            headerIcon = <ArrowDownCircle className="h-4 w-4 text-destructive" />;
            mainValueColor = 'text-destructive';
            if (change !== 0) {
                trendColorClass = isIncrease ? 'text-red-500' : 'text-green-500';
                trendIcon = isIncrease ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />;
            }
        } else { // Net
            headerIcon = <Scale className="h-4 w-4 text-muted-foreground" />;
            if (change !== 0) {
                trendColorClass = isIncrease ? 'text-green-500' : 'text-red-500';
                trendIcon = isIncrease ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />;
                mainValueColor = change >= 0 ? 'text-primary' : 'text-destructive';
            } else {
                 mainValueColor = valueB >= 0 ? 'text-primary' : 'text-destructive';
            }
        }
        
        return (
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{title}</CardTitle>
                    {headerIcon}
                </CardHeader>
                <CardContent className="space-y-2">
                    <p className={cn("text-2xl font-bold", mainValueColor)}>{formatCurrency(valueB, currency)}</p>
                    <div className="flex items-center gap-2 text-xs">
                        <div className={cn("flex items-center gap-1", trendColorClass)}>
                            {trendIcon}
                            <span>{percChangeText}</span>
                        </div>
                        <span className="text-muted-foreground">vs {formatCurrency(valueA, currency)}</span>
                    </div>
                </CardContent>
            </Card>
        );
    };

    const SortableHeader = ({ title, sortKey, className }: { title: string, sortKey: SortableKey, className?: string }) => (
        <TableHead className={cn('p-0', className)}>
          <Button variant="ghost" onClick={() => requestSort(sortKey)} className={cn("w-full h-auto py-3 px-4 font-semibold", className?.includes('text-right') ? 'justify-end' : 'justify-start')}>
            {title}
            {sortConfig.key === sortKey && (sortConfig.direction === 'ascending' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />)}
          </Button>
        </TableHead>
    );

    if (loading) {
        return (
            <main className="flex-1 p-4 sm:p-6 text-center">
                <Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
            </main>
        );
    }

    return (
        <main className="flex-1 space-y-6 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto w-full space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Budget Comparison</CardTitle>
                        <CardDescription>Select two periods to compare your income and expenses.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                            <PeriodPicker period={periodA} setPeriod={handlePeriodChange(setPeriodA)} title="Period A" />
                            <PeriodPicker period={periodB} setPeriod={handlePeriodChange(setPeriodB)} title="Period B" />
                            <div className="flex flex-col gap-1.5">
                                <Label>Presets</Label>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="w-full justify-between">
                                            <span>{presetLabels[activePreset]}</span>
                                            <ChevronDown className="h-4 w-4 opacity-50" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-[--radix-dropdown-menu-trigger-width)]">
                                        <DropdownMenuItem onClick={() => handlePreset('month')}>This Month vs Last Month</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handlePreset('monthVsLastYear')}>This Month vs This Month Last Year</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handlePreset('year')}>This Year (YTD) vs Last Year (YTD)</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {!periodA?.from || !periodB?.from ? (
                    <Alert><Info className="h-4 w-4" /><AlertTitle>Select two periods to begin comparison.</AlertTitle></Alert>
                ) : (
                <>
                    <div className="grid gap-6 md:grid-cols-3">
                        <SummaryCard title="Income" valueA={comparisonData.periodA.totalIncome} valueB={comparisonData.periodB.totalIncome} />
                        <SummaryCard title="Expenses" valueA={comparisonData.periodA.totalExpenses} valueB={comparisonData.periodB.totalExpenses} />
                        <SummaryCard title="Net" valueA={comparisonData.periodA.totalIncome - comparisonData.periodA.totalExpenses} valueB={comparisonData.periodB.totalIncome - comparisonData.periodB.totalExpenses} />
                    </div>
                    
                    <Card>
                        <CardHeader>
                            <CardTitle>Expense Category Breakdown</CardTitle>
                            <CardDescription>A detailed look at how your spending changed across categories. Click a row to see individual transactions.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* Mobile Card View */}
                            <div className="space-y-4 md:hidden">
                                {comparisonData.breakdown.map(item => {
                                    const isIncrease = item.changeAbs > 0;
                                    const colorClass = item.changeAbs === 0 ? '' : (isIncrease ? 'text-red-500' : 'text-green-500');
                                    let percText = '–';
                                    if (isFinite(item.changePerc)) {
                                        percText = `${item.changePerc.toFixed(1)}%`;
                                    } else if (item.amountA === 0 && item.amountB > 0) {
                                        percText = 'New';
                                    }
                                    const isExpanded = expandedCategory === item.category;
                                    const categoryColor = comparisonData.categoryColors[item.category];

                                    return (
                                        <Card key={item.category} className={cn("overflow-hidden", isExpanded && "bg-muted/30")}>
                                            <div
                                                className="p-4 cursor-pointer"
                                                onClick={() => setExpandedCategory(isExpanded ? null : item.category)}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="flex items-center gap-3 font-medium">
                                                        <DynamicIcon name={comparisonData.categoryIcons[item.category]} className="h-6 w-6" style={{ color: categoryColor }} />
                                                        <div className="truncate pr-2" style={{ color: categoryColor }}>{item.category}</div>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="font-mono text-lg font-semibold">{formatCurrency(item.amountB, currency)}</p>
                                                        <p className={cn("text-sm font-mono", colorClass)}>
                                                            {item.changeAbs >= 0 ? '+' : ''}{formatCurrency(item.changeAbs, currency)} ({percText})
                                                        </p>
                                                    </div>
                                                </div>
                                                <ChevronDown className={cn("h-4 w-4 transition-transform text-muted-foreground mx-auto mt-2", isExpanded && "rotate-180")} />
                                            </div>
                                            {isExpanded && (
                                                <div className="px-4 pb-4 border-t">
                                                    <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4">
                                                        <div className="space-y-2">
                                                            <h4 className="font-semibold text-sm">Period A ({formatCurrency(item.amountA, currency)})</h4>
                                                            {item.transactionsA.length > 0 ? (
                                                                <ul className="space-y-1 text-sm">
                                                                    {item.transactionsA.map(tx => (
                                                                        <li key={tx.id} className="flex justify-between">
                                                                            <span className="text-muted-foreground truncate pr-2">{tx.name}</span>
                                                                            <span className="font-mono shrink-0">{formatCurrency(tx.amount, currency)}</span>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            ) : <p className="text-sm text-muted-foreground">No transactions in this period.</p>}
                                                        </div>
                                                        <Separator />
                                                        <div className="space-y-2">
                                                            <h4 className="font-semibold text-sm">Period B ({formatCurrency(item.amountB, currency)})</h4>
                                                            {item.transactionsB.length > 0 ? (
                                                                <ul className="space-y-1 text-sm">
                                                                    {item.transactionsB.map(tx => (
                                                                        <li key={tx.id} className="flex justify-between">
                                                                            <span className="text-muted-foreground truncate pr-2">{tx.name}</span>
                                                                            <span className="font-mono shrink-0">{formatCurrency(tx.amount, currency)}</span>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            ) : <p className="text-sm text-muted-foreground">No transactions in this period.</p>}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </Card>
                                    )
                                })}
                            </div>

                            {/* Desktop Table View */}
                            <Table className="hidden md:table">
                                <TableHeader>
                                    <TableRow>
                                        <SortableHeader title="Category" sortKey="category" />
                                        <SortableHeader title={`Period A`} sortKey="amountA" className="text-right" />
                                        <SortableHeader title={`Period B`} sortKey="amountB" className="text-right" />
                                        <SortableHeader title="Change ($)" sortKey="changeAbs" className="text-right" />
                                        <SortableHeader title="Change (%)" sortKey="changePerc" className="text-right" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {comparisonData.breakdown.map(item => {
                                        const isIncrease = item.changeAbs > 0;
                                        const colorClass = item.changeAbs === 0 ? '' : (isIncrease ? 'text-red-500' : 'text-green-500');
                                        let percText = '–';
                                        if (isFinite(item.changePerc)) {
                                            percText = `${item.changePerc.toFixed(1)}%`;
                                        } else if (item.amountA === 0 && item.amountB > 0) {
                                            percText = 'New';
                                        }
                                        const isExpanded = expandedCategory === item.category;
                                        const categoryColor = comparisonData.categoryColors[item.category];

                                        return (
                                            <React.Fragment key={item.category}>
                                                <TableRow
                                                    className="cursor-pointer hover:bg-muted/50 data-[state=open]:bg-muted/50"
                                                    onClick={() => setExpandedCategory(isExpanded ? null : item.category)}
                                                    data-state={isExpanded ? 'open' : 'closed'}
                                                >
                                                    <TableCell className="font-medium flex items-center gap-2">
                                                        <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                                                        <DynamicIcon name={comparisonData.categoryIcons[item.category]} className="h-5 w-5" style={{ color: categoryColor }} />
                                                        <span style={{ color: categoryColor }}>{item.category}</span>
                                                    </TableCell>
                                                    <TableCell className="text-right">{formatCurrency(item.amountA, currency)}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(item.amountB, currency)}</TableCell>
                                                    <TableCell className={cn("text-right", colorClass)}>{formatCurrency(item.changeAbs, currency)}</TableCell>
                                                    <TableCell className={cn("text-right", colorClass)}>{percText}</TableCell>
                                                </TableRow>
                                                {isExpanded && (
                                                    <TableRow>
                                                        <TableCell colSpan={5} className="p-0">
                                                            <div className="p-4 bg-muted/30 grid md:grid-cols-2 gap-x-8 gap-y-4">
                                                                <div>
                                                                    <h4 className="font-semibold mb-2 text-sm">Period A Transactions</h4>
                                                                    {item.transactionsA.length > 0 ? (
                                                                        <ul className="space-y-1 text-sm">
                                                                            {item.transactionsA.map(tx => (
                                                                                <li key={tx.id} className="flex justify-between">
                                                                                    <span className="text-muted-foreground">{tx.name}</span>
                                                                                    <span className="font-mono">{formatCurrency(tx.amount, currency)}</span>
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    ) : <p className="text-sm text-muted-foreground">No transactions in this period.</p>}
                                                                </div>
                                                                <div>
                                                                    <h4 className="font-semibold mb-2 text-sm">Period B Transactions</h4>
                                                                    {item.transactionsB.length > 0 ? (
                                                                        <ul className="space-y-1 text-sm">
                                                                            {item.transactionsB.map(tx => (
                                                                                <li key={tx.id} className="flex justify-between">
                                                                                    <span className="text-muted-foreground">{tx.name}</span>
                                                                                    <span className="font-mono">{formatCurrency(tx.amount, currency)}</span>
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    ) : <p className="text-sm text-muted-foreground">No transactions in this period.</p>}
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </>
                )}
            </div>
        </main>
    );
}

export default function BudgetComparisonPage() {
    return (
        <MainLayout>
            <Header title="Budget Comparison" />
            <BudgetComparison />
        </MainLayout>
    );
}
