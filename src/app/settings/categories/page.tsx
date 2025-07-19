
'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, List, PlusCircle, Edit, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { defaultAssetTypes, defaultExpenseCategories, defaultIncomeCategories, DefaultCategory } from '@/lib/categories';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { IconPicker } from '@/components/ui/icon-picker';
import { ColorPicker } from '@/components/ui/color-picker';
import DynamicIcon from '@/components/dynamic-icon';
import { Separator } from '@/components/ui/separator';

const categorySchema = z.object({
  name: z.string().min(1, 'Category name is required.'),
  icon: z.string().min(1, 'An icon is required.'),
  color: z.string().min(1, 'A color is required.'),
});

type Category = {
  id: string;
  userId?: string;
  name: string;
  icon: string;
  color: string;
  isDefault?: boolean;
};

type CategoryManagerProps = {
    title: string;
    description: string;
    collectionName: 'expenseCategories' | 'incomeCategories' | 'assetTypes';
    defaultCategories: DefaultCategory[];
};

function CategoryManager({ title, description, collectionName, defaultCategories }: CategoryManagerProps) {
    const user = useAuth();
    const { toast } = useToast();
    const [customCategories, setCustomCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

    const form = useForm<z.infer<typeof categorySchema>>({
        resolver: zodResolver(categorySchema),
        defaultValues: { name: '', icon: 'Paperclip', color: 'hsl(var(--chart-1))' },
    });
    
    const mappedDefaultCategories: Category[] = defaultCategories.map(cat => ({
        ...cat,
        id: `default-${collectionName}-${cat.name.replace(/\s+/g, '-')}`,
        isDefault: true,
    })).sort((a,b) => a.name.localeCompare(b.name));

    async function fetchCategories() {
        if (!user) return;
        setLoading(true);

        const customCategoriesQuery = query(collection(db, collectionName), where('userId', '==', user.uid));
        const querySnapshot = await getDocs(customCategoriesQuery);
        const fetchedCustomCategories = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...(doc.data() as Omit<Category, 'id'>)
        })).sort((a,b) => a.name.localeCompare(b.name));

        setCustomCategories(fetchedCustomCategories);
        setLoading(false);
    }

    useEffect(() => {
        if (user) {
            fetchCategories();
        }
    }, [user, collectionName]);
    
    useEffect(() => {
        if (isDialogOpen) {
            form.reset({
                name: editingCategory?.name || '',
                icon: editingCategory?.icon || 'Paperclip',
                color: editingCategory?.color || 'hsl(var(--chart-1))',
            });
        }
    }, [isDialogOpen, editingCategory, form]);
    
    const handleFormSubmit = async (values: z.infer<typeof categorySchema>) => {
        if (!user) return;
        try {
            if (editingCategory) {
                const categoryRef = doc(db, collectionName, editingCategory.id);
                await updateDoc(categoryRef, { name: values.name, icon: values.icon, color: values.color });
                toast({ title: 'Category Updated' });
            } else {
                await addDoc(collection(db, collectionName), { ...values, userId: user.uid });
                toast({ title: 'Category Added' });
            }
            setIsDialogOpen(false);
            setEditingCategory(null);
            fetchCategories();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save category.' });
        }
    };
    
    const handleDeleteCategory = async () => {
        if (!categoryToDelete) return;
        try {
            await deleteDoc(doc(db, collectionName, categoryToDelete.id));
            toast({ title: 'Category Deleted' });
            setCategoryToDelete(null);
            setIsDeleteConfirmOpen(false);
            fetchCategories();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete category.' });
        }
    }
    
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? <div className="flex justify-center items-center py-12"><Loader2 className="animate-spin" /></div> : (
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-medium text-muted-foreground">Your Custom Types</h3>
                                <Button size="sm" variant="outline" onClick={() => { setEditingCategory(null); setIsDialogOpen(true); }}>
                                    <PlusCircle className="mr-2 h-4 w-4" /> Add
                                </Button>
                            </div>
                            {customCategories.length > 0 ? (
                                <ul className="space-y-2">
                                   {customCategories.map(cat => (
                                     <li key={cat.id} className="flex items-center justify-between rounded-md border p-2 pl-4">
                                        <div className="flex items-center gap-3">
                                            <DynamicIcon name={cat.icon} className="h-5 w-5" style={{ color: cat.color }} />
                                            <span className="font-medium">{cat.name}</span>
                                        </div>
                                         <div className="flex items-center -mr-2">
                                           <Button variant="ghost" size="icon" onClick={() => { setEditingCategory(cat); setIsDialogOpen(true); }}><Edit className="h-4 w-4" /></Button>
                                           <Button variant="ghost" size="icon" onClick={() => { setCategoryToDelete(cat); setIsDeleteConfirmOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                                         </div>
                                     </li>
                                   ))}
                                </ul>
                            ) : (
                                <div className="text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg p-6">
                                    <p>No custom types yet.</p>
                                </div>
                            )}
                        </div>
                        
                        <Separator />

                        <div>
                            <h3 className="text-sm font-medium text-muted-foreground mb-2">Default Types</h3>
                             <ul className="space-y-2">
                               {mappedDefaultCategories.map(cat => (
                                 <li key={cat.id} className="flex items-center justify-between rounded-md border p-2 pl-4 bg-muted/40">
                                    <div className="flex items-center gap-3">
                                        <DynamicIcon name={cat.icon} className="h-5 w-5" style={{ color: cat.color }} />
                                        <span className="font-medium text-muted-foreground">{cat.name}</span>
                                    </div>
                                 </li>
                               ))}
                            </ul>
                        </div>
                    </div>
                )}
            </CardContent>

             <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingCategory ? `Edit ${title.slice(0,-1)}` : `Add New ${title.slice(0,-1)}`}</DialogTitle>
                    </DialogHeader>
                     <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4 py-4">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="icon" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Icon</FormLabel>
                                    <FormControl>
                                        <IconPicker value={field.value} onChange={field.onChange} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="color" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Color</FormLabel>
                                    <FormControl>
                                        <ColorPicker value={field.value} onChange={field.onChange} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                                <Button type="submit">{editingCategory ? 'Update' : 'Add'}</Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
            
             <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>Deleting this will not delete associated items, but they will lose this type assignment.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setCategoryToDelete(null)}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteCategory}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
        </Card>
    )
}

function CategoriesSettings() {
    return (
        <>
            <Header title="Category Settings" />
            <main className="flex-1 space-y-6 p-4 sm:p-6">
                <div className="max-w-7xl mx-auto w-full grid gap-6 md:grid-cols-1 lg:grid-cols-2">
                    <div className="space-y-6">
                        <CategoryManager 
                            title="Asset Types" 
                            description="Manage the types of assets you can create."
                            collectionName="assetTypes"
                            defaultCategories={defaultAssetTypes}
                        />
                         <CategoryManager 
                            title="Income Categories" 
                            description="Manage your custom income categories."
                            collectionName="incomeCategories"
                            defaultCategories={defaultIncomeCategories}
                        />
                    </div>
                    <CategoryManager 
                        title="Expense Categories" 
                        description="Manage your custom expense categories."
                        collectionName="expenseCategories"
                        defaultCategories={defaultExpenseCategories}
                    />
                </div>
            </main>
        </>
    );
}

export default function CategoriesSettingsPage() {
    return (
        <MainLayout>
            <CategoriesSettings />
        </MainLayout>
    )
}
