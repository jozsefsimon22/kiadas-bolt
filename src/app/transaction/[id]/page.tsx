
'use client';

import { useParams, useRouter } from 'next/navigation';
import React, { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, isAfter } from "date-fns";
import { cn } from "@/lib/utils";
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ArrowDownCircle, ArrowUpCircle, CalendarIcon, Edit, Loader2, PlusCircle, Repeat, Repeat1, Trash2, Badge as BadgeIcon, ChevronLeft, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as ShadcnCalendar } from '@/components/ui/calendar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import DynamicIcon from '@/components/dynamic-icon';
import { Badge } from '@/components/ui/badge';
import { defaultExpenseCategories, defaultIncomeCategories } from '@/lib/categories';
import { ScrollArea } from '@/components/ui/scroll-area';


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

type Category = {
    id: string;
    userId?: string;
    name: string;
    icon: string;
    color: string;
}

type Member = { id: string; name: string; email: string; };
type Household = {
  id: string;
  ownerId: string;
  name: string;
  members: Member[];
};


const amountChangeSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive.'),
  date: z.date({ required_error: 'An effective date is required.' }),
});

const transactionSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  transactionType: z.enum(['income', 'expense']),
  frequency: z.enum(['one-off', 'recurring']),
  sharing: z.string(),
  classification: z.enum(['need', 'want']).optional(),
  categoryId: z.string().optional(),
  endDate: z.date().nullable().optional(),
})
.refine(data => data.transactionType !== 'expense' || !!data.classification, {
    message: 'Need/Want classification is required for expenses.',
    path: ['classification'],
});

const getAmountForDate = (transaction: Transaction, targetDate: Date): number => {
    if (!transaction.amounts || transaction.amounts.length === 0) return 0;
    const sortedAmounts = [...transaction.amounts].sort((a, b) => b.date.getTime() - a.date.getTime());
    const activeAmount = sortedAmounts.find(a => a.date <= targetDate);
    return activeAmount ? activeAmount.amount : 0;
};

const transactionIcons = {
  income: <ArrowUpCircle className="h-8 w-8 text-green-400" />,
  expense: <ArrowDownCircle className="h-8 w-8 text-red-400" />,
};

