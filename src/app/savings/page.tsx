
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, isAfter } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CalendarIcon, Edit, Loader2, PiggyBank, PlusCircle, Trash2, Info, Users } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type SavingGoalContribution = {
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
  contributions: SavingGoalContribution[];
};

type Household = {
    id: string;
    name: string;
}

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

function Savings() {
  const user = useAuth();
  const { currency } = useCurrency();
  const [goals, setGoals] = useState<SavingGoal[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingGoal | null>(null);
  const [goalToDelete, setGoalToDelete] = useState<SavingGoal | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof savingGoalSchema>>({
    resolver: zodResolver(savingGoalSchema),
  });

  const sharingWatcher = form.watch('sharing');

  async function fetchData() {
    if (!user) return;
    setIsLoading(true);

    const householdsQuery = query(collection(db, 'households'), where('memberIds', 'array-contains', user.uid));
    const householdsSnapshot = await getDocs(householdsQuery);
    const householdsList = householdsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
    setHouseholds(householdsList);
    const householdIds = householdsList.map(h => h.id);

    const personalGoalsQuery = query(collection(db, 'savings'), where('userId', '==', user.uid), where('sharing', '==', 'personal'));
    const sharedGoalsQuery = householdIds.length > 0
        ? query(collection(db, 'savings'), where('sharing', 'in', householdIds))
        : null;

    const [personalGoalsSnapshot, sharedGoalsSnapshot] = await Promise.all([
        getDocs(personalGoalsQuery),
        sharedGoalsQuery ? getDocs(sharedGoalsQuery) : Promise.resolve({ docs: [] })
    ]);
    
    const goalsMap = new Map<string, SavingGoal>();

    const processSnapshot = (snapshot: any) => {
        snapshot.docs.forEach((doc: any) => {
            const data = doc.data();
            const goal = {
                id: doc.id,
                ...data,
                targetDate: data.targetDate.toDate(),
                startDate: data.startDate.toDate(),
                contributions: data.contributions ? data.contributions.map((c: any) => ({ ...c, date: c.date.toDate() })) : [],
            } as SavingGoal;
            goalsMap.set(goal.id, goal);
        });
    };
    
    processSnapshot(personalGoalsSnapshot);
    processSnapshot(sharedGoalsSnapshot);

    setGoals(Array.from(goalsMap.values()));
    setIsLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, [user]);
  
  useEffect(() => {
    if (isDialogOpen) {
        if (editingGoal) {
          form.reset({
            name: editingGoal.name,
            targetAmount: editingGoal.targetAmount,
            startDate: editingGoal.startDate,
            targetDate: editingGoal.targetDate,
            sharing: editingGoal.sharing,
            splitType: editingGoal.splitType || 'equal',
          });
        } else {
          form.reset({
            name: '',
            targetAmount: 1000,
            startDate: new Date(),
            targetDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
            sharing: 'personal',
            splitType: 'equal',
          });
        }
    }
  }, [editingGoal, isDialogOpen]);

  const handleFormSubmit = async (values: z.infer<typeof savingGoalSchema>) => {
    if (!user) return;
    try {
      if (editingGoal) {
        const goalRef = doc(db, "savings", editingGoal.id);
        const payload = { 
            ...values, 
            userId: editingGoal.userId, 
            contributions: editingGoal.contributions,
            splitType: values.sharing === 'personal' ? undefined : values.splitType
        };
        await updateDoc(goalRef, payload);
        toast({ title: "Goal Updated" });
      } else {
        const payload = { 
            ...values, 
            userId: user.uid, 
            contributions: [],
            splitType: values.sharing === 'personal' ? undefined : values.splitType
        };
        await addDoc(collection(db, "savings"), payload);
        toast({ title: "Goal Added" });
      }
      setEditingGoal(null);
      setIsDialogOpen(false);
      fetchData();
    } catch(error) {
      console.error("Error saving goal: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not save savings goal." });
    }
  };

  const handleDeleteGoal = async () => {
    if (!goalToDelete) return;
    try {
      await deleteDoc(doc(db, "savings", goalToDelete.id));
      toast({ title: "Goal Deleted", description: `"${goalToDelete.name}" has been removed.` });
      setGoalToDelete(null);
      fetchData(); 
    } catch (error) {
      console.error("Error deleting goal: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not delete goal." });
    }
  };

  const openAddDialog = () => {
    setEditingGoal(null);
    setIsDialogOpen(true);
  };
  
  const openEditDialog = (e: React.MouseEvent, goal: SavingGoal) => {
    e.preventDefault();
    if (goal.userId !== user?.uid) {
        toast({ variant: 'destructive', title: "Unauthorized", description: "Only the goal owner can edit details." });
        return;
    }
    setEditingGoal(goal);
    setIsDialogOpen(true);
  };
  
  const openDeleteDialog = (e: React.MouseEvent, goal: SavingGoal) => {
    e.preventDefault();
    if (goal.userId !== user?.uid) {
        toast({ variant: 'destructive', title: "Unauthorized", description: "Only the goal owner can delete the goal." });
        return;
    }
    setGoalToDelete(goal);
  };
  
  const getHouseholdName = (householdId: string) => {
      if (householdId === 'personal') return 'Personal';
      return households.find(h => h.id === householdId)?.name || 'Shared';
  }

  return (
    <>
      <Header title="Savings Goals" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <div className="flex justify-end">
                <Button onClick={openAddDialog}>
                    <PlusCircle /> Add Goal
                </Button>
            </div>
            {isLoading ? (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            </div>
            ) : goals.length > 0 ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {goals.map(goal => {
                    const currentAmount = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
                    const progress = goal.targetAmount > 0 ? Math.min((currentAmount / goal.targetAmount) * 100, 100) : 0;
                    const currencyOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
                return (
                    <Link key={goal.id} href={`/savings/${goal.id}`} className="flex">
                    <Card className="w-full flex flex-col hover:border-primary transition-colors">
                        <CardHeader>
                            <div className="flex justify-between items-start">
                            <CardTitle className="flex items-center gap-2">
                                <PiggyBank className="h-6 w-6 text-primary" /> {goal.name}
                            </CardTitle>
                            {goal.sharing !== 'personal' && <Users className="h-5 w-5 text-muted-foreground" />}
                            </div>
                        <CardDescription>Target: {format(goal.targetDate, "PP")} &middot; {getHouseholdName(goal.sharing)}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 flex-grow">
                        <Progress value={progress} />
                        <div className="text-sm text-muted-foreground">
                            <span className="font-bold text-foreground">{formatCurrency(Math.min(currentAmount, goal.targetAmount), currency, currencyOptions)}</span> of {formatCurrency(goal.targetAmount, currency, currencyOptions)}
                        </div>
                        </CardContent>
                        <CardFooter className="justify-end gap-2">
                        {goal.userId === user?.uid && (
                            <>
                                <Button variant="ghost" size="icon" onClick={(e) => openEditDialog(e, goal)}><Edit className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" onClick={(e) => openDeleteDialog(e, goal)}><Trash2 className="h-4 w-4" /></Button>
                            </>
                        )}
                        </CardFooter>
                    </Card>
                    </Link>
                )
                })}
            </div>
            ) : (
            <div className="text-center py-12">
                <Alert className="max-w-md mx-auto">
                    <Info className="h-4 w-4" />
                    <AlertTitle>No savings goals yet!</AlertTitle>
                    <AlertDescription>
                    Click "Add Goal" to create your first savings goal and start tracking your progress.
                    </AlertDescription>
                </Alert>
            </div>
            )}
        </div>
      </main>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingGoal ? 'Edit Goal' : 'Add New Savings Goal'}</DialogTitle><DialogDescription>{editingGoal ? 'Update your goal details.' : 'Set up a new goal to save for.'}</DialogDescription></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4 py-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Goal Name</FormLabel><FormControl><Input placeholder="e.g., New Car, Vacation" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="targetAmount" render={({ field }) => (<FormItem><FormLabel>Target Amount</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>)} />
              <FormField
                control={form.control}
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
                  control={form.control}
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
                <FormField control={form.control} name="startDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Start Date</FormLabel><Popover><PopoverTrigger asChild><FormControl>
                    <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button>
                </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={{ after: new Date() }} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="targetDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Target Date</FormLabel><Popover><PopoverTrigger asChild><FormControl>
                    <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button>
                </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={{ before: form.getValues('startDate') || new Date() }} /></PopoverContent></Popover><FormMessage /></FormItem>)} />
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button type="submit">{editingGoal ? 'Update Goal' : 'Add Goal'}</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={!!goalToDelete} onOpenChange={(open) => !open && setGoalToDelete(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the savings goal "{goalToDelete?.name}".</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => setGoalToDelete(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteGoal}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function SavingsPage() {
    return (
        <MainLayout>
            <Savings />
        </MainLayout>
    )
}
