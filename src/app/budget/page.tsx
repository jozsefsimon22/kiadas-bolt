
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, startOfMonth, endOfMonth, isWithinInterval, isAfter, isEqual, addMonths, subMonths } from "date-fns";

// Components
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

// Icons
import { Loader2, Info, ArrowUpCircle, ArrowDownCircle, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, PiggyBank, Scale, PlusCircle, Edit, CalendarIcon, ChevronsUpDown } from 'lucide-react';

// Firebase & Context
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, addDoc, updateDoc, doc } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import DynamicIcon from '@/components/dynamic-icon';
import { defaultExpenseCategories, defaultIncomeCategories } from '@/lib/categories';

// Data Types
type TransactionType = 'income' | 'expense';
type Frequency = 'one-off' | 'recurring';
type AmountChange = { id: string; amount: number; date: Date; };
type BaseTransaction = { id: string; userId: string; name: string; amounts: AmountChange[]; frequency: Frequency; endDate?: Date | null; };
type Income = BaseTransaction & { transactionType: 'income'; categoryId?: string; sharing: string; };
type Expense = BaseTransaction & { transactionType: 'expense'; sharing: string; classification?: 'need' | 'want'; categoryId?: string; };
type Transaction = Income | Expense;
type SavingGoalContribution = { id: string; amount: number; date: Date; };
type SavingGoal = { id: string; userId: string; name: string; targetAmount: number; targetDate: Date; startDate: Date; contributions: SavingGoalContribution[]; };
type Category = { id: string; userId?: string; name: string; icon: string; color: string; };
type AssetContribution = { id: string; amount: number; date: Date; };
type Asset = { id: string; userId: string; name: string; valueHistory: any[]; contributions: AssetContribution[]; };
type IncomeChange = { id: string; amount: number; date: Date; };
type Member = { id: string; name: string; email: string; incomeHistory?: IncomeChange[]; };
type Household = { id: string; ownerId: string; name: string; members: Member[]; memberIds: string[]; splitType?: 'equal' | 'shares' | 'income_ratio'; splits?: { memberId: string, share: number }[]; };


// Zod Schemas
const addTransactionSchema = z.object({
  transactionType: z.enum(['income', 'expense']),
  name: z.string().min(1, 'Name is required.'),
  amount: z.coerce.number().positive('Amount must be positive.'),
  frequency: z.enum(['one-off', 'recurring']),
  sharing: z.string(),
  classification: z.enum(['need', 'want']).optional(),
  categoryId: z.string().optional(),
  startDate: z.date({ required_error: 'A start date is required.' }),
  endDate: z.date().nullable().optional(),
})
.refine(data => data.transactionType !== 'expense' || !!data.classification, { message: 'Need/Want classification is required for expenses.', path: ['classification'] })
.refine(data => {
  if (data.frequency === 'recurring' && data.endDate) return isAfter(data.endDate, data.startDate);
  return true;
}, { message: 'End date must be after the start date.', path: ['endDate'] });

const quickEditSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive.'),
});


const getAmountForDate = (transaction: Transaction, targetDate: Date): number => {
    if (!transaction.amounts || transaction.amounts.length === 0) return 0;
    const sortedAmounts = [...transaction.amounts].sort((a, b) => b.date.getTime() - a.date.getTime());
    const activeAmount = sortedAmounts.find(a => a.date <= targetDate);
    return activeAmount ? activeAmount.amount : 0;
};

const getIncomeForDate = (member: Member | undefined, targetDate: Date): number => {
    if (!member || !member.incomeHistory || member.incomeHistory.length === 0) return 0;
    const sortedHistory = [...member.incomeHistory].sort((a, b) => b.date.getTime() - a.date.getTime());
    const activeIncome = sortedHistory.find(i => i.date <= targetDate);
    return activeIncome ? activeIncome.amount : 0;
};

type SortableKey = 'name' | 'amount' | 'category';
type GroupingKey = 'none' | 'category' | 'classification';
type GroupedExpenseItem = {
    name: string;
    total: number;
    icon?: string;
    color?: string;
    transactions: (Expense & { displayAmount: number })[];
};