const formatDate = (date: Date) => {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

const chartConfig = {
  amount: {
    label: "Amount",
    color: "hsl(var(--chart-1))",
  },
};

function TransactionDetail() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const transactionId = params.id as string;
  const { toast } = useToast();
  const { currency } = useCurrency();
  
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);

  const [isTxDialogOpen, setIsTxDialogOpen] = useState(false);
  const [isAmountDialogOpen, setIsAmountDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isConfirmChangeToOneOffOpen, setIsConfirmChangeToOneOffOpen] = useState(false);
  
  const [editingAmount, setEditingAmount] = useState<AmountChange | null>(null);
  const [amountToDelete, setAmountToDelete] = useState<AmountChange | null>(null);
  const [pendingTransactionUpdate, setPendingTransactionUpdate] = useState<z.infer<typeof transactionSchema> | null>(null);

  const amountForm = useForm<z.infer<typeof amountChangeSchema>>({
    resolver: zodResolver(amountChangeSchema),
  });

  const transactionForm = useForm<z.infer<typeof transactionSchema>>({
    resolver: zodResolver(transactionSchema),
  });

  async function fetchTransactionData() {
    if (!transactionId || !user) return;
    setLoading(true);
    
    const expenseCategoriesQuery = query(collection(db, 'expenseCategories'), where('userId', '==', user.uid));
    const incomeCategoriesQuery = query(collection(db, 'incomeCategories'), where('userId', '==', user.uid));
    const householdQuery = query(collection(db, 'households'), where('memberIds', 'array-contains', user.uid));

    const [expenseCategoriesSnapshot, incomeCategoriesSnapshot, householdSnapshot] = await Promise.all([
        getDocs(expenseCategoriesQuery),
        getDocs(incomeCategoriesQuery),
        getDocs(householdQuery)
    ]);
    const customExpense = expenseCategoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
    const mappedDefaultExpense = defaultExpenseCategories.map(cat => ({...cat, id: `default-expenseCategories-${cat.name.replace(/\s+/g, '-')}`}));
    const expenseCategoriesList = [...mappedDefaultExpense, ...customExpense].sort((a,b) => a.name.localeCompare(b.name));
    setExpenseCategories(expenseCategoriesList);
    
    const customIncome = incomeCategoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
    const mappedDefaultIncome = defaultIncomeCategories.map(cat => ({...cat, id: `default-incomeCategories-${cat.name.replace(/\s+/g, '-')}`}));
    const incomeCategoriesList = [...mappedDefaultIncome, ...customIncome].sort((a,b) => a.name.localeCompare(b.name));
    setIncomeCategories(incomeCategoriesList);
    
    const householdsData = householdSnapshot.docs.map(doc => ({
      id: doc.id,
      ...(doc.data() as Omit<Household, 'id'>)
    }));
    setHouseholds(householdsData);

    const transactionRef = doc(db, 'transactions', transactionId);
    const transactionSnap = await getDoc(transactionRef);

    if (transactionSnap.exists()) {
        const data = transactionSnap.data();
        const isOwner = data.userId === user.uid;
        const userHouseholdIds = householdsData.map(h => h.id);
        const isSharedWithUser = data.sharing !== 'personal' && userHouseholdIds.includes(data.sharing);

        if (!isOwner && !isSharedWithUser) {
            toast({ variant: 'destructive', title: 'Access Denied'});
            router.push('/transactions');
            return;
        }

        let amounts = (data.amounts || []).map((a: any) => ({ ...a, date: a.date.toDate() }));
        if (amounts.length === 0 && data.amount && data.startDate) {
            amounts.push({ id: 'legacy-0', amount: data.amount, date: data.startDate.toDate() });
        }
        setTransaction({
            id: transactionSnap.id,
            ...data,
            amounts,
            endDate: data.endDate ? data.endDate.toDate() : null
        } as Transaction);
    } else {
        toast({ variant: 'destructive', title: 'Not Found' });
        setTransaction(null);
    }
    setLoading(false);
  }
  
  useEffect(() => {
    fetchTransactionData();
  }, [transactionId, user]);
  
  useEffect(() => {
    if (transaction && isTxDialogOpen) {
      transactionForm.reset(transaction);
    }
  }, [transaction, isTxDialogOpen, transactionForm]);

  useEffect(() => {
    if (isAmountDialogOpen) {
      if (editingAmount) {
        amountForm.reset(editingAmount);
      } else {
        amountForm.reset({ amount: 0, date: new Date() });
      }
    }
  }, [editingAmount, isAmountDialogOpen, amountForm]);

  const handleAmountSubmit = async (values: z.infer<typeof amountChangeSchema>) => {
    if (!transaction) return;
    let updatedAmounts;
    if (editingAmount) {
      updatedAmounts = transaction.amounts.map(a => 
        a.id === editingAmount.id ? { ...a, ...values } : a
      );
    } else {
      const newAmount = { ...values, id: crypto.randomUUID() };
      updatedAmounts = [...transaction.amounts, newAmount];
    }
    updatedAmounts.sort((a,b) => a.date.getTime() - b.date.getTime());
    
    try {
        const transactionRef = doc(db, "transactions", transaction.id);
        await updateDoc(transactionRef, { amounts: updatedAmounts });
        toast({ title: editingAmount ? "Amount Updated" : "Amount Added" });
        fetchTransactionData();
    } catch(error) {
        console.error("Error saving amount change: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not save amount change." });
    } finally {
        setIsAmountDialogOpen(false);
        setEditingAmount(null);
    }
  };

  const handleDeleteAmount = async () => {
    if (!transaction || !amountToDelete) return;
    if (transaction.amounts.length <= 1) {
        toast({ variant: 'destructive', title: 'Cannot Delete', description: 'A transaction must have at least one amount entry.' });
        setIsDeleteConfirmOpen(false);
        return;
    }
    
    const updatedAmounts = transaction.amounts.filter(a => a.id !== amountToDelete.id);
    try {
        const transactionRef = doc(db, "transactions", transaction.id);
        await updateDoc(transactionRef, { amounts: updatedAmounts });
        toast({ title: "Amount Deleted" });
        fetchTransactionData();
    } catch (error) {
        console.error("Error deleting amount: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not delete amount." });
    } finally {
        setIsDeleteConfirmOpen(false);
        setAmountToDelete(null);
    }
  };
  
  const handleTransactionDelete = async () => {
    if (!transaction) return;
    try {
        await deleteDoc(doc(db, "transactions", transaction.id));
        toast({ title: "Transaction Deleted" });
        router.push('/transactions');
    } catch (error) {
        toast({ variant: 'destructive', title: "Error", description: "Could not delete transaction." });
    }
  };
  
  const proceedWithTransactionUpdate = async (values: z.infer<typeof transactionSchema>) => {
    if (!transaction) return;

    let finalAmounts = transaction.amounts;

    if (transaction.frequency === 'recurring' && values.frequency === 'one-off' && transaction.amounts.length > 1) {
        const latestAmount = [...transaction.amounts].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
        finalAmounts = [latestAmount];
    }

    const payload: { [key: string]: any } = {
      ...values,
      userId: transaction.userId,
      amounts: finalAmounts,
      endDate: values.frequency === 'recurring' ? values.endDate : null,
    };
    if (payload.transactionType === 'income') {
      delete payload.classification;
    }

    try {
      const transactionRef = doc(db, "transactions", transaction.id);
      await updateDoc(transactionRef, payload);
      toast({ title: "Transaction Updated" });
      fetchTransactionData();
    } catch (error) {
      console.error("Error updating transaction: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not update transaction." });
    } finally {
      setIsTxDialogOpen(false);
      setPendingTransactionUpdate(null);
      setIsConfirmChangeToOneOffOpen(false);
    }
  };
  
  const handleTransactionSubmit = async (values: z.infer<typeof transactionSchema>) => {
    if (!transaction) return;

    if (transaction.frequency === 'recurring' && values.frequency === 'one-off' && transaction.amounts.length > 1) {
      setPendingTransactionUpdate(values);
      setIsConfirmChangeToOneOffOpen(true);
    } else {
      await proceedWithTransactionUpdate(values);
    }
  };

  const handleConfirmChangeToOneOff = async () => {
    if (pendingTransactionUpdate) {
      await proceedWithTransactionUpdate(pendingTransactionUpdate);
    }
  };


  const { chartData, currentAmount, categoryName, categoryIcon, categoryColor, recentAmounts, sharingHouseholdName, ownerName } = useMemo(() => {
    if (!transaction) return { chartData: [], currentAmount: 0, categoryName: '', categoryIcon: 'Paperclip', categoryColor: 'hsl(var(--foreground))', recentAmounts: [], sharingHouseholdName: '', ownerName: '' };
    
    const totalAmount = getAmountForDate(transaction, new Date());

    const sortedAmounts = [...transaction.amounts].sort((a,b) => b.date.getTime() - a.date.getTime());
    const chartPoints = sortedAmounts.map(a => ({
        month: a.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        amount: a.amount
    }));
    
    let catName = '';
    let catIcon = 'Paperclip';
    let catColor = 'hsl(var(--foreground))';
    const allCategories = [...expenseCategories, ...incomeCategories];
    const category = allCategories.find(c => c.id === transaction.categoryId);
    
    if (category) {
        catName = category.name;
        catIcon = category.icon;
        catColor = category.color;
    } else if (transaction.categoryId) {
        catName = 'Uncategorized';
    }

    let hName = '';
    let oName = '';
    if (transaction.sharing !== 'personal') {
        const household = households.find(h => h.id === transaction.sharing);
        if (household) {
            hName = household.name;
            const owner = household.members.find(m => m.id === transaction.userId);
            oName = owner?.name || 'an unknown user';
        }
    }

    return { 
        chartData: chartPoints, 
        currentAmount: totalAmount, 
        categoryName: catName, 
        categoryIcon: catIcon, 
        categoryColor: catColor, 
        recentAmounts: sortedAmounts.slice(0, 3), 
        sharingHouseholdName: hName,
        ownerName: oName
    };
  }, [transaction, expenseCategories, incomeCategories, households]);
  
  const isOwner = user.uid === transaction?.userId;

  if (loading) {
     return (<><Header title="Loading..." /><main className="flex-1 p-4 sm:p-6 text-center"><Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" /></main></>)
  }

  if (!transaction) {
    return (
      <>
        <Header title="Transaction Not Found" />
        <main className="flex-1 space-y-4 p-4 sm:p-6">
            <div>
                <Button asChild variant="outline">
                    <Link href="/transactions">
                        <ChevronLeft className="mr-2 h-4 w-4" />
                        Back to Transactions
                    </Link>
                </Button>
            </div>
            <div className="text-center pt-8">
                <Card className="inline-block">
                    <CardHeader>
                        <CardTitle>Transaction not found</CardTitle>
                        <CardDescription>The transaction you are looking for does not exist.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Please return to the transactions page.</p>
                    </CardContent>
                </Card>
            </div>
        </main>
      </>
    );
  }

  const amountColor = transaction.transactionType === 'income' ? 'text-green-400' : 'text-red-400';

  return (
    <>
      <Header title={transaction.name} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
            <Button asChild variant="outline">
                <Link href="/transactions"><ChevronLeft className="mr-2 h-4 w-4" />Back to Transactions</Link>
            </Button>
            {isOwner && (
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsTxDialogOpen(true)}><Edit className="mr-2 h-4 w-4" /> Edit Details</Button>
                    <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete Transaction</Button></AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete this transaction record and cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleTransactionDelete}>Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>
                </div>
            )}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              {transactionIcons[transaction.transactionType]}
              <div className="flex-1 min-w-0">
                <CardTitle className="text-3xl truncate">{transaction.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-muted-foreground">
                    <div className="flex items-center gap-1">
                        {transaction.frequency === 'recurring' ? <Repeat className="h-4 w-4" /> : <Repeat1 className="h-4 w-4" />}
                        <span>{transaction.frequency === 'one-off' ? 'One-Off' : 'Recurring'}</span>
                    </div>
                     {categoryName && (
                        <Badge variant="outline" className="flex items-center gap-1.5" style={{ borderColor: categoryColor, color: categoryColor }}>
                            <DynamicIcon name={categoryIcon} className="h-3 w-3" />
                            <span>{categoryName}</span>
                        </Badge>
                    )}
                    {transaction.transactionType === 'expense' && transaction.classification && (
                        <Badge variant="outline">
                            {transaction.classification.charAt(0).toUpperCase() + transaction.classification.slice(1)}
                        </Badge>
                    )}
                     <Badge variant="secondary">
                        {transaction.sharing === 'personal' ? 'Personal' : `Shared: ${sharingHouseholdName}`}
                    </Badge>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!isOwner && transaction.sharing !== 'personal' && (
                <Alert variant="default" className="mb-6">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Read-Only Transaction</AlertTitle>
                    <AlertDescription>
                        This is a shared transaction. Only the owner, {ownerName}, can edit or delete it.
                    </AlertDescription>
                </Alert>
            )}
             <Card>
                <CardHeader><CardTitle>Current Amount</CardTitle></CardHeader>
                <CardContent>
                    <p className={`text-3xl font-bold tracking-tight ${amountColor}`}>{formatCurrency(currentAmount, currency)}</p>
                </CardContent>
             </Card>
          </CardContent>
        </Card>

        {transaction.frequency === 'recurring' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <CardHeader><CardTitle>Amount Over Time</CardTitle><CardDescription>Shows the history of the transaction amount.</CardDescription></CardHeader>
                    <CardContent>
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                        <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => formatCurrency(Number(value), currency, { notation: 'compact' })} />
                        <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value), currency)} indicator="dot" />} />
                        <Line dataKey="amount" type="monotone" stroke="var(--color-amount)" strokeWidth={2} dot={true} />
                        </LineChart>
                    </ChartContainer>
                    </CardContent>
                </Card>
                
                <Card className="flex flex-col">
                    <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Recent Amount Changes</CardTitle>
                        <CardDescription>A log of the last 3 value changes.</CardDescription>
                    </div>
                    {isOwner && (
                        <Button onClick={() => { setEditingAmount(null); setIsAmountDialogOpen(true); }}><PlusCircle className="mr-2 h-4 w-4" /> Add Change</Button>
                    )}
                    </CardHeader>
                    <CardContent className="flex-grow">
                        {recentAmounts.length > 0 ? (
                             <ScrollArea className="h-full max-h-72">
                                <div className="space-y-4 pr-4">
                                    {recentAmounts.map(tx => (
                                        <Card key={tx.id} className="p-4 flex justify-between items-center">
                                            <div>
                                                <p className="font-medium">{formatDate(tx.date)}</p>
                                                <p className={`font-mono ${amountColor}`}>{formatCurrency(tx.amount, currency)}</p>
                                            </div>
                                            {isOwner && (
                                                <div className="flex items-center -mr-2">
                                                    <Button variant="ghost" size="icon" onClick={() => { setEditingAmount(tx); setIsAmountDialogOpen(true); }}><Edit className="h-4 w-4" /></Button>
                                                    <Button variant="ghost" size="icon" onClick={() => { setAmountToDelete(tx); setIsDeleteConfirmOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                                                </div>
                                            )}
                                        </Card>
                                    ))}
                                </div>
                            </ScrollArea>
                        ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground">
                                No amount changes yet.
                            </div>
                        )}
                    </CardContent>
                     {(transaction.amounts.length > 3) && (
                        <CardFooter>
                            <Button asChild variant="outline" className="w-full">
                                <Link href={`/transaction/${transaction.id}/history`}>
                                    View Full History
                                </Link>
                            </Button>
                        </CardFooter>
                    )}
                </Card>
            </div>
        ) : (
            <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>One-Off Transaction</AlertTitle>
                <AlertDescription>
                    Amount history and charts are only available for recurring transactions.
                </AlertDescription>
            </Alert>
        )}
      </main>

      {isOwner && (
        <>
            <Dialog open={isAmountDialogOpen} onOpenChange={setIsAmountDialogOpen}><DialogContent className="sm:max-w-[425px]"><DialogHeader><DialogTitle>{editingAmount ? 'Edit Amount' : 'Add Amount Change'}</DialogTitle></DialogHeader><Form {...amountForm}><form onSubmit={amountForm.handleSubmit(handleAmountSubmit)} className="space-y-4 py-4"><FormField control={amountForm.control} name="amount" render={({ field }) => (<FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>)} /><FormField control={amountForm.control} name="date" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Effective Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><ShadcnCalendar mode="single" selected={field.value} onSelect={field.onChange} /></PopoverContent></Popover><FormMessage /></FormItem>)} /><DialogFooter><Button type="button" variant="outline" onClick={() => setIsAmountDialogOpen(false)}>Cancel</Button><Button type="submit">{editingAmount ? 'Update' : 'Add'}</Button></DialogFooter></form></Form></DialogContent></Dialog>
            <Dialog open={isTxDialogOpen} onOpenChange={setIsTxDialogOpen}>
                <DialogContent className="sm:max-w-md flex flex-col max-h-[85dvh]">
                    <DialogHeader><DialogTitle>Edit Transaction Details</DialogTitle></DialogHeader>
                    <Form {...transactionForm}>
                        <form onSubmit={transactionForm.handleSubmit(handleTransactionSubmit)} className="flex flex-col flex-1 min-h-0">
                            <div className="flex-1 overflow-y-scroll overflow-x-hidden pl-2 pr-4 -mr-4 space-y-4 py-2">
                                <FormField control={transactionForm.control} name="transactionType" render={({ field }) => (<FormItem><FormLabel>Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value} disabled><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="income">Income</SelectItem><SelectItem value="expense">Expense</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
                                <FormField control={transactionForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="e.g., Salary, Rent" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                <FormField
                                    control={transactionForm.control}
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
                                {transactionForm.watch('transactionType') === 'expense' && (
                                    <>
                                        <FormField control={transactionForm.control} name="classification" render={({ field }) => (<FormItem className="space-y-3"><FormLabel>Classification</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex items-center space-x-4"><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="need" /></FormControl><FormLabel className="font-normal">Need</FormLabel></FormItem><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="want" /></FormControl><FormLabel className="font-normal">Want</FormLabel></FormItem></RadioGroup></FormControl><FormMessage /></FormItem>)} />
                                        <FormField control={transactionForm.control} name="categoryId" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger></FormControl><SelectContent>{expenseCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                                    </>
                                )}
                                {transactionForm.watch('transactionType') === 'income' && (
                                    <FormField control={transactionForm.control} name="categoryId" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger></FormControl><SelectContent>{incomeCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                                )}
                                <FormField control={transactionForm.control} name="frequency" render={({ field }) => (<FormItem className="space-y-3"><FormLabel>Frequency</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex items-center space-x-4"><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="one-off" /></FormControl><FormLabel className="font-normal">One-Off</FormLabel></FormItem><FormItem className="flex items-center space-x-2 space-y-0"><FormControl><RadioGroupItem value="recurring" /></FormControl><FormLabel className="font-normal">Recurring</FormLabel></FormItem></RadioGroup></FormControl><FormMessage /></FormItem>)} />
                                {transactionForm.watch('frequency') === 'recurring' && (
                                    <FormField control={transactionForm.control} name="endDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>End Date (Optional)</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>No end date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><ShadcnCalendar mode="single" selected={field.value || undefined} onSelect={field.onChange} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                                )}
                            </div>
                            <DialogFooter className="pt-4 flex-shrink-0">
                                <Button type="button" variant="outline" onClick={() => setIsTxDialogOpen(false)}>Cancel</Button>
                                <Button type="submit">Update Details</Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
            <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete this amount record. A transaction must have at least one amount.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => setAmountToDelete(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteAmount}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            <AlertDialog open={isConfirmChangeToOneOffOpen} onOpenChange={setIsConfirmChangeToOneOffOpen}>
                <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                    Changing this to a one-off transaction will delete its amount history, keeping only the most recent amount. This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setPendingTransactionUpdate(null)}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmChangeToOneOff}>Confirm & Update</AlertDialogAction>
                </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
      )}
    </>
  );
}

export default function TransactionDetailPage() {
    return (
        <MainLayout>
            <TransactionDetail />
        </MainLayout>
    );
}
