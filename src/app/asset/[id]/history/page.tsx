
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
import { Loader2, ChevronLeft, CalendarIcon, Info, CandlestickChart, DollarSign, TrendingUp, Edit, Trash2 } from 'lucide-react';
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
type AssetType = 'savings' | 'investment' | 'real_estate' | 'other';
type Contribution = { id: string; amount: number; date: Date; };
type ValueChange = { id: string; value: number; date: Date; };
type Asset = { id: string; userId: string; name: string; type: AssetType; currency: string; valueHistory: ValueChange[]; contributions: Contribution[]; };
type FilterType = 'all' | 'contribution' | 'value_update';

type AssetEvent = {
  id: string;
  date: Date;
  type: 'Contribution' | 'Initial Value' | 'Value Update';
  amount: number;
  isContribution: boolean;
  original: Contribution | ValueChange;
};

const contributionSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Contribution amount must be positive.'),
  date: z.date({
    required_error: "A date for the contribution is required.",
  }),
});

const valueChangeSchema = z.object({
  value: z.coerce.number().min(0, 'Value must be a positive number.'),
  date: z.date({
    required_error: "A date for the value update is required.",
  }),
});

const transactionIcons: Record<string, React.ReactNode> = {
    'Initial Value': <CandlestickChart className="h-5 w-5 text-muted-foreground" />,
    'Contribution': <DollarSign className="h-5 w-5 text-muted-foreground" />,
    'Value Update': <TrendingUp className="h-5 w-5 text-muted-foreground" />,
}

