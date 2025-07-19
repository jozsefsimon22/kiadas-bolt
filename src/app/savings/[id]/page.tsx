
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
import { PiggyBank, CalendarIcon, Edit, Trash2, Loader2, PlusCircle, ArrowUpCircle, ArrowDownCircle, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as ShadcnCalendar } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';


type Contribution = {
  id: string;
  amount: number;
  date: Date;
  userId: string;
  userName: string;
};

type SavingGoal = {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  targetDate: Date;
  startDate: Date;
  sharing: 'personal' | string;
  splitType?: 'equal' | 'contribution';
  contributions: Contribution[];
};

type Household = {
    id: string;
    name: string;
};

const contributionSchema = z.object({
  amount: z.coerce.number().refine(val => val !== 0, 'Amount cannot be zero.'),
  date: z.date({
    required_error: "A date for the contribution is required.",
  }),
});

const savingGoalSchema = z.object({
  name: z.string().min(1, 'Goal name is required.'),
  targetAmount: z.coerce.number().positive('Target amount must be positive.'),
  targetDate: z.date({ required_error: "A target date is required." }),
  startDate: z.date({ required_error: "A start date is required." }),
  sharing: z.string().min(1, 'Sharing option is required.'),
  splitType: z.enum(['equal', 'contribution']).optional(),
}).refine(data => isAfter(data.targetDate, data.startDate || new Date()), {
    message: 'Target date must be after the start date.',
    path: ['targetDate'],
});


