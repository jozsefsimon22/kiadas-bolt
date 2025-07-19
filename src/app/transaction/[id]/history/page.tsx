
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { format, isWithinInterval } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// UI components
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ChevronLeft, CalendarIcon, Info, Edit, Trash2, PlusCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

// Libs and context
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// Types
type AmountChange = { id: string; amount: number; date: Date; };
type BaseTransaction = { id: string; userId: string; name: string; amounts: AmountChange[]; transactionType: 'income' | 'expense' };

const amountChangeSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive.'),
  date: z.date({ required_error: 'An effective date is required.' }),
});

// Main Component
function TransactionHistory() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const transactionId = params.id as string;
  const { toast } = useToast();
  const { currency } = useCurrency();
  
  const [transaction, setTransaction] = useState<BaseTransaction | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const [isAmountDialogOpen, setIsAmountDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [editingAmount, setEditingAmount] = useState<AmountChange | null>(null);
  const [amountToDelete, setAmountToDelete] = useState<AmountChange | null>(null);

  const amountForm = useForm<z.infer<typeof amountChangeSchema>>({
    resolver: zodResolver(amountChangeSchema),
  });

  async function fetchTransaction() {
    if (!transactionId || !user) return;
    setLoading(true);
    const txRef = doc(db, 'transactions', transactionId);
    const txSnap = await getDoc(txRef);

    if (txSnap.exists()) {
        const data = txSnap.data();
        // Security rules handle access, so we just need to load if it exists
        const txData = {
            id: txSnap.id,
            ...data,
            amounts: (data.amounts || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
        } as BaseTransaction;
        setTransaction(txData);
        if (txData.amounts.length > 0) {
            const sortedHistory = [...txData.amounts].sort((a,b) => a.date.getTime() - b.date.getTime());
            setDateRange({ from: sortedHistory[0].date, to: new Date() });
        }
    } else {
        toast({ variant: 'destructive', title: 'Not Found'});
        router.push('/transactions');
    }
    setLoading(false);
  }
  
  useEffect(() => {
    fetchTransaction();
  }, [transactionId, user, router, toast]);

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
        fetchTransaction();
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
        fetchTransaction();
    } catch (error) {
        console.error("Error deleting amount: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not delete amount." });
    } finally {
        setIsDeleteConfirmOpen(false);
        setAmountToDelete(null);
    }
  };

  const filteredAmounts = useMemo(() => {
    if (!transaction) return [];

    return transaction.amounts
      .filter(c => {
        if (!dateRange?.from) return true;
        const toDate = dateRange.to || dateRange.from;
        return isWithinInterval(c.date, { start: dateRange.from, end: toDate });
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [transaction, dateRange]);
  
  const amountColor = transaction?.transactionType === 'income' ? 'text-green-400' : 'text-red-400';
  const isOwner = user?.uid === transaction?.userId;

  if (loading) {
     return (<><Header title="Loading History..." /><main className="flex-1 p-4 sm:p-6 text-center"><Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" /></main></>)
  }

  if (!transaction) return null;

  return (
    <>
      <Header title={`${transaction.name} History`} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="flex justify-start">
            <Button asChild variant="outline">
                <Link href={`/transaction/${transaction.id}`}><ChevronLeft className="mr-2 h-4 w-4" />Back to Transaction</Link>
            </Button>
        </div>
        
        <Card>
            <CardHeader><CardTitle>Filter Amount Changes</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Date Range</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant={"outline"}
                                className={cn("w-full justify-start text-left font-normal", !dateRange && "text-muted-foreground")}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (
                                    dateRange.to ? (
                                        <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>
                                    ) : (format(dateRange.from, "LLL dd, y"))
                                ) : (<span>Pick a date</span>)}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                        </PopoverContent>
                    </Popover>
                </div>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Results</CardTitle>
                        <CardDescription>Found {filteredAmounts.length} amount change(s).</CardDescription>
                    </div>
                     {isOwner && (
                        <Button onClick={() => { setEditingAmount(null); setIsAmountDialogOpen(true); }}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Add Amount Change
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {filteredAmounts.length > 0 ? (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Effective Date</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                {isOwner && <TableHead className="text-right w-[100px]">Actions</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                        {filteredAmounts.map(c => (
                            <TableRow key={c.id}>
                                <TableCell>{format(c.date, 'PP')}</TableCell>
                                <TableCell className={cn('text-right font-mono', amountColor)}>{formatCurrency(c.amount, currency)}</TableCell>
                                {isOwner && (
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => { setEditingAmount(c); setIsAmountDialogOpen(true); }}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => { setAmountToDelete(c); setIsDeleteConfirmOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                        </TableBody>
                    </Table>
                ) : (
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertTitle>No Results</AlertTitle>
                        <AlertDescription>No amount changes match your current filters. Try adjusting the date range.</AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
      </main>

      {isOwner && (
        <>
            <Dialog open={isAmountDialogOpen} onOpenChange={setIsAmountDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                <DialogHeader><DialogTitle>{editingAmount ? 'Edit Amount' : 'Add Amount Change'}</DialogTitle></DialogHeader>
                <Form {...amountForm}>
                    <form onSubmit={amountForm.handleSubmit(handleAmountSubmit)} className="space-y-4 py-4">
                    <FormField control={amountForm.control} name="amount" render={({ field }) => (<FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={amountForm.control} name="date" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Effective Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsAmountDialogOpen(false)}>Cancel</Button>
                        <Button type="submit">{editingAmount ? 'Update' : 'Add'}</Button>
                    </DialogFooter>
                    </form>
                </Form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>This will permanently delete this amount record. A transaction must have at least one amount.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setAmountToDelete(null)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteAmount}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
      )}
    </>
  );
}

export default function TransactionHistoryPage() {
    return (
        <MainLayout>
            <TransactionHistory />
        </MainLayout>
    );
}
