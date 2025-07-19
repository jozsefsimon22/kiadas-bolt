
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Banknote, Edit, Loader2, PlusCircle, Trash2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';

type LiabilityType = 'credit_card' | 'loan' | 'mortgage' | 'other';
type Liability = {
  id: string;
  userId: string;
  name: string;
  type: LiabilityType;
  currentBalance: number;
  apr: number;
};

const liabilitySchema = z.object({
  name: z.string().min(1, 'Liability name is required.'),
  type: z.enum(['credit_card', 'loan', 'mortgage', 'other'], {
    required_error: "You need to select a liability type.",
  }),
  currentBalance: z.coerce.number().min(0, 'Current balance must be a positive number.'),
  apr: z.coerce.number().min(0, 'APR must be a positive number.'),
});

const liabilityIcons: Record<LiabilityType, React.ReactNode> = {
  credit_card: <Banknote className="h-6 w-6 text-muted-foreground" />,
  loan: <Banknote className="h-6 w-6 text-muted-foreground" />,
  mortgage: <Banknote className="h-6 w-6 text-muted-foreground" />,
  other: <Banknote className="h-6 w-6 text-muted-foreground" />,
};

function Liabilities() {
  const user = useAuth();
  const { currency } = useCurrency();
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLiability, setEditingLiability] = useState<Liability | null>(null);
  const [liabilityToDelete, setLiabilityToDelete] = useState<Liability | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof liabilitySchema>>({
    resolver: zodResolver(liabilitySchema),
    defaultValues: {
      name: '',
      currentBalance: 0,
      apr: 0,
    },
  });

  async function fetchData() {
    if (!user) return;
    setIsDataLoading(true);
    try {
        const liabilitiesQuery = query(collection(db, 'liabilities'), where('userId', '==', user.uid));
        const liabilitiesSnapshot = await getDocs(liabilitiesQuery);
        const liabilitiesList = liabilitiesSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
            } as Liability;
        }).sort((a,b) => b.currentBalance - a.currentBalance);
        setLiabilities(liabilitiesList);
    } catch (error) {
        console.error("Error fetching data:", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not load your data." });
    } finally {
        setIsDataLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [user]);
  
  useEffect(() => {
    if (editingLiability) {
      form.reset(editingLiability);
    } else {
      form.reset({ name: '', type: 'credit_card', currentBalance: 0, apr: 0 });
    }
  }, [editingLiability, form, isDialogOpen]);

  const totalLiabilities = useMemo(() => {
    return liabilities.reduce((total, liability) => total + liability.currentBalance, 0);
  }, [liabilities]);

  const handleDeleteLiability = async () => {
    if (!liabilityToDelete) return;
    try {
      await deleteDoc(doc(db, "liabilities", liabilityToDelete.id));
      toast({ title: "Liability Deleted", description: `"${liabilityToDelete.name}" has been removed.` });
      setLiabilityToDelete(null);
      fetchData(); 
    } catch (error) {
      console.error("Error deleting liability: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not delete liability." });
    }
  };

  const handleFormSubmit = async (values: z.infer<typeof liabilitySchema>) => {
    if (!user) return;
    try {
      if (editingLiability) {
        const liabilityRef = doc(db, "liabilities", editingLiability.id);
        const payload = { ...values, userId: editingLiability.userId };
        await updateDoc(liabilityRef, payload);
        toast({ title: "Liability Updated", description: "Your liability has been successfully updated." });
      } else {
        await addDoc(collection(db, "liabilities"), { ...values, userId: user.uid });
        toast({ title: "Liability Added", description: "Your new liability has been successfully added." });
      }
      setEditingLiability(null);
      setIsDialogOpen(false);
      fetchData();
    } catch(error) {
      console.error("Error saving liability: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not save liability." });
    }
  };
  
  const openAddDialog = () => {
    setEditingLiability(null);
    setIsDialogOpen(true);
  };
  
  const openEditDialog = (liability: Liability) => {
    setEditingLiability(liability);
    setIsDialogOpen(true);
  };
  
  const openDeleteDialog = (liability: Liability) => {
    setLiabilityToDelete(liability);
  };

  const formatLiabilityType = (type: LiabilityType) => {
    if (!type) return 'Other';
    return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  return (
    <>
      <Header title="Liabilities" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <Card>
                <CardHeader>
                <CardTitle>Total Debt</CardTitle>
                <CardDescription>This is the combined balance of all your liabilities.</CardDescription>
                </CardHeader>
                <CardContent>
                {isDataLoading ? <Skeleton className="h-10 w-3/4" /> :
                    <p className="text-4xl font-bold tracking-tight text-destructive">
                    {formatCurrency(totalLiabilities, currency)}
                    </p>
                }
                </CardContent>
            </Card>

            <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <CardTitle>Your Liabilities</CardTitle>
                        <CardDescription>A list of your current loans, credit cards, and other debts.</CardDescription>
                    </div>
                    <Button onClick={openAddDialog} className="w-full sm:w-auto">
                        <PlusCircle /> Add Liability
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {isDataLoading ? (
                    <div className="flex justify-center items-center py-12">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : liabilities.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">No liabilities yet. Add one to get started!</div>
                ) : (
                    <>
                    {/* Mobile View */}
                    <div className="space-y-4 md:hidden">
                        {liabilities.map(liability => (
                            <Card key={liability.id} className="p-4">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-3 font-medium">
                                        {liabilityIcons[liability.type]}
                                        <div>
                                            <p>{liability.name}</p>
                                            <p className="text-sm text-muted-foreground">{formatLiabilityType(liability.type)}</p>
                                        </div>
                                    </div>
                                    <div className="flex -mr-2 -mt-2">
                                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(liability)}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(liability)}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-muted-foreground">Balance</p>
                                        <p className="font-mono text-destructive">{formatCurrency(liability.currentBalance, currency)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-muted-foreground">APR</p>
                                        <p className="font-mono">{liability.apr.toFixed(2)}%</p>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>

                    {/* Desktop View */}
                    <Table className="hidden md:table">
                        <TableHeader>
                            <TableRow>
                            <TableHead>Liability</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Current Balance</TableHead>
                            <TableHead className="text-right">APR</TableHead>
                            <TableHead className="text-right w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {liabilities.map(liability => (
                                <TableRow key={liability.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                        {liabilityIcons[liability.type]}
                                        <span className="font-medium">{liability.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{formatLiabilityType(liability.type)}</TableCell>
                                    <TableCell className="text-right font-mono text-destructive">{formatCurrency(liability.currentBalance, currency)}</TableCell>
                                    <TableCell className="text-right font-mono">{liability.apr.toFixed(2)}%</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(liability)}>
                                        <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(liability)}>
                                        <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    </>
                )}
            </CardContent>
            </Card>
        </div>
      </main>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLiability ? 'Edit Liability' : 'Add New Liability'}</DialogTitle>
            <DialogDescription>
              {editingLiability ? 'Update the details of your liability.' : 'Enter the details of your new liability to track it.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4 py-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Liability Name</FormLabel>
                    <FormControl><Input placeholder="e.g., Student Loan" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Liability Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select a liability type" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="credit_card">Credit Card</SelectItem>
                        <SelectItem value="loan">Loan</SelectItem>
                        <SelectItem value="mortgage">Mortgage</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="currentBalance" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Balance</FormLabel>
                      <FormControl><Input type="number" placeholder="5000" {...field} onFocus={(e) => e.target.select()} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField control={form.control} name="apr" render={({ field }) => (
                    <FormItem>
                      <FormLabel>APR (%)</FormLabel>
                      <FormControl><Input type="number" placeholder="5.25" {...field} onFocus={(e) => e.target.select()} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingLiability ? 'Update Liability' : 'Add Liability'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!liabilityToDelete} onOpenChange={(open) => !open && setLiabilityToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the liability "{liabilityToDelete?.name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLiabilityToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLiability}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function LiabilitiesPage() {
    return (
        <MainLayout>
            <Liabilities />
        </MainLayout>
    )
}
