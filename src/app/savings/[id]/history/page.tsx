
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ChevronLeft, ArrowUpCircle, ArrowDownCircle, CalendarIcon, Info, Edit, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

// Libs and context
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// Types
type Contribution = {
  id: string;
  amount: number;
  date: Date;
};
type SavingGoal = {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  targetDate: Date;
  startDate: Date;
  contributions: Contribution[];
};
type FilterType = 'all' | 'contribution' | 'withdrawal';

const contributionSchema = z.object({
  amount: z.coerce.number().refine(val => val !== 0, 'Amount cannot be zero.'),
  date: z.date({
    required_error: "A date for the contribution is required.",
  }),
});


// Main Component
function SavingGoalHistory() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const goalId = params.id as string;
  const { toast } = useToast();
  const { currency } = useCurrency();
  
  const [goal, setGoal] = useState<SavingGoal | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  
  const [isContribDialogOpen, setIsContribDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [editingContribution, setEditingContribution] = useState<Contribution | null>(null);
  const [contributionToDelete, setContributionToDelete] = useState<Contribution | null>(null);

  const contributionForm = useForm<z.infer<typeof contributionSchema>>({
    resolver: zodResolver(contributionSchema),
  });

  async function fetchGoal() {
    if (!goalId || !user) return;
    setLoading(true);
    const goalRef = doc(db, 'savings', goalId);
    const goalSnap = await getDoc(goalRef);

    if (goalSnap.exists()) {
        const data = goalSnap.data();
        if (data.userId !== user.uid) {
            toast({ variant: 'destructive', title: 'Access Denied' });
            router.push('/savings');
            return;
        }
        const goalData = {
            id: goalSnap.id,
            ...data,
            startDate: data.startDate.toDate(),
            targetDate: data.targetDate.toDate(),
            contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
        } as SavingGoal;
        setGoal(goalData);
        setDateRange({ from: goalData.startDate, to: new Date() });
    } else {
        toast({ variant: 'destructive', title: 'Not Found'});
        router.push('/savings');
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchGoal();
  }, [goalId, user, router, toast]);

  useEffect(() => {
    if (isContribDialogOpen) {
      if (editingContribution) {
        contributionForm.reset(editingContribution);
      } else {
        contributionForm.reset({ amount: 0, date: new Date() });
      }
    }
  }, [editingContribution, isContribDialogOpen, contributionForm]);

  const handleContributionSubmit = async (values: z.infer<typeof contributionSchema>) => {
    if (!goal) return;

    let updatedContributions;
    if (editingContribution) {
      updatedContributions = goal.contributions.map(c => 
        c.id === editingContribution.id ? { ...c, ...values } : c
      );
    } else {
      const newContribution = { ...values, id: crypto.randomUUID() };
      updatedContributions = [...goal.contributions, newContribution];
    }
    
    try {
        const goalRef = doc(db, "savings", goal.id);
        await updateDoc(goalRef, { contributions: updatedContributions });
        toast({ title: editingContribution ? "Transaction Updated" : "Transaction Added" });
        fetchGoal();
    } catch(error) {
        console.error("Error saving contribution: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not save transaction." });
    } finally {
        setIsContribDialogOpen(false);
        setEditingContribution(null);
    }
  };

  const handleDeleteContribution = async () => {
    if (!goal || !contributionToDelete) return;
    const updatedContributions = goal.contributions.filter(c => c.id !== contributionToDelete.id);
    try {
        const goalRef = doc(db, "savings", goal.id);
        await updateDoc(goalRef, { contributions: updatedContributions });
        toast({ title: "Transaction Deleted" });
        fetchGoal();
    } catch (error) {
        console.error("Error deleting contribution: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not delete transaction." });
    } finally {
        setIsDeleteConfirmOpen(false);
        setContributionToDelete(null);
    }
  };


  const filteredTransactions = useMemo(() => {
    if (!goal) return [];

    return goal.contributions
      .filter(c => {
        if (typeFilter === 'contribution') return c.amount > 0;
        if (typeFilter === 'withdrawal') return c.amount < 0;
        return true;
      })
      .filter(c => {
        if (!dateRange?.from) return true;
        const toDate = dateRange.to || dateRange.from;
        return isWithinInterval(c.date, { start: dateRange.from, end: toDate });
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [goal, dateRange, typeFilter]);

  if (loading) {
     return (<><Header title="Loading History..." /><main className="flex-1 p-4 sm:p-6 text-center"><Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" /></main></>)
  }

  if (!goal) return null;

  return (
    <>
      <Header title={`${goal.name} History`} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="flex justify-start">
            <Button asChild variant="outline">
                <Link href={`/savings/${goal.id}`}><ChevronLeft className="mr-2 h-4 w-4" />Back to Goal</Link>
            </Button>
        </div>
        
        <Card>
            <CardHeader><CardTitle>Filter Transactions</CardTitle></CardHeader>
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
                 <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FilterType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Types</SelectItem>
                            <SelectItem value="contribution">Contributions</SelectItem>
                            <SelectItem value="withdrawal">Withdrawals</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader><CardTitle>Results</CardTitle><CardDescription>Found {filteredTransactions.length} transaction(s).</CardDescription></CardHeader>
            <CardContent>
                {filteredTransactions.length > 0 ? (
                    <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right w-[100px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                        {filteredTransactions.map(c => {
                            const isContribution = c.amount > 0;
                            return (
                                <TableRow key={c.id}>
                                    <TableCell>{format(c.date, 'PP')}</TableCell>
                                    <TableCell><div className="flex items-center gap-2">{isContribution ? <ArrowUpCircle className="h-5 w-5 text-green-400" /> : <ArrowDownCircle className="h-5 w-5 text-red-400" />}<span className="font-medium">{isContribution ? 'Contribution' : 'Withdrawal'}</span></div></TableCell>
                                    <TableCell className={`text-right font-mono ${isContribution ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(c.amount, currency)}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => { setEditingContribution(c); setIsContribDialogOpen(true); }}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => { setContributionToDelete(c); setIsDeleteConfirmOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                        </TableBody>
                    </Table>
                ) : (
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertTitle>No Results</AlertTitle>
                        <AlertDescription>No transactions match your current filters. Try adjusting the date range or type.</AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
      </main>

      {/* Contribution Add/Edit Dialog */}
      <Dialog open={isContribDialogOpen} onOpenChange={setIsContribDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader><DialogTitle>{editingContribution ? 'Edit Transaction' : 'Add Transaction'}</DialogTitle></DialogHeader>
          <Form {...contributionForm}>
            <form onSubmit={contributionForm.handleSubmit(handleContributionSubmit)} className="space-y-4 py-4">
              <FormField control={contributionForm.control} name="amount" render={({ field }) => (
                <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl><Input type="number" step="any" {...field} onFocus={(e) => e.target.select()} /></FormControl>
                    <FormDescription>Use a positive value for contributions and a negative value for withdrawals.</FormDescription>
                    <FormMessage />
                </FormItem>
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
                      <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={{ after: new Date() }} />
                  </PopoverContent></Popover>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsContribDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingContribution ? 'Update Transaction' : 'Add Transaction'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Delete Contribution Confirmation */}
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete this transaction record.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setContributionToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContribution}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function SavingGoalHistoryPage() {
    return (
        <MainLayout>
            <SavingGoalHistory />
        </MainLayout>
    );
}