function BudgetOverview() {
    const user = useAuth();
    const { currency } = useCurrency();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
    const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
    const [households, setHouseholds] = useState<Household[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(new Date());
    const [incomeSortConfig, setIncomeSortConfig] = useState<{ key: SortableKey, direction: 'ascending' | 'descending' }>({ key: 'amount', direction: 'descending' });
    const [expenseSortConfig, setExpenseSortConfig] = useState<{ key: SortableKey, direction: 'ascending' | 'descending' }>({ key: 'amount', direction: 'descending' });
    const [expenseGrouping, setExpenseGrouping] = useState<GroupingKey>('none');
    
    // State for dialogs
    const { toast } = useToast();
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isQuickEditDialogOpen, setIsQuickEditDialogOpen] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [addTransactionType, setAddTransactionType] = useState<'income' | 'expense' | null>(null);
    const [isUpdateTypeDialogOpen, setIsUpdateTypeDialogOpen] = useState(false);
    const [pendingUpdate, setPendingUpdate] = useState<{ transaction: Transaction; values: { amount: number } } | null>(null);

    const addForm = useForm<z.infer<typeof addTransactionSchema>>({
        resolver: zodResolver(addTransactionSchema),
    });

    const quickEditForm = useForm<z.infer<typeof quickEditSchema>>({
        resolver: zodResolver(quickEditSchema),
    });

    const transactionTypeWatcher = addForm.watch('transactionType');

    async function fetchData() {
        if (!user) return;
        setLoading(true);

        // Fetch households first to get their IDs
        const householdQuery = query(collection(db, "households"), where("memberIds", "array-contains", user.uid));
        const householdSnap = await getDocs(householdQuery);
        const householdsData = householdSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            members: (doc.data().members || []).map((m: any) => ({
                ...m,
                incomeHistory: (m.incomeHistory || []).map((i: any) => ({...i, date: i.date.toDate()}))
            })),
        } as Household));
        setHouseholds(householdsData);
        const householdIds = householdsData.map(h => h.id);

        // Prepare transaction queries
        const userTransactionsQuery = query(collection(db, 'transactions'), where('userId', '==', user.uid));
        
        // This will fetch all transactions shared with the user's households
        const sharedTransactionsQuery = householdIds.length > 0 
            ? query(collection(db, 'transactions'), where('sharing', 'in', householdIds))
            : null;

        const queries = [
            getDocs(query(collection(db, 'savings'), where('userId', '==', user.uid))),
            getDocs(query(collection(db, 'assets'), where('userId', '==', user.uid))),
            getDocs(query(collection(db, 'expenseCategories'), where('userId', '==', user.uid))),
            getDocs(query(collection(db, 'incomeCategories'), where('userId', '==', user.uid))),
            getDocs(userTransactionsQuery)
        ];

        if (sharedTransactionsQuery) {
            queries.push(getDocs(sharedTransactionsQuery));
        }

        const [savingsSnap, assetsSnap, expCatSnap, incCatSnap, userTxSnap, sharedTxSnap] = await Promise.all(queries);
        
        // Combine and de-duplicate transactions
        const allTransactions = new Map<string, Transaction>();

        const processSnapshot = (snapshot: any) => {
            snapshot.docs.forEach((doc: any) => {
                const data = doc.data();
                let amounts = (data.amounts || []).map((a: any) => ({ ...a, date: a.date.toDate() }));
                if (amounts.length === 0 && data.amount && data.startDate) {
                    amounts.push({ id: 'legacy-0', amount: data.amount, date: data.startDate.toDate() });
                }
                const transaction: Transaction = { id: doc.id, ...data, amounts, endDate: data.endDate ? data.endDate.toDate() : null } as Transaction;
                
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

        const savingsList = savingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), startDate: doc.data().startDate.toDate(), targetDate: doc.data().targetDate.toDate(), contributions: (doc.data().contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() })) } as SavingGoal));
        setSavingsGoals(savingsList);

        const assetsList = assetsSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), valueHistory: (doc.data().valueHistory || []).map((v: any) => ({ ...v, date: v.date.toDate() })), contributions: (doc.data().contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() })) } as Asset));
        setAssets(assetsList);
        
        const customExpense = expCatSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        setExpenseCategories([...customExpense, ...defaultExpenseCategories.map(cat => ({...cat, id: `default-expenseCategories-${cat.name.replace(/\s+/g, '-')}`}))]);
        
        const customIncome = incCatSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        setIncomeCategories([...customIncome, ...defaultIncomeCategories.map(cat => ({...cat, id: `default-incomeCategories-${cat.name.replace(/\s+/g, '-')}`}))]);

        setLoading(false);
    }

    useEffect(() => {
        fetchData();
    }, [user]);

    useEffect(() => {
        if (!isAddDialogOpen && !isQuickEditDialogOpen) {
            setEditingTransaction(null);
            setAddTransactionType(null);
        }
    }, [isAddDialogOpen, isQuickEditDialogOpen]);
    
    useEffect(() => {
        if (isAddDialogOpen && addTransactionType) {
            addForm.reset({
                name: '', amount: 0,
                frequency: 'one-off', transactionType: addTransactionType,
                startDate: new Date(), endDate: null,
                sharing: 'personal',
                ...(addTransactionType === 'expense' && {
                    classification: 'need'
                })
            });
        }
    }, [isAddDialogOpen, addTransactionType, addForm]);

    useEffect(() => {
        if (!isAddDialogOpen || !addTransactionType) return;
        if (addTransactionType === 'income' && incomeCategories.length > 0) {
            addForm.setValue('categoryId', incomeCategories[0]?.id);
        } else if (addTransactionType === 'expense' && expenseCategories.length > 0) {
            addForm.setValue('categoryId', expenseCategories[0]?.id);
        }
    }, [addTransactionType, isAddDialogOpen, incomeCategories, expenseCategories, addForm]);

    const handleOpenAddDialog = (type: 'income' | 'expense') => {
        setAddTransactionType(type);
        setIsAddDialogOpen(true);
    };

    const handleOpenEditDialog = (transaction: Transaction) => {
        setEditingTransaction(transaction);
        const displayAmount = getAmountForDate(transaction, endOfMonth(selectedMonth));
        quickEditForm.reset({ amount: displayAmount });
        setIsQuickEditDialogOpen(true);
    };
    
    const handleUpdateThisMonthOnly = async () => {
        if (!pendingUpdate) return;
        const { transaction, values } = pendingUpdate;
        const newAmount = values.amount;
        const originalAmount = getAmountForDate(transaction, endOfMonth(selectedMonth));
    
        const newAmounts = [...transaction.amounts];
        newAmounts.push({ id: crypto.randomUUID(), amount: newAmount, date: startOfMonth(selectedMonth) });
        
        const nextMonth = addMonths(selectedMonth, 1);
        const nextMonthHasOverride = transaction.amounts.some(a => a.date >= startOfMonth(nextMonth) && a.date <= endOfMonth(nextMonth));
        if (!nextMonthHasOverride) {
            newAmounts.push({ id: crypto.randomUUID(), amount: originalAmount, date: startOfMonth(nextMonth) });
        }
    
        const payload = { amounts: newAmounts.sort((a,b) => a.date.getTime() - b.date.getTime()) };
    
        try {
            await updateDoc(doc(db, "transactions", transaction.id), payload);
            toast({ title: "Transaction Updated for This Month" });
        } catch (error) {
            toast({ variant: 'destructive', title: "Error", description: "Could not update transaction." });
        } finally {
            setIsUpdateTypeDialogOpen(false);
            setPendingUpdate(null);
            fetchData();
        }
    };
    
    const handleUpdateFuture = async () => {
        if (!pendingUpdate) return;
        const { transaction, values } = pendingUpdate;
        const newAmount = values.amount;
    
        let newAmounts = transaction.amounts.filter(a => a.date < startOfMonth(selectedMonth));
        newAmounts.push({ id: crypto.randomUUID(), amount: newAmount, date: startOfMonth(selectedMonth) });
        
        const payload = { amounts: newAmounts.sort((a,b) => a.date.getTime() - b.date.getTime()) };
    
        try {
            await updateDoc(doc(db, "transactions", transaction.id), payload);
            toast({ title: "Transaction Updated for Future" });
        } catch (error) {
            toast({ variant: 'destructive', title: "Error", description: "Could not update transaction." });
        } finally {
            setIsUpdateTypeDialogOpen(false);
            setPendingUpdate(null);
            fetchData();
        }
    };

    const onAddFormSubmit = async (values: z.infer<typeof addTransactionSchema>) => {
        if (!user) return;
        const payload: { [key: string]: any } = {
            userId: user.uid, name: values.name,
            transactionType: values.transactionType, frequency: values.frequency,
            endDate: values.frequency === 'recurring' ? values.endDate : null,
            amounts: [{ id: crypto.randomUUID(), amount: values.amount, date: values.startDate }],
            sharing: values.sharing,
        };
        if (values.transactionType === 'expense') {
            payload.classification = values.classification;
            payload.categoryId = values.categoryId;
        } else {
            payload.categoryId = values.categoryId;
        }
        try {
            await addDoc(collection(db, "transactions"), payload);
            toast({ title: "Transaction Added" });
        } catch (error) {
            toast({ variant: 'destructive', title: "Error", description: "Could not save transaction." });
        }
        setIsAddDialogOpen(false);
        fetchData();
    };
    
    const onQuickEditSubmit = async (values: z.infer<typeof quickEditSchema>) => {
        if (!user || !editingTransaction) return;
    
        const currentAmount = getAmountForDate(editingTransaction, endOfMonth(selectedMonth));
        const newAmount = values.amount;
        
        if (editingTransaction.frequency === 'recurring' && currentAmount !== newAmount) {
            setPendingUpdate({ transaction: editingTransaction, values: { amount: newAmount } });
            setIsUpdateTypeDialogOpen(true);
            setIsQuickEditDialogOpen(false);
            return;
        }
    
        if (editingTransaction.frequency === 'one-off') {
            const newAmounts = [...editingTransaction.amounts];
            if(newAmounts.length > 0) {
                newAmounts[0] = { ...newAmounts[0], amount: values.amount };
            }
            const payload = { amounts: newAmounts };
    
            try {
                await updateDoc(doc(db, "transactions", editingTransaction.id), payload);
                toast({ title: "Transaction Updated" });
            } catch (error) {
                toast({ variant: 'destructive', title: "Error", description: "Could not update transaction." });
            }
        } else {
            toast({ title: 'No Change Detected', description: 'The amount was not changed.'});
        }
    
        setIsQuickEditDialogOpen(false);
        setEditingTransaction(null);
        fetchData();
    };

    const requestSort = (type: 'income' | 'expense') => (key: SortableKey) => {
        const setSortConfig = type === 'income' ? setIncomeSortConfig : setExpenseSortConfig;
        const sortConfig = type === 'income' ? incomeSortConfig : expenseSortConfig;

        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const allCategoriesMap = useMemo(() => new Map(
      [...expenseCategories, ...incomeCategories].map(c => [c.id, c])
    ), [expenseCategories, incomeCategories]);
    
    const { monthlyIncome, monthlyExpenses, monthlySavings, netBalance, sortedIncomeTransactions, groupedExpenseTransactions, monthlyContributionsList } = useMemo(() => {
        const monthStart = startOfMonth(selectedMonth);
        const monthEnd = endOfMonth(selectedMonth);

        const isTransactionActive = (t: Transaction) => {
            if (!t.amounts || t.amounts.length === 0) return false;
            const firstAmountDate = [...t.amounts].sort((a,b) => a.date.getTime() - b.date.getTime())[0].date;

            if (t.frequency === 'one-off') {
                return isWithinInterval(firstAmountDate, { start: monthStart, end: monthEnd });
            } else { 
                const afterStart = isAfter(monthEnd, firstAmountDate) || isEqual(monthStart, startOfMonth(firstAmountDate));
                const beforeEnd = !t.endDate || isAfter(endOfMonth(t.endDate), monthStart) || isEqual(monthEnd, endOfMonth(t.endDate));
                return afterStart && beforeEnd;
            }
        };

        const activeTransactions = transactions.filter(isTransactionActive);
        
        const income = activeTransactions.filter(t => t.transactionType === 'income').reduce((sum, t) => sum + getAmountForDate(t, monthEnd), 0);
        
        const expenseTransactionsWithDisplayAmount = activeTransactions
            .filter((t): t is Expense => t.transactionType === 'expense')
            .map(t => {
                const totalAmount = getAmountForDate(t, monthEnd);
                let displayAmount = totalAmount;

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
                                 const totalIncome = household.members.reduce((s, member) => s + getIncomeForDate(member, monthEnd), 0);
                                if (totalIncome > 0) {
                                    const memberIncome = getIncomeForDate(household.members.find(m => m.id === user.uid), monthEnd);
                                    userShare = (totalAmount * memberIncome) / totalIncome;
                                } else {
                                    userShare = household.members.length > 0 ? totalAmount / household.members.length : 0;
                                }
                            } else { // Equal split
                                userShare = household.members.length > 0 ? totalAmount / household.members.length : 0;
                            }
                        }
                        displayAmount = userShare;
                    } else {
                        displayAmount = 0; // Household might be deleted, so share is 0
                    }
                }
                return {...t, displayAmount };
            });

        const expenses = expenseTransactionsWithDisplayAmount.reduce((sum, t) => sum + t.displayAmount, 0);

        let groupedExpenses: GroupedExpenseItem[] = [];
        if (expenseGrouping === 'none') {
            groupedExpenses = [{
                name: 'All Expenses',
                total: expenses,
                transactions: expenseTransactionsWithDisplayAmount.sort((a,b) => b.displayAmount - a.displayAmount)
            }];
        } else {
            const groups: Record<string, GroupedExpenseItem> = {};
            expenseTransactionsWithDisplayAmount.forEach(t => {
                let groupName = 'Uncategorized';
                let groupIcon: string | undefined;
                let groupColor: string | undefined;

                if (expenseGrouping === 'classification') {
                    groupName = t.classification === 'want' ? 'Wants' : 'Needs';
                } else if (expenseGrouping === 'category') {
                    const category = t.categoryId ? allCategoriesMap.get(t.categoryId) : undefined;
                    if(category) {
                        groupName = category.name;
                        groupIcon = category.icon;
                        groupColor = category.color;
                    }
                }

                if (!groups[groupName]) {
                    groups[groupName] = { name: groupName, total: 0, transactions: [], icon: groupIcon, color: groupColor };
                }
                groups[groupName].total += t.displayAmount;
                groups[groupName].transactions.push(t);
            });
            groupedExpenses = Object.values(groups).sort((a,b) => b.total - a.total);
            groupedExpenses.forEach(group => group.transactions.sort((a,b) => b.displayAmount - a.displayAmount));
        }

        const incomeTransactions = activeTransactions.filter((t): t is Income => t.transactionType === 'income').map(t => ({...t, displayAmount: getAmountForDate(t, monthEnd)}));

        const sortTransactions = (txs: (Transaction & { displayAmount: number, categoryName?: string })[], config: { key: SortableKey, direction: 'ascending' | 'descending' }) => {
            return [...txs].sort((a, b) => {
                const key = config.key === 'amount' ? 'displayAmount' : config.key;
                if (key === 'category') {
                    const nameA = a.categoryName || '';
                    const nameB = b.categoryName || '';
                    return config.direction === 'ascending' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
                }
                if (a[key as keyof typeof a] < b[key as keyof typeof b]) return config.direction === 'ascending' ? -1 : 1;
                if (a[key as keyof typeof a] > b[key as keyof typeof b]) return config.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        };
        
        const incomeTxsWithCategory = incomeTransactions.map(t => ({...t, categoryName: allCategoriesMap.get(t.categoryId || '')?.name || '' }));
        const expenseTxsWithCategory = expenseTransactionsWithDisplayAmount.map(t => ({...t, categoryName: allCategoriesMap.get(t.categoryId || '')?.name || 'Uncategorized'}));
        groupedExpenses.forEach(g => {
            g.transactions = g.transactions.map(t => ({...t, categoryName: allCategoriesMap.get(t.categoryId || '')?.name || 'Uncategorized'}));
        });

        const savingsGoalContributionsList = savingsGoals.flatMap(goal =>
            goal.contributions
                .filter(c => isWithinInterval(c.date, { start: monthStart, end: monthEnd }))
                .map(c => ({ id: `${goal.id}-${c.id}`, name: `To "${goal.name}"`, amount: c.amount, link: `/savings/${goal.id}` }))
        );
    
        const assetContributionsList = assets.flatMap(asset =>
            (asset.contributions || [])
                .filter(c => isWithinInterval(c.date, { start: monthStart, end: monthEnd }))
                .map(c => ({ id: `${asset.id}-${c.id}`, name: `To "${asset.name}"`, amount: c.amount, link: `/asset/${asset.id}` }))
        );
    
        const allContributions = [...savingsGoalContributionsList, ...assetContributionsList].sort((a, b) => b.amount - a.amount);
        const totalMonthlySavings = allContributions.reduce((sum, c) => sum + c.amount, 0);
            
        return { 
          monthlyIncome: income, 
          monthlyExpenses: expenses, 
          monthlySavings: totalMonthlySavings,
          netBalance: income - expenses - totalMonthlySavings,
          sortedIncomeTransactions: sortTransactions(incomeTxsWithCategory, incomeSortConfig),
          groupedExpenseTransactions: groupedExpenses,
          monthlyContributionsList: allContributions,
        };
    }, [transactions, savingsGoals, assets, selectedMonth, user?.uid, incomeSortConfig, expenseSortConfig, households, expenseGrouping, allCategoriesMap]);

    if (loading) {
        return (<><Header title="Monthly View" /><main className="flex-1 p-4 sm:p-6 text-center"><Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" /></main></>)
    }
    
    const currencyOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    
    return (
        <>
            <Header title="Monthly View" />
            <main className="flex-1 space-y-6 p-4 sm:p-6">
                <div className="max-w-7xl mx-auto w-full space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                                <div>
                                    <CardTitle>Monthly Cashflow</CardTitle>
                                    <CardDescription>Your financial summary for {format(selectedMonth, 'MMMM yyyy')}</CardDescription>
                                </div>
                                <div className="flex items-center gap-2 self-end sm:self-center">
                                    <Button variant="outline" size="icon" onClick={() => setSelectedMonth(subMonths(selectedMonth, 1))}><ChevronLeft className="h-4 w-4" /></Button>
                                    <span className="w-32 sm:w-36 text-center font-medium">{format(selectedMonth, "MMMM yyyy")}</span>
                                    <Button variant="outline" size="icon" onClick={() => setSelectedMonth(addMonths(selectedMonth, 1))}><ChevronRight className="h-4 w-4" /></Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Income</CardTitle><ArrowUpCircle className="h-4 w-4 text-chart-2" /></CardHeader><CardContent><div className="text-2xl font-bold text-chart-2">{formatCurrency(monthlyIncome, currency, currencyOptions)}</div></CardContent></Card>
                            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Expenses</CardTitle><ArrowDownCircle className="h-4 w-4 text-destructive" /></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{formatCurrency(monthlyExpenses, currency, currencyOptions)}</div></CardContent></Card>
                            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Savings &amp; Investments</CardTitle><PiggyBank className="h-4 w-4 text-chart-1" /></CardHeader><CardContent><div className="text-2xl font-bold text-chart-1">{formatCurrency(monthlySavings, currency, currencyOptions)}</div></CardContent></Card>
                            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Net Balance</CardTitle><Scale className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className={`text-2xl font-bold ${netBalance >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(netBalance, currency, currencyOptions)}</div></CardContent></Card>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                        <div className="flex flex-col gap-6">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2"><ArrowUpCircle className="h-6 w-6 text-chart-2" />Income</CardTitle>
                                    <Button size="sm" variant="outline" onClick={() => handleOpenAddDialog('income')}><PlusCircle className="mr-2 h-4 w-4" /> Quick Add</Button>
                                </CardHeader>
                                <CardContent>
                                    <BreakdownTable transactions={sortedIncomeTransactions} currency={currency} type="income" sortConfig={incomeSortConfig} requestSort={requestSort('income')} categories={allCategoriesMap} onEdit={handleOpenEditDialog} />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><PiggyBank className="h-6 w-6 text-chart-1" />Savings &amp; Investments</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <SavingsBreakdownTable contributions={monthlyContributionsList} currency={currency} />
                                </CardContent>
                            </Card>
                        </div>
                        <Card>
                            <CardHeader className="flex flex-col gap-4 sm:flex-row items-start sm:items-center justify-between">
                                <CardTitle className="flex items-center gap-2"><ArrowDownCircle className="h-6 w-6 text-destructive" />Expenses</CardTitle>
                                <div className="flex items-center gap-2 self-start sm:self-end">
                                    <Select value={expenseGrouping} onValueChange={(v) => setExpenseGrouping(v as GroupingKey)}>
                                        <SelectTrigger className="w-[180px]">
                                            <SelectValue placeholder="Group by..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">No Grouping</SelectItem>
                                            <SelectItem value="category">Category</SelectItem>
                                            <SelectItem value="classification">Needs / Wants</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Button size="sm" variant="outline" onClick={() => handleOpenAddDialog('expense')}><PlusCircle className="mr-2 h-4 w-4" /> Quick Add</Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <GroupedBreakdownTable groups={groupedExpenseTransactions} currency={currency} onEdit={handleOpenEditDialog} grouping={expenseGrouping} allCategoriesMap={allCategoriesMap} />
                            </CardContent>
                        </Card>
                    </div>
                    
                    {(transactions.length === 0 && savingsGoals.length === 0) && !loading && (
                        <Alert><Info className="h-4 w-4" /><AlertTitle>No data yet!</AlertTitle><AlertDescription><Button variant="link" asChild className="p-0 h-auto"><Link href="/transactions">Add a transaction</Link></Button> or a <Button variant="link" asChild className="p-0 h-auto"><Link href="/savings">savings goal</Link></Button> to see your monthly budget.</AlertDescription></Alert>
                    )}
                </div>
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogContent className="sm:max-w-md flex flex-col max-h-[85dvh]">
                        <DialogHeader><DialogTitle>Add Transaction</DialogTitle><DialogDescription>Enter the details for your new transaction.</DialogDescription></DialogHeader>
                        <Form {...addForm}>
                            <form onSubmit={addForm.handleSubmit(onAddFormSubmit)} className="flex flex-col flex-1 min-h-0">
                                <div className="flex-1 overflow-y-scroll overflow-x-hidden pl-2 pr-4 -mr-4 space-y-4 py-2">
                                    <FormField control={addForm.control} name="transactionType" render={({ field }) => (<FormItem><FormLabel>Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="income">Income</SelectItem><SelectItem value="expense">Expense</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
                                    
                                    <FormField
                                        control={addForm.control}
                                        name="sharing"
                                        render={({ field }) => (
                                            <FormItem>
                                            <FormLabel>Sharing</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                <SelectItem value="personal">Personal</SelectItem>
                                                {households.map((h) => (
                                                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                                                ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {transactionTypeWatcher === 'expense' && (
                                        <>
                                        <FormField control={addForm.control} name="classification" render={({ field }) => (<FormItem className="space-y-3"><FormLabel>Classification</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex items-center space-x-4"><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="need" /></FormControl><FormLabel className="font-normal">Need</FormLabel></FormItem><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="want" /></FormControl><FormLabel className="font-normal">Want</FormLabel></FormItem></RadioGroup></FormControl><FormMessage /></FormItem>)} />
                                        <FormField control={addForm.control} name="categoryId" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a category"/></SelectTrigger></FormControl><SelectContent>{expenseCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                                        </>
                                    )}
                                    {transactionTypeWatcher === 'income' && (
                                        <FormField control={addForm.control} name="categoryId" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a category"/></SelectTrigger></FormControl><SelectContent>{incomeCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                                    )}

                                    <FormField control={addForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="e.g., Salary, Rent" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={addForm.control} name="amount" render={({ field }) => (<FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={addForm.control} name="frequency" render={({ field }) => (<FormItem className="space-y-3"><FormLabel>Frequency</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex items-center space-x-4"><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="one-off" /></FormControl><FormLabel className="font-normal">One-Off</FormLabel></FormItem><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="recurring" /></FormControl><FormLabel className="font-normal">Recurring</FormLabel></FormItem></RadioGroup></FormControl><FormMessage /></FormItem>)} />
                                    
                                    <div className={`grid gap-4 ${addForm.getValues('frequency') === 'recurring' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                        <FormField control={addForm.control} name="startDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>{addForm.getValues('frequency') === 'recurring' ? 'Start Date' : 'Date'}</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                                        {addForm.getValues('frequency') === 'recurring' && (<FormField control={addForm.control} name="endDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>End Date (Optional)</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>No end date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value || undefined} onSelect={field.onChange} /></PopoverContent></Popover><FormMessage /></FormItem>)} />)}
                                    </div>
                                </div>
                                <DialogFooter className="pt-4 flex-shrink-0"><Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button><Button type="submit">Add</Button></DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>
                
                <Dialog open={isQuickEditDialogOpen} onOpenChange={setIsQuickEditDialogOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Update Amount</DialogTitle>
                            <DialogDescription>
                                Update the amount for &apos;{editingTransaction?.name}&apos;.
                            </DialogDescription>
                        </DialogHeader>
                        <Form {...quickEditForm}>
                            <form onSubmit={quickEditForm.handleSubmit(onQuickEditSubmit)} className="space-y-4 py-4">
                                <FormField
                                    control={quickEditForm.control}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Amount</FormLabel>
                                            <FormControl>
                                                <Input type="number" {...field} onFocus={(e) => e.target.select()} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsQuickEditDialogOpen(false)}>Cancel</Button>
                                    <Button type="submit">Update Amount</Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>

                <AlertDialog open={isUpdateTypeDialogOpen} onOpenChange={setIsUpdateTypeDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Update Recurring Transaction</AlertDialogTitle>
                            <AlertDialogDescription>
                                Apply this amount change to this month only, or to this month and all future months?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setPendingUpdate(null)}>Cancel</AlertDialogCancel>
                            <Button variant="outline" onClick={handleUpdateThisMonthOnly}>This Month Only</Button>
                            <AlertDialogAction asChild>
                                <Button onClick={handleUpdateFuture}>This Month & Future</Button>
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

            </main>
        </>
    );
}