const formatDate = (date: Date) => {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

const chartConfig = {
  value: { label: "Value", color: "hsl(var(--chart-1))" },
  target: { label: "Target", color: "hsl(var(--chart-2))" },
};

function SavingGoalDetail() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const goalId = params.id as string;
  const { toast } = useToast();
  const { currency } = useCurrency();
  
  const [goal, setGoal] = useState<SavingGoal | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);

  const [isContribDialogOpen, setIsContribDialogOpen] = useState(false);
  const [isGoalDialogOpen, setIsGoalDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  
  const [editingContribution, setEditingContribution] = useState<Contribution | null>(null);
  const [contributionToDelete, setContributionToDelete] = useState<Contribution | null>(null);

  const contributionForm = useForm<z.infer<typeof contributionSchema>>({
    resolver: zodResolver(contributionSchema),
  });
  
  const goalForm = useForm<z.infer<typeof savingGoalSchema>>({
    resolver: zodResolver(savingGoalSchema),
  });

  const sharingWatcher = goalForm.watch('sharing');
  
  async function fetchGoal() {
    if (!goalId || !user) return;
    setLoading(true);

    const householdsQuery = query(collection(db, 'households'), where('memberIds', 'array-contains', user.uid));
    const householdsSnapshot = await getDocs(householdsQuery);
    const householdsList = householdsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
    setHouseholds(householdsList);
    
    const goalRef = doc(db, 'savings', goalId);
    const goalSnap = await getDoc(goalRef);

    if (goalSnap.exists()) {
        const data = goalSnap.data();
        const householdIds = householdsList.map(h => h.id);
        const isPersonal = data.sharing === 'personal' && data.userId === user.uid;
        const isSharedWithUser = data.sharing !== 'personal' && householdIds.includes(data.sharing);
        
        if (!isPersonal && !isSharedWithUser) {
            toast({ variant: 'destructive', title: 'Access Denied' });
            router.push('/savings');
            return;
        }

        setGoal({
            id: goalSnap.id,
            ...data,
            startDate: data.startDate.toDate(),
            targetDate: data.targetDate.toDate(),
            contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
        } as SavingGoal);
    } else {
        toast({ variant: 'destructive', title: 'Not Found'});
        setGoal(null);
    }
    setLoading(false);
  }
  
  useEffect(() => {
    fetchGoal();
  }, [goalId, user]);
  
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
      if (isGoalDialogOpen && goal) {
          goalForm.reset({
              name: goal.name,
              targetAmount: goal.targetAmount,
              startDate: goal.startDate,
              targetDate: goal.targetDate,
              sharing: goal.sharing,
              splitType: goal.splitType,
          });
      }
  }, [goal, isGoalDialogOpen, goalForm]);

  const handleContributionSubmit = async (values: z.infer<typeof contributionSchema>) => {
    if (!goal || !user) return;

    let updatedContributions;
    if (editingContribution) {
      // Only allow user to edit their own contributions
      if (editingContribution.userId !== user.uid) {
          toast({ variant: 'destructive', title: "Unauthorized", description: "You can only edit your own contributions." });
          return;
      }
      updatedContributions = goal.contributions.map(c => 
        c.id === editingContribution.id ? { ...c, ...values } : c
      );
    } else {
      const newContribution: Contribution = { 
        ...values, 
        id: crypto.randomUUID(),
        userId: user.uid,
        userName: user.displayName || 'Anonymous'
      };
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

  const handleGoalSubmit = async (values: z.infer<typeof savingGoalSchema>) => {
      if (!goal || !user || goal.userId !== user.uid) return;
      try {
          const goalRef = doc(db, 'savings', goal.id);
          const payload = {
              ...values,
              splitType: values.sharing === 'personal' ? undefined : values.splitType
          };
          await updateDoc(goalRef, payload);
          toast({ title: "Goal Updated" });
          fetchGoal();
      } catch (error) {
          console.error("Error updating goal:", error);
          toast({ variant: 'destructive', title: "Error", description: "Could not update goal." });
      } finally {
          setIsGoalDialogOpen(false);
      }
  }

  const handleDeleteContribution = async () => {
    if (!goal || !contributionToDelete) return;

    if (contributionToDelete.userId !== user.uid) {
        toast({ variant: 'destructive', title: "Unauthorized", description: "You can only delete your own contributions." });
        return;
    }

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

  const { chartData, totalSaved, progress, recentTransactions, memberContributions } = useMemo(() => {
    if (!goal) return { chartData: [], totalSaved: 0, progress: 0, recentTransactions: [], memberContributions: [] };

    const saved = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
    const prog = goal.targetAmount > 0 ? (saved / goal.targetAmount) * 100 : 0;

    let runningTotal = 0;
    const sortedForChart = [...goal.contributions].sort((a,b) => a.date.getTime() - b.date.getTime());
    const points = sortedForChart.map(c => {
        runningTotal += c.amount;
        return {
            month: c.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            value: runningTotal,
            target: goal.targetAmount,
        }
    });

    const sortedForList = [...goal.contributions].sort((a,b) => b.date.getTime() - a.date.getTime());

    const memberTotals: Record<string, { userId: string; name: string, total: number }> = {};
    if (goal.sharing !== 'personal' && goal.splitType === 'contribution') {
      goal.contributions.forEach(c => {
        if (!memberTotals[c.userId]) {
          memberTotals[c.userId] = { userId: c.userId, name: c.userName, total: 0 };
        }
        memberTotals[c.userId].total += c.amount;
      });
    }

    return { 
      chartData: points, 
      totalSaved: saved, 
      progress: prog,
      recentTransactions: sortedForList.slice(0, 3),
      memberContributions: Object.values(memberTotals).sort((a,b) => b.total - a.total),
    };
  }, [goal]);

  const contributionDisabledDates = useMemo(() => {
    const disabled: ({ after: Date } | { before: Date })[] = [{ after: new Date() }];
    if (goal?.startDate) {
      disabled.push({ before: goal.startDate });
    }
    return disabled;
  }, [goal]);
  
  if (loading) {
     return (<><Header title="Loading Goal..." /><main className="flex-1 p-4 sm:p-6 text-center"><Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" /></main></>)
  }

  if (!goal) {
    return (
        <>
            <Header title="Goal Not Found" />
            <main className="flex-1 space-y-4 p-4 sm:p-6">
              <div className="max-w-7xl mx-auto w-full space-y-6">
                <div>
                    <Button asChild variant="outline">
                        <Link href="/savings">
                            <ChevronLeft className="mr-2 h-4 w-4" />
                            Back to Savings
                        </Link>
                    </Button>
                </div>
                <div className="text-center pt-8">
                    <Card className="inline-block">
                        <CardHeader>
                            <CardTitle>Goal not found</CardTitle>
                            <CardDescription>The goal you are looking for does not exist.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground">Please return to the savings page.</p>
                        </CardContent>
                    </Card>
                </div>
              </div>
            </main>
        </>
    );
  }
  
  const currencyOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  const canPerformActions = goal.userId === user.uid;

  return (
    <>
      <Header title={goal.name} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
          <div className="flex justify-start">
              <Button asChild variant="outline">
                  <Link href="/savings"><ChevronLeft className="mr-2 h-4 w-4" />Back to Savings</Link>
              </Button>
          </div>
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start gap-4">
                <div className="flex items-center gap-4">
                  <PiggyBank className="h-8 w-8 text-primary" />
                  <div>
                    <CardTitle className="text-3xl">{goal.name}</CardTitle>
                    <CardDescription>Target: {formatCurrency(goal.targetAmount, currency, currencyOptions)} by {formatDate(goal.targetDate)}</CardDescription>
                  </div>
                </div>
                {canPerformActions && (
                    <Button variant="outline" onClick={() => setIsGoalDialogOpen(true)}>
                        <Edit className="mr-2 h-4 w-4" /> Edit Goal
                    </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
               <Progress value={progress} />
               <div className="text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">{formatCurrency(totalSaved, currency, currencyOptions)}</span> saved so far ({progress.toFixed(1)}%)
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                  <CardHeader><CardTitle>Progress Over Time</CardTitle></CardHeader>
                  <CardContent>
                  <ChartContainer config={chartConfig} className="h-[300px] w-full">
                      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => formatCurrency(Number(value), currency, { notation: 'compact' })} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => formatCurrency(Number(value), currency)} indicator="dot" />} />
                      <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={false} name="Saved" />
                      <Line dataKey="target" type="monotone" stroke="var(--color-target)" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Target" />
                      </LineChart>
                  </ChartContainer>
                  </CardContent>
              </Card>
              
              <Card className="flex flex-col">
                  <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                      <CardTitle>Recent Transactions</CardTitle>
                      <CardDescription>The last 3 transactions for this goal.</CardDescription>
                  </div>
                   <div className="flex gap-2">
                      <Button size="sm" onClick={() => { setEditingContribution(null); setIsContribDialogOpen(true); }}>
                          <PlusCircle className="mr-2 h-4 w-4" /> Add
                      </Button>
                   </div>
                  </CardHeader>
                  <CardContent className="flex-grow">
                      {recentTransactions.length > 0 ? (
                          <>
                              <div className="space-y-4 md:hidden pr-4">
                                  {recentTransactions.map(c => {
                                      const isContribution = c.amount > 0;
                                      return (
                                          <Card key={c.id} className="p-4 flex justify-between items-center">
                                              <div className="flex items-center gap-3">
                                                  {isContribution ? <ArrowUpCircle className="h-6 w-6 text-green-400" /> : <ArrowDownCircle className="h-6 w-6 text-red-400" />}
                                                  <div>
                                                      <p className="font-medium">{c.userName}</p>
                                                      <p className="text-sm text-muted-foreground">{formatDate(c.date)}</p>
                                                  </div>
                                              </div>
                                              <div className="text-right">
                                                  <p className={`font-mono ${isContribution ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(c.amount, currency)}</p>
                                                  {c.userId === user.uid && (
                                                      <div className="-mr-2">
                                                          <Button variant="ghost" size="icon" onClick={() => { setEditingContribution(c); setIsContribDialogOpen(true); }}><Edit className="h-4 w-4" /></Button>
                                                          <Button variant="ghost" size="icon" onClick={() => { setContributionToDelete(c); setIsDeleteConfirmOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                                                      </div>
                                                  )}
                                              </div>
                                          </Card>
                                      )
                                  })}
                              </div>
                              <Table className="hidden md:table">
                                  <TableHeader>
                                  <TableRow>
                                      <TableHead>Contributor</TableHead>
                                      <TableHead>Date</TableHead>
                                      <TableHead>Type</TableHead>
                                      <TableHead className="text-right">Amount</TableHead>
                                      <TableHead className="text-right w-[100px]">Actions</TableHead>
                                  </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                  {recentTransactions.map(c => {
                                      const isContribution = c.amount > 0;
                                      return (
                                          <TableRow key={c.id}>
                                              <TableCell className="font-medium">{c.userName}</TableCell>
                                              <TableCell>{formatDate(c.date)}</TableCell>
                                              <TableCell>
                                                  <div className="flex items-center gap-2">
                                                      {isContribution ? <ArrowUpCircle className="h-5 w-5 text-green-400" /> : <ArrowDownCircle className="h-5 w-5 text-red-400" />}
                                                      <span className="font-medium">{isContribution ? 'Contribution' : 'Withdrawal'}</span>
                                                  </div>
                                              </TableCell>
                                              <TableCell className={`text-right font-mono ${isContribution ? 'text-green-400' : 'text-red-400'}`}>
                                                  {formatCurrency(c.amount, currency)}
                                              </TableCell>
                                              <TableCell className="text-right">
                                              {c.userId === user.uid && (
                                                  <>
                                                      <Button variant="ghost" size="icon" onClick={() => { setEditingContribution(c); setIsContribDialogOpen(true); }}><Edit className="h-4 w-4" /></Button>
                                                      <Button variant="ghost" size="icon" onClick={() => { setContributionToDelete(c); setIsDeleteConfirmOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                                                  </>
                                              )}
                                              </TableCell>
                                          </TableRow>
                                      )
                                  })}
                                  </TableBody>
                              </Table>
                          </>
                      ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                              No transactions yet.
                          </div>
                      )}
                  </CardContent>
                  {(goal.contributions.length > 3) && (
                      <CardFooter>
                          <Button asChild variant="outline" className="w-full">
                              <Link href={`/savings/${goal.id}/history`}>
                                  View All Transactions
                              </Link>
                          </Button>
                      </CardFooter>
                  )}
              </Card>
          </div>
          {goal.sharing !== 'personal' && goal.splitType === 'contribution' && memberContributions.length > 0 && (
              <Card>
                  <CardHeader>
                      <CardTitle>Member Contributions</CardTitle>
                      <CardDescription>Total amount contributed by each member.</CardDescription>
                  </CardHeader>
                  <CardContent>
                      <Table>
                          <TableHeader>
                              <TableRow>
                                  <TableHead>Member</TableHead>
                                  <TableHead className="text-right">Contribution</TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody>
                              {memberContributions.map(member => {
                                  const percentage = totalSaved > 0 ? (member.total / totalSaved) * 100 : 0;
                                  return (
                                  <TableRow key={member.userId}>
                                      <TableCell className="font-medium">{member.name}</TableCell>
                                      <TableCell className="text-right">
                                          <div className="font-mono">{formatCurrency(member.total, currency)}</div>
                                          <div className="text-xs text-muted-foreground">{percentage.toFixed(1)}% of total</div>
                                      </TableCell>
                                  </TableRow>
                              )})}
                          </TableBody>
                      </Table>
                  </CardContent>
              </Card>
          )}
        </div>
      </main>

      {/* Goal Edit Dialog */}
      <Dialog open={isGoalDialogOpen} onOpenChange={setIsGoalDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Goal</DialogTitle><DialogDescription>Update your goal details.</DialogDescription></DialogHeader>
          <Form {...goalForm}>
            <form onSubmit={goalForm.handleSubmit(handleGoalSubmit)} className="space-y-4 py-4">
              <FormField control={goalForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Goal Name</FormLabel><FormControl><Input placeholder="e.g., New Car, Vacation" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={goalForm.control} name="targetAmount" render={({ field }) => (<FormItem><FormLabel>Target Amount</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>)} />
              <FormField
                control={goalForm.control}
                name="sharing"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sharing</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select who to share this goal with" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="personal">Personal (Just Me)</SelectItem>
                        {households.map((h) => (
                          <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {sharingWatcher !== 'personal' && (
                <FormField
                  control={goalForm.control}
                  name="splitType"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Split Type</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="flex flex-col space-y-1"
                        >
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="equal" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Split Equally
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="contribution" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Split by Contribution
                            </FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={goalForm.control} name="startDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Start Date</FormLabel><Popover><PopoverTrigger asChild><FormControl>
                    <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button>
                </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><ShadcnCalendar mode="single" selected={field.value} onSelect={field.onChange} disabled={{ after: new Date() }} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                <FormField control={goalForm.control} name="targetDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Target Date</FormLabel><Popover><PopoverTrigger asChild><FormControl>
                    <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button>
                </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><ShadcnCalendar mode="single" selected={field.value} onSelect={field.onChange} disabled={{ before: goalForm.getValues('startDate') || new Date() }} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setIsGoalDialogOpen(false)}>Cancel</Button><Button type="submit">Update Goal</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>


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
                      <ShadcnCalendar mode="single" selected={field.value} onSelect={field.onChange} disabled={contributionDisabledDates} />
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

export default function SavingGoalDetailPage() {
    return (
        <MainLayout>
            <SavingGoalDetail />
        </MainLayout>
    )
}