// Main Component
function AssetHistory() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const assetId = params.id as string;
  const { toast } = useToast();
  const { currency } = useCurrency();
  
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  
  const [isContribDialogOpen, setIsContribDialogOpen] = useState(false);
  const [isValueUpdateDialogOpen, setIsValueUpdateDialogOpen] = useState(false);
  
  const [isDeleteContribConfirmOpen, setIsDeleteContribConfirmOpen] = useState(false);
  const [isDeleteValueConfirmOpen, setIsDeleteValueConfirmOpen] = useState(false);
  
  const [editingContribution, setEditingContribution] = useState<Contribution | null>(null);
  const [contributionToDelete, setContributionToDelete] = useState<Contribution | null>(null);
  
  const [editingValueChange, setEditingValueChange] = useState<ValueChange | null>(null);
  const [valueChangeToDelete, setValueChangeToDelete] = useState<ValueChange | null>(null);

  const contributionForm = useForm<z.infer<typeof contributionSchema>>({ resolver: zodResolver(contributionSchema) });
  const valueChangeForm = useForm<z.infer<typeof valueChangeSchema>>({ resolver: zodResolver(valueChangeSchema) });


  async function fetchAsset() {
    if (!assetId || !user) return;
    setLoading(true);
    const assetRef = doc(db, 'assets', assetId);
    const assetSnap = await getDoc(assetRef);

    if (assetSnap.exists()) {
        const data = assetSnap.data();
        if (data.userId !== user.uid) {
            toast({ variant: 'destructive', title: 'Access Denied' });
            router.push('/assets');
            return;
        }
        const assetData = {
            id: assetSnap.id,
            ...data,
            currency: data.currency || 'USD',
            valueHistory: (data.valueHistory || []).map((v: any) => ({ ...v, date: v.date.toDate() })),
            contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
        } as Asset;
        setAsset(assetData);
        if (assetData.valueHistory.length > 0) {
            const sortedHistory = [...assetData.valueHistory].sort((a,b) => a.date.getTime() - b.date.getTime());
            setDateRange({ from: sortedHistory[0].date, to: new Date() });
        }
    } else {
        toast({ variant: 'destructive', title: 'Not Found'});
        router.push('/assets');
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchAsset();
  }, [assetId, user, router, toast]);

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
    if (isValueUpdateDialogOpen) {
      if (editingValueChange) {
        valueChangeForm.reset(editingValueChange);
      } else {
        const latestValue = asset?.valueHistory.sort((a,b) => b.date.getTime() - a.date.getTime())[0]?.value || 0;
        valueChangeForm.reset({ value: latestValue, date: new Date() });
      }
    }
  }, [editingValueChange, isValueUpdateDialogOpen, valueChangeForm, asset]);

  const handleContributionSubmit = async (values: z.infer<typeof contributionSchema>) => {
    if (!asset) return;

    let updatedContributions;
    if (editingContribution) {
      updatedContributions = asset.contributions.map(c => 
        c.id === editingContribution.id ? { ...c, ...values } : c
      );
    } else {
      const newContribution = { ...values, id: crypto.randomUUID() };
      updatedContributions = [...asset.contributions, newContribution];
    }
    
    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { contributions: updatedContributions });
        toast({ title: editingContribution ? "Contribution Updated" : "Contribution Added" });
        fetchAsset();
    } catch(error) {
        console.error("Error saving contribution: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not save contribution." });
    } finally {
        setIsContribDialogOpen(false);
        setEditingContribution(null);
    }
  };

  const handleDeleteContribution = async () => {
    if (!asset || !contributionToDelete) return;
    
    const updatedContributions = asset.contributions.filter(c => c.id !== contributionToDelete.id);

    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { contributions: updatedContributions });
        toast({ title: "Contribution Deleted" });
        fetchAsset();
    } catch (error) {
        console.error("Error deleting contribution: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not delete contribution." });
    } finally {
        setIsDeleteContribConfirmOpen(false);
        setContributionToDelete(null);
    }
  };
  
  const handleValueUpdateSubmit = async (values: z.infer<typeof valueChangeSchema>) => {
    if (!asset) return;

    let updatedValueHistory;
    if (editingValueChange) {
      updatedValueHistory = asset.valueHistory.map(v => 
        v.id === editingValueChange.id ? { ...v, ...values } : v
      );
    } else {
      const newValueChange = { ...values, id: crypto.randomUUID() };
      updatedValueHistory = [...asset.valueHistory, newValueChange];
    }
    
    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { valueHistory: updatedValueHistory });
        toast({ title: editingValueChange ? "Value Updated" : "Value Added" });
        fetchAsset();
    } catch(error) {
        console.error("Error saving value update: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not save value update." });
    } finally {
        setIsValueUpdateDialogOpen(false);
        setEditingValueChange(null);
    }
  };

  const handleDeleteValueChange = async () => {
    if (!asset || !valueChangeToDelete) return;
    
    if (asset.valueHistory.length <= 1) {
        toast({ variant: 'destructive', title: "Error", description: "An asset must have at least one value entry." });
        setIsDeleteValueConfirmOpen(false);
        setValueChangeToDelete(null);
        return;
    }

    const updatedValueHistory = asset.valueHistory.filter(v => v.id !== valueChangeToDelete.id);

    try {
        const assetRef = doc(db, "assets", asset.id);
        await updateDoc(assetRef, { valueHistory: updatedValueHistory });
        toast({ title: "Value entry deleted" });
        fetchAsset();
    } catch (error) {
        console.error("Error deleting value entry: ", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not delete value entry." });
    } finally {
        setIsDeleteValueConfirmOpen(false);
        setValueChangeToDelete(null);
    }
  };
  

  const filteredEvents = useMemo(() => {
    if (!asset) return [];

    const sortedHistory = [...asset.valueHistory].sort((a, b) => a.date.getTime() - b.date.getTime());
    
    const contributionEvents: AssetEvent[] = asset.contributions.map(c => ({
      id: c.id,
      date: c.date,
      type: 'Contribution',
      amount: c.amount,
      isContribution: true,
      original: c,
    }));
    
    const valueUpdateEvents: AssetEvent[] = sortedHistory.map((vc, index) => ({
      id: vc.id,
      date: vc.date,
      type: (index === 0 ? 'Initial Value' : 'Value Update'),
      amount: vc.value,
      isContribution: false,
      original: vc,
    }));

    const allEvents = [...contributionEvents, ...valueUpdateEvents];

    return allEvents
      .filter(e => {
        if (typeFilter === 'contribution') return e.isContribution;
        if (typeFilter === 'value_update') return !e.isContribution;
        return true;
      })
      .filter(e => {
        if (!dateRange?.from) return true;
        const toDate = dateRange.to || dateRange.from;
        return isWithinInterval(e.date, { start: dateRange.from, end: toDate });
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [asset, dateRange, typeFilter]);

  if (loading) {
     return (<><Header title="Loading History..." /><main className="flex-1 p-4 sm:p-6 text-center"><Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" /></main></>)
  }

  if (!asset) return null;

  return (
    <>
      <Header title={`${asset.name} History`} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <div className="flex justify-start">
                <Button asChild variant="outline">
                    <Link href={`/asset/${asset.id}`}><ChevronLeft className="mr-2 h-4 w-4" />Back to Asset</Link>
                </Button>
            </div>
            
            <Card>
                <CardHeader><CardTitle>Filter Events</CardTitle></CardHeader>
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
                                <SelectItem value="all">All Event Types</SelectItem>
                                <SelectItem value="contribution">Contributions</SelectItem>
                                <SelectItem value="value_update">Value Updates</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>
            
            <Card>
                <CardHeader><CardTitle>Results</CardTitle><CardDescription>Found {filteredEvents.length} event(s).</CardDescription></CardHeader>
                <CardContent>
                    {filteredEvents.length > 0 ? (
                        <Table>
                            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount / Value</TableHead><TableHead className="text-right w-[100px]">Actions</TableHead></TableRow></TableHeader>
                            <TableBody>
                            {filteredEvents.map(event => {
                                const amountColor = event.isContribution ? (event.amount > 0 ? 'text-green-400' : 'text-red-400') : '';
                                return (
                                    <TableRow key={event.id}>
                                        <TableCell>{format(event.date, 'PP')}</TableCell>
                                        <TableCell><div className="flex items-center gap-2">{transactionIcons[event.type]}<span className="font-medium">{event.type}</span></div></TableCell>
                                        <TableCell className={cn('text-right font-mono', amountColor)}>{formatCurrency(event.amount, asset.currency)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => { 
                                                if (event.isContribution) { setEditingContribution(event.original as Contribution); setIsContribDialogOpen(true); } 
                                                else { setEditingValueChange(event.original as ValueChange); setIsValueUpdateDialogOpen(true); }
                                            }}><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" onClick={() => { 
                                                if (event.isContribution) { setContributionToDelete(event.original as Contribution); setIsDeleteContribConfirmOpen(true); } 
                                                else { setValueChangeToDelete(event.original as ValueChange); setIsDeleteValueConfirmOpen(true); }
                                            }}><Trash2 className="h-4 w-4" /></Button>
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
                            <AlertDescription>No events match your current filters. Try adjusting the date range or type.</AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>
        </div>
      </main>

       {/* Contribution Add/Edit Dialog */}
       <Dialog open={isContribDialogOpen} onOpenChange={setIsContribDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingContribution ? 'Edit Contribution' : 'Add Contribution'}</DialogTitle>
          </DialogHeader>
          <Form {...contributionForm}>
            <form onSubmit={contributionForm.handleSubmit(handleContributionSubmit)} className="space-y-4 py-4">
              <FormField control={contributionForm.control} name="amount" render={({ field }) => (
                <FormItem><FormLabel>Amount ({asset.currency})</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>
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
                <Button type="submit">{editingContribution ? 'Update' : 'Add'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Value Update Add/Edit Dialog */}
      <Dialog open={isValueUpdateDialogOpen} onOpenChange={setIsValueUpdateDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingValueChange ? 'Edit Value' : 'Add Value Update'}</DialogTitle>
          </DialogHeader>
          <Form {...valueChangeForm}>
            <form onSubmit={valueChangeForm.handleSubmit(handleValueUpdateSubmit)} className="space-y-4 py-4">
              <FormField control={valueChangeForm.control} name="value" render={({ field }) => (
                <FormItem><FormLabel>New Total Value ({asset.currency})</FormLabel><FormControl><Input type="number" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={valueChangeForm.control} name="date" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date of Value</FormLabel>
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
                <Button type="button" variant="outline" onClick={() => setIsValueUpdateDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingValueChange ? 'Update' : 'Add'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Delete Contribution Confirmation */}
      <AlertDialog open={isDeleteContribConfirmOpen} onOpenChange={setIsDeleteContribConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete this contribution record.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setContributionToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContribution}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Value Confirmation */}
      <AlertDialog open={isDeleteValueConfirmOpen} onOpenChange={setIsDeleteValueConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete this value entry.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setValueChangeToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteValueChange}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AssetHistoryPage() {
    return (
        <MainLayout>
            <AssetHistory />
        </MainLayout>
    );
}