export default function BudgetPage() {
    return (
        <MainLayout>
            <BudgetOverview />
        </MainLayout>
    )
}

function SavingsBreakdownTable({ contributions, currency }: { 
    contributions: { id: string; name: string; amount: number; link: string; }[], 
    currency: string
}) {
  if (contributions.length === 0) {
    return <div className="text-center text-muted-foreground py-12">No savings or investment contributions this month.</div>
  }
  
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Destination</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contributions.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">
                <Link href={c.link} className="group flex items-center gap-3">
                  <span className="group-hover:underline truncate">{c.name}</span>
                </Link>
            </TableCell>
            <TableCell className="text-right font-mono text-chart-1">{formatCurrency(c.amount, currency)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function BreakdownTable({ transactions, currency, type, sortConfig, requestSort, categories, onEdit }: { 
    transactions: (Transaction & { displayAmount: number, categoryName?: string })[], 
    currency: string, 
    type: 'income' | 'expense', 
    sortConfig: { key: SortableKey, direction: 'ascending' | 'descending' },
    requestSort: (key: SortableKey) => void,
    categories?: Map<string, Category>,
    onEdit: (transaction: Transaction) => void,
}) {
  if (transactions.length === 0) {
    return <div className="text-center text-muted-foreground py-12">No {type} recorded for this month.</div>
  }
  
  const colorClass = type === 'income' ? 'text-chart-2' : 'text-destructive';

  const SortableHeader = ({ title, sortKey, className }: { title: string, sortKey: SortableKey, className?: string }) => (
    <TableHead className={cn('p-0', className)}>
        <Button variant="ghost" onClick={() => requestSort(sortKey)} className={cn("w-full h-auto py-3 px-4 font-medium", className?.includes('text-right') ? 'justify-end' : 'justify-start')}>
            {title}
            {sortConfig.key === sortKey && (
                sortConfig.direction === 'ascending' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />
            )}
        </Button>
    </TableHead>
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader title="Name" sortKey="name" />
          <SortableHeader title="Category" sortKey="category" />
           {type === 'expense' && <TableHead>Type</TableHead>}
          <SortableHeader title="Amount" sortKey="amount" className="text-right" />
          <TableHead className="text-right w-[80px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((t) => {
          const category = (t.categoryId && categories) ? categories.get(t.categoryId) : null;
          return (
            <TableRow key={t.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-3">
                    {category ? (
                        <DynamicIcon name={category.icon} style={{ color: category.color }} className="h-5 w-5 shrink-0" />
                    ) : (
                        <div className="w-5 shrink-0" />
                    )}
                    <Link href={`/transaction/${t.id}`} className="group hover:underline truncate">{t.name}</Link>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {category?.name || 'Uncategorized'}
              </TableCell>
              {t.transactionType === 'expense' && (
                  <TableCell>
                      {t.classification && (
                           <Badge variant="outline" className="w-fit text-xs">
                              {t.classification.charAt(0).toUpperCase() + t.classification.slice(1)}
                          </Badge>
                      )}
                  </TableCell>
              )}
              <TableCell className={`text-right font-mono ${colorClass}`}>{formatCurrency(t.displayAmount, currency)}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" onClick={() => onEdit(t)}>
                    <Edit className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function GroupedBreakdownTable({ groups, currency, onEdit, grouping, allCategoriesMap }: {
    groups: GroupedExpenseItem[],
    currency: string,
    onEdit: (transaction: Transaction) => void,
    grouping: GroupingKey,
    allCategoriesMap: Map<string, Category>
}) {
    if (groups.length === 0) {
        return <div className="text-center text-muted-foreground py-12">No expenses recorded for this month.</div>;
    }

    if (grouping === 'none' && groups[0]) {
        return <BreakdownTable transactions={groups[0].transactions} currency={currency} type="expense" sortConfig={{key: 'amount', direction: 'descending'}} requestSort={() => {}} onEdit={onEdit} categories={allCategoriesMap} />
    }

    return (
        <Accordion type="multiple" className="w-full space-y-2">
            {groups.map((group) => (
                <AccordionItem key={group.name} value={group.name} className="border-b-0">
                    <Card className="overflow-hidden">
                        <AccordionTrigger className="p-4 hover:no-underline hover:bg-muted/50">
                            <div className="flex-1 flex items-center gap-3 font-medium text-left">
                                {group.icon && group.color && <DynamicIcon name={group.icon} style={{ color: group.color }} className="h-5 w-5 shrink-0" />}
                                <span className={cn("truncate", group.color && "font-semibold")} style={{ color: group.color }}>{group.name}</span>
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                                <span className="font-mono text-destructive">{formatCurrency(group.total, currency)}</span>
                                <ChevronsUpDown className="h-4 w-4 shrink-0 transition-transform duration-200 text-muted-foreground" />
                            </div>
                        </AccordionTrigger>
                        <AccordionContent>
                            <Table>
                                 <TableHeader>
                                    <TableRow>
                                        <TableHead className="pl-6">Name</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-right w-[50px] pr-2">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {group.transactions.map((t) => (
                                        <TableRow key={t.id}>
                                            <TableCell className="pl-6 font-medium">
                                                <Link href={`/transaction/${t.id}`} className="hover:underline truncate">{t.name}</Link>
                                            </TableCell>
                                            <TableCell>
                                                {t.classification && (
                                                    <Badge variant="outline" className="text-xs">
                                                        {t.classification.charAt(0).toUpperCase() + t.classification.slice(1)}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-destructive pr-4">{formatCurrency(t.displayAmount, currency)}</TableCell>
                                            <TableCell className="text-right pr-2">
                                                <Button variant="ghost" size="icon" onClick={() => onEdit(t)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </AccordionContent>
                    </Card>
                </AccordionItem>
            ))}
        </Accordion>
    )
}
