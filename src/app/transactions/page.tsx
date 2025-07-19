
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, isAfter } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, PlusCircle, Trash2, Repeat, Repeat1, Loader2, ArrowUp, ArrowDown, XCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, deleteDoc, query, where } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import DynamicIcon from '@/components/dynamic-icon';
import { defaultExpenseCategories, defaultIncomeCategories } from '@/lib/categories';

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
  sharing: string; // 'personal' or householdId
};

type Expense = BaseTransaction & {
  transactionType: 'expense';
  sharing: string; // 'personal' or householdId
  classification?: 'need' | 'want';
  categoryId?: string;
};

type Transaction = Income | Expense;

type Category = {
    id: string;
    userId?: string;
    name: string;
    icon: string;
    color: string;
};

type Member = { id: string; name: string; email: string; income?: number; };
type Household = { id: string; ownerId: string; name: string; members: Member[]; memberIds: string[]; splitType?: 'equal' | 'shares' | 'income_ratio'; splits?: { memberId: string, share: number }[]; };


const transactionSchema = z.object({
  id: z.string().optional(),
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

type SortableKey = 'name' | 'amount';
type TransactionWithDisplayAmount = Transaction & { displayAmount: number };

function FilterControls({
  nameFilter,
  onNameChange,
  frequencyFilter,
  onFrequencyChange,
  categoryFilter,
  onCategoryChange,
  sharingFilter,
  onSharingChange,
  statusFilter,
  onStatusChange,
  categories,
  households,
  onClearName,
}: {
  nameFilter: string;
  onNameChange: (value: string) => void;
  frequencyFilter: string;
  onFrequencyChange: (value: string) => void;
  categoryFilter: string;
  onCategoryChange: (value: string) => void;
  sharingFilter: string;
  onSharingChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  categories: Category[];
  households: Household[];
  onClearName: () => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-4 py-4 px-1">
      <div className="space-y-2">
        <Label htmlFor="name-filter">Name</Label>
        <div className="relative">
          <Input
            id="name-filter"
            placeholder="Filter by name..."
            value={nameFilter}
            onChange={(e) => onNameChange(e.target.value)}
          />
          {nameFilter && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={onClearName}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="frequency-filter">Frequency</Label>
        <Select value={frequencyFilter} onValueChange={onFrequencyChange}>
          <SelectTrigger id="frequency-filter">
            <SelectValue placeholder="Filter by frequency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Frequencies</SelectItem>
            <SelectItem value="recurring">Recurring</SelectItem>
            <SelectItem value="one-off">One-Off</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="category-filter">Category</Label>
        <Select value={categoryFilter} onValueChange={onCategoryChange}>
          <SelectTrigger id="category-filter">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
       <div className="space-y-2">
        <Label htmlFor="sharing-filter">Sharing</Label>
        <Select value={sharingFilter} onValueChange={onSharingChange}>
          <SelectTrigger id="sharing-filter">
            <SelectValue placeholder="Filter by sharing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sharing Types</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            {households.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                    {h.name}
                </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="status-filter">Status</Label>
        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger id="status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}


function TransactionTable({ transactions, onDelete, loading, currency, categories, households, currentUserId, sortConfig, requestSort }: { 
    transactions: TransactionWithDisplayAmount[], 
    onDelete: (t: Transaction) => void, 
    loading: boolean, 
    currency: string, 
    categories: Map<string, {name: string, icon: string, color: string}>,
    households: Map<string, {name: string}>,
    currentUserId: string,
    sortConfig: { key: SortableKey, direction: 'ascending' | 'descending' },
    requestSort: (key: SortableKey) => void
}) {
    const router = useRouter();

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

    if (loading) {
         return <div className="flex justify-center items-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
    }
    if (transactions.length === 0) {
        return <div className="text-center text-muted-foreground py-12">No transactions match your filters.</div>
    }

    const getStartDate = (t: Transaction) => {
        if (!t.amounts || t.amounts.length === 0) return new Date();
        const sorted = [...t.amounts].sort((a,b) => a.date.getTime() - b.date.getTime());
        return sorted[0].date;
    }
    
    return (
        <>
            {/* Mobile View */}
            <div className="space-y-4 md:hidden">
                {transactions.map(t => {
                    const category = t.categoryId ? categories.get(t.categoryId) : null;
                    const householdName = t.sharing !== 'personal' ? households.get(t.sharing)?.name : null;
                    return (
                        <Card key={t.id} onClick={() => router.push(`/transaction/${t.id}`)} className="p-4">
                            <div className="flex justify-between items-start">
                                <p className="font-medium pr-2">{t.name}</p>
                                <p className={`font-mono font-medium shrink-0 ${t.transactionType === 'income' ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(t.displayAmount, currency)}</p>
                            </div>
                            <div className="mt-2 flex justify-between items-end">
                                <div className="space-y-2 text-sm text-muted-foreground">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">{t.frequency === 'one-off' ? 'One-Off' : 'Recurring'}</Badge>
                                        <Badge variant="secondary">{householdName ? `Shared: ${householdName}` : 'Personal'}</Badge>
                                    </div>
                                    {category && (
                                        <Badge variant="outline" className="flex items-center gap-1.5 text-xs" style={{ borderColor: category.color, color: category.color }}>
                                            <DynamicIcon name={category.icon} className="h-3 w-3" />
                                            <span>{category.name}</span>
                                        </Badge>
                                    )}
                                </div>
                                {t.userId === currentUserId && (
                                    <Button variant="ghost" size="icon" className="-mr-2 -mb-2" onClick={(e) => { e.stopPropagation(); onDelete(t); }}><Trash2 className="h-4 w-4" /></Button>
                                )}
                            </div>
                        </Card>
                    )
                })}
            </div>
            {/* Desktop View */}
            <Table className="hidden md:table">
                <TableHeader>
                    <TableRow>
                        <SortableHeader title="Name" sortKey="name" />
                        <TableHead>Details</TableHead>
                        <TableHead>Sharing</TableHead>
                        <SortableHeader title="Amount" sortKey="amount" className="text-right" />
                        <TableHead className="text-right w-[100px]">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {transactions.map((t) => {
                        const category = t.categoryId ? categories.get(t.categoryId) : null;
                        const householdName = t.sharing !== 'personal' ? households.get(t.sharing)?.name : null;
                        return (
                            <TableRow key={t.id} className="cursor-pointer" onClick={() => router.push(`/transaction/${t.id}`)}>
                                <TableCell className="font-medium">{t.name}</TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1.5 items-start">
                                        <div className="flex items-center gap-2">
                                            {t.frequency === 'recurring' ? <Repeat className="h-4 w-4 text-muted-foreground" /> : <Repeat1 className="h-4 w-4 text-muted-foreground" />}
                                            <span className="text-sm">{t.frequency === 'one-off' ? 'One-Off' : 'Recurring'}</span>
                                        </div>
                                        {category && (
                                            <Badge variant="outline" className="flex items-center gap-1.5 text-xs" style={{ borderColor: category.color, color: category.color }}>
                                                <DynamicIcon name={category.icon} className="h-3 w-3" />
                                                <span>{category.name}</span>
                                            </Badge>
                                        )}
                                        <div className="text-xs text-muted-foreground">
                                            {t.frequency === 'one-off' ? `On: ${format(getStartDate(t), 'PP')}` : `Starts: ${format(getStartDate(t), 'PP')}${t.endDate ? `, Ends: ${format(t.endDate, 'PP')}` : ''}`}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="secondary">{householdName ? `Shared: ${householdName}` : 'Personal'}</Badge>
                                </TableCell>
                                <TableCell className={`text-right font-mono ${t.transactionType === 'income' ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(t.displayAmount, currency)}</TableCell>
                                <TableCell className="text-right">
                                    {t.userId === currentUserId && (
                                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(t); }}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        )
                    })}
                </TableBody>
            </Table>
        </>
    )
}

function Transactions() {
    const user = useAuth();
    const { currency } = useCurrency();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
    const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
    const [households, setHouseholds] = useState<Household[]>([]);
    const [loading, setLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
    const { toast } = useToast();
    
    const [incomeSortConfig, setIncomeSortConfig] = useState<{ key: SortableKey, direction: 'ascending' | 'descending' }>({ key: 'amount', direction: 'descending' });
    const [expenseSortConfig, setExpenseSortConfig] = useState<{ key: SortableKey, direction: 'ascending' | 'descending' }>({ key: 'amount', direction: 'descending' });
    
    const [incomeNameFilter, setIncomeNameFilter] = useState('');
    const [incomeCategoryFilter, setIncomeCategoryFilter] = useState('all');
    const [incomeFrequencyFilter, setIncomeFrequencyFilter] = useState('all');
    const [incomeSharingFilter, setIncomeSharingFilter] = useState('all');
    const [incomeStatusFilter, setIncomeStatusFilter] = useState('active');

    const [expenseNameFilter, setExpenseNameFilter] = useState('');
    const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('all');
    const [expenseFrequencyFilter, setExpenseFrequencyFilter] = useState('all');
    const [expenseSharingFilter, setExpenseSharingFilter] = useState('all');
    const [expenseStatusFilter, setExpenseStatusFilter] = useState('active');

    const form = useForm<z.infer<typeof transactionSchema>>({
        resolver: zodResolver(transactionSchema),
        defaultValues: { frequency: 'one-off', transactionType: 'expense', name: '', amount: 0, sharing: 'personal', classification: 'need' },
    });
    
    const transactionTypeWatcher = form.watch('transactionType');
    
    async function fetchData() {
        if(!user) return;
        setLoading(true);

        const householdQuery = query(collection(db, "households"), where("memberIds", "array-contains", user.uid));
        const householdSnap = await getDocs(householdQuery);
        const householdsData = householdSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as Omit<Household, 'id'>) }));
        setHouseholds(householdsData);
        const householdIds = householdsData.map(h => h.id);

        const userTransactionsQuery = query(collection(db, 'transactions'), where('userId', '==', user.uid));
        const sharedTransactionsQuery = householdIds.length > 0 
            ? query(collection(db, 'transactions'), where('sharing', 'in', householdIds))
            : null;

        const queries = [
            getDocs(query(collection(db, 'expenseCategories'), where('userId', '==', user.uid))),
            getDocs(query(collection(db, 'incomeCategories'), where('userId', '==', user.uid))),
            getDocs(userTransactionsQuery),
        ];

        if (sharedTransactionsQuery) {
            queries.push(getDocs(sharedTransactionsQuery));
        }
        
        const [expenseCategoriesSnapshot, incomeCategoriesSnapshot, userTxSnap, sharedTxSnap] = await Promise.all(queries);

        const customExpense = expenseCategoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        const mappedDefaultExpense = defaultExpenseCategories.map(cat => ({...cat, id: `default-expenseCategories-${cat.name.replace(/\s+/g, '-')}`}));
        const expenseCategoriesList = [...mappedDefaultExpense, ...customExpense].sort((a,b) => a.name.localeCompare(b.name));
        setExpenseCategories(expenseCategoriesList);
        
        const customIncome = incomeCategoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        const mappedDefaultIncome = defaultIncomeCategories.map(cat => ({...cat, id: `default-incomeCategories-${cat.name.replace(/\s+/g, '-')}`}));
        const incomeCategoriesList = [...mappedDefaultIncome, ...customIncome].sort((a,b) => a.name.localeCompare(b.name));
        setIncomeCategories(incomeCategoriesList);
        
        const allTransactions = new Map<string, Transaction>();
        const processSnapshot = (snapshot: any) => {
            snapshot.docs.forEach((doc: any) => {
                const data = doc.data();
                let amounts = (data.amounts || []).map((a: any) => ({ ...a, date: a.date.toDate() }));
                if (amounts.length === 0 && data.amount && data.startDate) {
                    amounts.push({ id: 'legacy-0', amount: data.amount, date: data.startDate.toDate() });
                }
                const transaction: Transaction = { id: doc.id, ...data, amounts, endDate: data.endDate ? data.endDate.toDate() : null } as Transaction;
                allTransactions.set(doc.id, transaction);
            });
        };

        processSnapshot(userTxSnap);
        if (sharedTxSnap) {
            processSnapshot(sharedTxSnap);
        }
        setTransactions(Array.from(allTransactions.values()));

        setLoading(false);
    }
    
    useEffect(() => {
        fetchData();
    }, [user]);

    useEffect(() => {
        if (isDialogOpen) {
            form.reset({
                name: '', amount: 0,
                frequency: 'one-off', transactionType: 'expense',
                startDate: new Date(), endDate: null, sharing: 'personal',
                classification: 'need',
                categoryId: expenseCategories[0]?.id || ''
            });
        }
    }, [isDialogOpen, form, expenseCategories]);
    
    useEffect(() => {
        if (transactionTypeWatcher === 'income') {
            form.setValue('categoryId', incomeCategories[0]?.id || '');
        } else {
            form.setValue('categoryId', expenseCategories[0]?.id || '');
        }
    }, [transactionTypeWatcher, form, incomeCategories, expenseCategories]);

    const requestSort = (type: 'income' | 'expense') => (key: SortableKey) => {
        const setSortConfig = type === 'income' ? setIncomeSortConfig : setExpenseSortConfig;
        const sortConfig = type === 'income' ? incomeSortConfig : expenseSortConfig;

        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const { sortedIncomeTransactions, sortedExpenseTransactions } = useMemo(() => {
        const getDisplayAmount = (t: Transaction) => {
            const latestAmount = (t.amounts && t.amounts.length > 0) ? [...t.amounts].sort((a,b) => b.date.getTime() - a.date.getTime())[0].amount : 0;
            return latestAmount;
        };
        
        const sortTransactions = (txs: TransactionWithDisplayAmount[], config: { key: SortableKey, direction: 'ascending' | 'descending' }) => {
            return [...txs].sort((a, b) => {
                const key = config.key === 'amount' ? 'displayAmount' : 'name';
                if (a[key] < b[key]) {
                    return config.direction === 'ascending' ? -1 : 1;
                }
                if (a[key] > b[key]) {
                    return config.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        };
        
        const incomeTxs = transactions
            .filter(t => t.transactionType === 'income')
            .filter(t => {
                if (incomeStatusFilter === 'all') return true;
                const isInactive = t.frequency === 'recurring' && t.endDate && isAfter(new Date(), t.endDate);
                if (incomeStatusFilter === 'active') return !isInactive;
                if (incomeStatusFilter === 'inactive') return isInactive;
                return true;
            })
            .filter(t => incomeNameFilter ? t.name.toLowerCase().includes(incomeNameFilter.toLowerCase()) : true)
            .filter(t => incomeFrequencyFilter !== 'all' ? t.frequency === incomeFrequencyFilter : true)
            .filter(t => incomeCategoryFilter !== 'all' ? t.categoryId === incomeCategoryFilter : true)
            .filter(t => incomeSharingFilter !== 'all' ? t.sharing === incomeSharingFilter : true)
            .map(t => ({...t, displayAmount: getDisplayAmount(t)}));

        const expenseTxs = transactions
            .filter(t => t.transactionType === 'expense')
            .filter(t => {
                if (expenseStatusFilter === 'all') return true;
                const isInactive = t.frequency === 'recurring' && t.endDate && isAfter(new Date(), t.endDate);
                if (expenseStatusFilter === 'active') return !isInactive;
                if (expenseStatusFilter === 'inactive') return isInactive;
                return true;
            })
            .filter(t => expenseNameFilter ? t.name.toLowerCase().includes(expenseNameFilter.toLowerCase()) : true)
            .filter(t => expenseFrequencyFilter !== 'all' ? t.frequency === expenseFrequencyFilter : true)
            .filter(t => expenseCategoryFilter !== 'all' ? t.categoryId === expenseCategoryFilter : true)
            .filter(t => expenseSharingFilter !== 'all' ? t.sharing === expenseSharingFilter : true)
            .map(t => ({...t, displayAmount: getDisplayAmount(t)}));

        return {
            sortedIncomeTransactions: sortTransactions(incomeTxs, incomeSortConfig),
            sortedExpenseTransactions: sortTransactions(expenseTxs, expenseSortConfig)
        };
    }, [transactions, incomeSortConfig, expenseSortConfig, incomeNameFilter, incomeCategoryFilter, incomeFrequencyFilter, incomeSharingFilter, incomeStatusFilter, expenseNameFilter, expenseCategoryFilter, expenseFrequencyFilter, expenseSharingFilter, expenseStatusFilter]);


    const handleFormSubmit = async (values: z.infer<typeof transactionSchema>) => {
        if (!user) return;
        
        const payload: { [key: string]: any } = {
            userId: user.uid,
            name: values.name,
            transactionType: values.transactionType,
            frequency: values.frequency,
            sharing: values.sharing,
            endDate: values.frequency === 'recurring' ? values.endDate : null,
            amounts: [{ id: crypto.randomUUID(), amount: values.amount, date: values.startDate }],
        };

        if (values.transactionType === 'expense') {
            payload.classification = values.classification;
            payload.categoryId = values.categoryId;
        } else { // income
            payload.categoryId = values.categoryId;
        }

        try {
            await addDoc(collection(db, "transactions"), payload);
            toast({ title: "Transaction Added" });
            setIsDialogOpen(false);
            fetchData();
        } catch(error) {
            console.error("Error saving transaction: ", error);
            toast({ variant: 'destructive', title: "Error", description: "Could not save transaction." });
        }
    };

    const handleDeleteTransaction = async () => {
        if (!transactionToDelete) return;
        try {
            await deleteDoc(doc(db, "transactions", transactionToDelete.id));
            toast({ title: "Transaction Deleted" });
            setTransactionToDelete(null);
            fetchData();
        } catch (error) {
             console.error("Error deleting transaction: ", error);
            toast({ variant: 'destructive', title: "Error", description: "Could not delete transaction." });
        }
    };

    const allCategoriesMap = new Map([...expenseCategories, ...incomeCategories].map(c => [c.id, {name: c.name, icon: c.icon, color: c.color}]));
    const householdMap = new Map(households.map(h => [h.id, {name: h.name}]));

    return (
        <>
            <Header title="All Transactions" />
            <main className="flex-1 space-y-6 p-4 sm:p-6">
                <div className="max-w-7xl mx-auto w-full">
                    <Card>
                        <CardHeader>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div>
                                    <CardTitle>Transaction Records</CardTitle>
                                    <CardDescription>A complete list of all your income and expense records. Click a transaction to view its history.</CardDescription>
                                </div>
                                <Button id="tour-step-3-add-transaction-button" onClick={() => setIsDialogOpen(true)} className="w-full sm:w-auto">
                                    <PlusCircle /> Add Transaction
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Tabs defaultValue="expenses">
                                <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="income">Income</TabsTrigger><TabsTrigger value="expenses">Expenses</TabsTrigger></TabsList>
                                <TabsContent value="income">
                                    <FilterControls
                                        nameFilter={incomeNameFilter}
                                        onNameChange={setIncomeNameFilter}
                                        frequencyFilter={incomeFrequencyFilter}
                                        onFrequencyChange={setIncomeFrequencyFilter}
                                        categoryFilter={incomeCategoryFilter}
                                        onCategoryChange={setIncomeCategoryFilter}
                                        sharingFilter={incomeSharingFilter}
                                        onSharingChange={setIncomeSharingFilter}
                                        statusFilter={incomeStatusFilter}
                                        onStatusChange={setIncomeStatusFilter}
                                        categories={incomeCategories}
                                        households={households}
                                        onClearName={() => setIncomeNameFilter('')}
                                    />
                                    <TransactionTable 
                                        transactions={sortedIncomeTransactions} 
                                        onDelete={setTransactionToDelete} 
                                        loading={loading} 
                                        currency={currency} 
                                        categories={allCategoriesMap}
                                        households={householdMap}
                                        currentUserId={user.uid}
                                        sortConfig={incomeSortConfig}
                                        requestSort={requestSort('income')}
                                    />
                                </TabsContent>
                                <TabsContent value="expenses">
                                    <FilterControls
                                        nameFilter={expenseNameFilter}
                                        onNameChange={setExpenseNameFilter}
                                        frequencyFilter={expenseFrequencyFilter}
                                        onFrequencyChange={setExpenseFrequencyFilter}
                                        categoryFilter={expenseCategoryFilter}
                                        onCategoryChange={setExpenseCategoryFilter}
                                        sharingFilter={expenseSharingFilter}
                                        onSharingChange={setExpenseSharingFilter}
                                        statusFilter={expenseStatusFilter}
                                        onStatusChange={setExpenseStatusFilter}
                                        categories={expenseCategories}
                                        households={households}
                                        onClearName={() => setExpenseNameFilter('')}
                                    />
                                    <TransactionTable 
                                        transactions={sortedExpenseTransactions} 
                                        onDelete={setTransactionToDelete} 
                                        loading={loading} 
                                        currency={currency} 
                                        categories={allCategoriesMap}
                                        households={householdMap}
                                        currentUserId={user.uid}
                                        sortConfig={expenseSortConfig}
                                        requestSort={requestSort('expense')}
                                    />
                                </TabsContent>
                            </Tabs>
                        </CardContent>
                    </Card>
                </div>
            </main>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-md flex flex-col max-h-[85dvh]">
                    <DialogHeader><DialogTitle>Add Transaction</DialogTitle><DialogDescription>Enter the details for your new transaction.</DialogDescription></DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleFormSubmit)} className="flex flex-col flex-1 min-h-0">
                            <div className="flex-1 overflow-y-scroll overflow-x-hidden pl-2 pr-4 -mr-4 space-y-4 py-2">
                                <FormField control={form.control} name="transactionType" render={({ field }) => (<FormItem><FormLabel>Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="income">Income</SelectItem><SelectItem value="expense">Expense</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
                                
                                <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="e.g., Salary, Rent" {...field} /></FormControl><FormMessage /></FormItem>)} />

                                <FormField control={form.control} name="amount" render={({ field }) => (<FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>)} />

                                <FormField
                                    control={form.control}
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

                                {transactionTypeWatcher === 'expense' ? (
                                    <>
                                    <FormField control={form.control} name="classification" render={({ field }) => (<FormItem className="space-y-3"><FormLabel>Classification</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex items-center space-x-4"><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="need" /></FormControl><FormLabel className="font-normal">Need</FormLabel></FormItem><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="want" /></FormControl><FormLabel className="font-normal">Want</FormLabel></FormItem></RadioGroup></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={form.control} name="categoryId" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a category"/></SelectTrigger></FormControl><SelectContent>{expenseCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                                    </>
                                ) : (
                                    <FormField control={form.control} name="categoryId" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a category"/></SelectTrigger></FormControl><SelectContent>{incomeCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                                )}
                                
                                <FormField control={form.control} name="frequency" render={({ field }) => (<FormItem className="space-y-3"><FormLabel>Frequency</FormLabel><FormControl>
                                    <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex items-center space-x-4">
                                        <FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="one-off" /></FormControl><FormLabel className="font-normal">One-Off</FormLabel></FormItem>
                                        <FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="recurring" /></FormControl><FormLabel className="font-normal">Recurring</FormLabel></FormItem>
                                    </RadioGroup>
                                </FormControl><FormMessage /></FormItem>)} />
                                
                                <div className={`grid gap-4 ${form.getValues('frequency') === 'recurring' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                    <FormField control={form.control} name="startDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>{form.getValues('frequency') === 'recurring' ? 'Start Date' : 'Date'}</FormLabel><Popover><PopoverTrigger asChild><FormControl>
                                        <Button variant={"outline"} className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button>
                                    </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                                    {form.getValues('frequency') === 'recurring' && (
                                        <FormField control={form.control} name="endDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>End Date (Optional)</FormLabel><Popover><PopoverTrigger asChild><FormControl>
                                            <Button variant={"outline"} className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>No end date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button>
                                        </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value || undefined} onSelect={field.onChange} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                                    )}
                                </div>
                            </div>
                            <DialogFooter className="pt-4 flex-shrink-0">
                                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                                <Button type="submit">Add Transaction</Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
            
            <AlertDialog open={!!transactionToDelete} onOpenChange={(open) => !open && setTransactionToDelete(null)}>
                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the transaction "{transactionToDelete?.name}".</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter className="gap-2 sm:gap-0"><AlertDialogCancel onClick={() => setTransactionToDelete(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteTransaction}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export default function TransactionsPage() {
    return (
        <MainLayout>
            <Transactions />
        </MainLayout>
    )
}
