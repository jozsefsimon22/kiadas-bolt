
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { AlertTriangle, KeyRound, Loader2, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { auth, db } from '@/lib/firebase';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, updateProfile, deleteUser } from 'firebase/auth';
import { collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRouter } from 'next/navigation';

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters.'),
  confirmPassword: z.string(),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "New passwords don't match.",
  path: ['confirmPassword'],
});

const profileSchema = z.object({
    displayName: z.string().min(1, 'Display name is required.').max(50, 'Display name is too long.'),
});

const deleteAccountSchema = z.object({
    password: z.string().min(1, 'Password is required to confirm deletion.'),
});

function AccountSettings() {
  const user = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const passwordForm = useForm<z.infer<typeof passwordChangeSchema>>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const profileForm = useForm<z.infer<typeof profileSchema>>({
      resolver: zodResolver(profileSchema),
      defaultValues: { displayName: '' },
  });
  
  const deleteAccountForm = useForm<z.infer<typeof deleteAccountSchema>>({
      resolver: zodResolver(deleteAccountSchema),
      defaultValues: { password: '' },
  });
  
  useEffect(() => {
    if (user) {
        profileForm.reset({ displayName: user.displayName || '' });
    }
  }, [user, profileForm]);

  const handleChangePassword = async (values: z.infer<typeof passwordChangeSchema>) => {
    if (!user || !user.email) {
        toast({ variant: 'destructive', title: 'Error', description: 'User not found.' });
        return;
    }
    setPasswordLoading(true);
    try {
        const credential = EmailAuthProvider.credential(user.email, values.currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, values.newPassword);
        toast({ title: 'Success', description: 'Your password has been updated. You will be logged out for security.' });
        passwordForm.reset();
        setTimeout(() => auth.signOut(), 2000);
    } catch (error: any) {
        console.error("Password change error:", error);
        let description = 'An unexpected error occurred.';
        if (error.code === 'auth/wrong-password') {
            description = 'The current password you entered is incorrect.';
        }
        toast({ variant: 'destructive', title: 'Password Change Failed', description });
    } finally {
        setPasswordLoading(false);
    }
  };

  const handleProfileUpdate = async (values: z.infer<typeof profileSchema>) => {
      if (!user) return;
      setProfileLoading(true);
      try {
          await updateProfile(user, { displayName: values.displayName });
          toast({ title: 'Success', description: 'Your display name has been updated.' });
      } catch (error: any) {
          console.error("Profile update error:", error);
          toast({ variant: 'destructive', title: 'Update Failed', description: 'Could not update your display name.' });
      } finally {
          setProfileLoading(false);
      }
  };

  const handleAccountDelete = async (values: z.infer<typeof deleteAccountSchema>) => {
      if (!user || !user.email) {
        toast({ variant: 'destructive', title: 'Error', description: 'User not found.' });
        return;
      }
      setDeleteLoading(true);

      try {
        // 1. Re-authenticate
        const credential = EmailAuthProvider.credential(user.email, values.password);
        await reauthenticateWithCredential(user, credential);

        // 2. Delete all Firestore data
        const collectionsToDelete = ['transactions', 'assets', 'liabilities', 'savings', 'expenseCategories', 'incomeCategories'];
        const batch = writeBatch(db);

        for (const collectionName of collectionsToDelete) {
            const q = query(collection(db, collectionName), where('userId', '==', user.uid));
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach((doc) => {
                batch.delete(doc.ref);
            });
        }
        await batch.commit();

        // 3. Delete user from Auth
        await deleteUser(user);

        toast({ title: 'Account Deleted', description: 'Your account and all data have been permanently deleted.' });
        router.push('/login');

      } catch (error: any) {
        console.error("Account deletion error:", error);
        let description = 'An unexpected error occurred.';
        if (error.code === 'auth/wrong-password') {
            description = 'The password you entered is incorrect.';
        } else if (error.code === 'auth/requires-recent-login') {
            description = 'This is a sensitive operation. Please log out and log back in before deleting your account.';
        }
        toast({ variant: 'destructive', title: 'Deletion Failed', description });
      } finally {
          setDeleteLoading(false);
      }
  };


  return (
    <>
      <Header title="Account Settings" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto w-full grid md:grid-cols-2 gap-6">
             <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><User className="h-6 w-6" />Profile Information</CardTitle>
                    <CardDescription>Update your display name.</CardDescription>
                </CardHeader>
                <Form {...profileForm}>
                    <form onSubmit={profileForm.handleSubmit(handleProfileUpdate)}>
                        <CardContent>
                             <FormField control={profileForm.control} name="displayName" render={({ field }) => (<FormItem><FormLabel>Display Name</FormLabel><FormControl><Input placeholder="Your Name" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" disabled={profileLoading}>{profileLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Changes</Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><KeyRound className="h-6 w-6" />Change Password</CardTitle>
                    <CardDescription>Update your password here. After a successful password update, you will be logged out for security purposes.</CardDescription>
                </CardHeader>
                <Form {...passwordForm}>
                    <form onSubmit={passwordForm.handleSubmit(handleChangePassword)}>
                        <CardContent className="space-y-4">
                             <FormField control={passwordForm.control} name="currentPassword" render={({ field }) => (<FormItem><FormLabel>Current Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>)} />
                             <FormField control={passwordForm.control} name="newPassword" render={({ field }) => (<FormItem><FormLabel>New Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>)} />
                             <FormField control={passwordForm.control} name="confirmPassword" render={({ field }) => (<FormItem><FormLabel>Confirm New Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" disabled={passwordLoading}>{passwordLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update Password</Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>

            <Card className="border-destructive md:col-span-2">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-6 w-6" />Danger Zone</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Deleting your account will permanently remove all your data, including transactions, assets, liabilities, and savings goals. This action is irreversible.
                    </p>
                </CardContent>
                <CardFooter>
                    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive">Delete My Account</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently delete your account and all associated data. To confirm, please enter your password.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <Form {...deleteAccountForm}>
                                <form id="delete-account-form" onSubmit={deleteAccountForm.handleSubmit(handleAccountDelete)}>
                                    <FormField
                                      control={deleteAccountForm.control}
                                      name="password"
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Password</FormLabel>
                                          <FormControl>
                                            <Input type="password" {...field} autoFocus />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                </form>
                            </Form>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <Button
                                    type="submit"
                                    form="delete-account-form"
                                    variant="destructive"
                                    disabled={deleteLoading}
                                >
                                    {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Delete Account and All Data
                                </Button>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </CardFooter>
            </Card>
        </div>
      </main>
    </>
  );
}

export default function AccountSettingsPage() {
    return (
        <MainLayout>
            <AccountSettings />
        </MainLayout>
    )
}
