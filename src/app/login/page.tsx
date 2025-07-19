
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/logo';
import { Checkbox } from '@/components/ui/checkbox';

const loginSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters long.' }),
});

const signupSchema = z.object({
  displayName: z.string().min(1, 'Display name is required.'),
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters long.' }),
  terms: z.boolean().refine((val) => val === true, {
      message: 'You must accept the Terms and Conditions to create an account.',
  }),
});

type LoginFormData = z.infer<typeof loginSchema>;
type SignupFormData = z.infer<typeof signupSchema>;

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg {...props} viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
      <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
      <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.22,0-9.655-3.449-11.303-8H4.697C6.462,38.233,14.478,44,24,44z"/>
      <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.089,5.571l6.19,5.238C42.018,36.477,44,30.659,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
    </svg>
);


export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loadingProvider, setLoadingProvider] = useState<'email' | 'google' | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: '', email: '', password: '', terms: false },
  });

  const termsAccepted = signupForm.watch('terms');

  const handleLoginSubmit = async (values: LoginFormData) => {
    setLoadingProvider('email');
    try {
      const userCredential = await signInWithEmailAndPassword(auth, values.email, values.password);
      if (!userCredential.user.emailVerified) {
          await signOut(auth);
          toast({
              variant: 'destructive',
              title: 'Email Not Verified',
              description: 'Please check your inbox and click the verification link before logging in.'
          });
      } else {
          toast({ title: 'Login Successful', description: "Welcome back!" });
          router.push('/dashboard');
      }
    } catch (error: any) {
      console.error(error);
      let description = 'An unexpected error occurred. Please try again.';
      switch (error.code) {
        case 'auth/invalid-credential':
          description = 'Incorrect email or password. Please try again.';
          break;
        default:
            const errorCode = error.code || 'unknown-error';
            description = `An error occurred: ${errorCode.replace('auth/', '').replace(/-/g, ' ')}.`;
            break;
      }
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: description,
      });
    } finally {
      setLoadingProvider(null);
    }
  };
  
  const handleSignupSubmit = async (values: SignupFormData) => {
    setLoadingProvider('email');
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
      await updateProfile(userCredential.user, { displayName: values.displayName });
      
      const userDocRef = doc(db, 'users', userCredential.user.uid);
      await setDoc(userDocRef, { households: [] });

      await sendEmailVerification(userCredential.user);
      await signOut(auth);
      toast({ title: 'Account Created', description: 'Success! Please check your inbox to verify your email address before logging in.' });
      setActiveTab('login');
      signupForm.reset();
    } catch (error: any) {
      console.error(error);
      let description = 'An unexpected error occurred. Please try again.';
      switch (error.code) {
        case 'auth/email-already-in-use':
          description = 'An account with this email already exists. Please log in instead.';
          break;
        case 'auth/weak-password':
          description = 'The password is too weak. Please use at least 6 characters.';
          break;
        default:
            const errorCode = error.code || 'unknown-error';
            description = `An error occurred: ${errorCode.replace('auth/', '').replace(/-/g, ' ')}.`;
            break;
      }
      toast({
        variant: 'destructive',
        title: 'Sign Up Failed',
        description: description,
      });
    } finally {
      setLoadingProvider(null);
    }
  };
  
  const handleOAuthSignIn = async (providerName: 'google') => {
    setLoadingProvider(providerName);
    const provider = new GoogleAuthProvider();
    
    try {
        await signInWithPopup(auth, provider);
        toast({ title: 'Login Successful', description: "Welcome!" });
        router.push('/dashboard');
    } catch (error: any) {
        console.error(error);
        let description = 'An unexpected error occurred. Please try again.';
        const providerTitle = providerName.charAt(0).toUpperCase() + providerName.slice(1);

        switch (error.code) {
            case 'auth/account-exists-with-different-credential':
                description = 'An account already exists with the same email address but different sign-in credentials. Please sign in using the original method.';
                break;
            case 'auth/popup-closed-by-user':
                description = 'The sign-in window was closed before completing. Please try again.';
                break;
            default:
                const errorCode = error.code || 'unknown-error';
                description = `An error occurred: ${errorCode.replace('auth/', '').replace(/-/g, ' ')}.`;
                break;
        }
        toast({
            variant: 'destructive',
            title: `${providerTitle} Sign-In Failed`,
            description: description,
        });
    } finally {
        setLoadingProvider(null);
    }
  };


  const handlePasswordReset = async () => {
    if (!resetEmail) {
        toast({ variant: 'destructive', title: 'Email Required', description: 'Please enter your email address.' });
        return;
    }
    setResetLoading(true);
    try {
        await sendPasswordResetEmail(auth, resetEmail);
        toast({ title: 'Check Your Email', description: 'A password reset link has been sent.' });
        setIsResetDialogOpen(false);
        setResetEmail('');
    } catch (error: any) {
        console.error(error);
        const errorCode = error.code || 'auth/unknown-error';
        const errorMessage = errorCode.replace('auth/', '').replace(/-/g, ' ');
        toast({ variant: 'destructive', title: 'Error', description: `Could not send reset email: ${errorMessage}` });
    } finally {
        setResetLoading(false);
    }
  };


  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
       <div className="mb-8 flex items-center gap-2">
            <Logo className="h-8 w-8" />
            <h1 className="text-3xl font-bold tracking-tight text-primary">Kiadas</h1>
        </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome!</CardTitle>
          <CardDescription>Sign in or create an account to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
                <Form {...loginForm}>
                    <form onSubmit={loginForm.handleSubmit(handleLoginSubmit)} className="space-y-6 pt-4">
                        <FormField control={loginForm.control} name="email" render={({ field }) => (
                            <FormItem><FormLabel>Email</FormLabel><FormControl><Input placeholder="you@example.com" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={loginForm.control} name="password" render={({ field }) => (
                            <FormItem>
                                <div className="flex justify-between items-center">
                                    <FormLabel>Password</FormLabel>
                                    <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => setIsResetDialogOpen(true)}>
                                        Forgot password?
                                    </Button>
                                </div>
                                <FormControl><Input type="password" placeholder="••••••••" {...field} onFocus={(e) => e.target.select()} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <Button type="submit" className="w-full" disabled={!!loadingProvider}>
                            {loadingProvider === 'email' ? <Loader2 className="animate-spin" /> : 'Sign In'}
                        </Button>
                    </form>
                </Form>
            </TabsContent>
            <TabsContent value="signup">
                 <Form {...signupForm}>
                    <form onSubmit={signupForm.handleSubmit(handleSignupSubmit)} className="space-y-6 pt-4">
                        <FormField control={signupForm.control} name="displayName" render={({ field }) => (
                            <FormItem><FormLabel>Display Name</FormLabel><FormControl><Input placeholder="Your Name" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={signupForm.control} name="email" render={({ field }) => (
                            <FormItem><FormLabel>Email</FormLabel><FormControl><Input placeholder="you@example.com" {...field} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={signupForm.control} name="password" render={({ field }) => (
                            <FormItem>
                                <div className="flex justify-between items-center">
                                    <FormLabel>Password</FormLabel>
                                    <span className="text-sm invisible h-auto p-0">Forgot password?</span>
                                </div>
                                <FormControl><Input type="password" placeholder="••••••••" {...field} onFocus={(e) => e.target.select()} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <FormField
                            control={signupForm.control}
                            name="terms"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                                    <FormControl>
                                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                    <div className="space-y-1 leading-none">
                                        <FormLabel>
                                            I agree to the{' '}
                                            <Button variant="link" asChild className="p-0 h-auto">
                                                <Link href="/terms" target="_blank">
                                                    Terms and Conditions
                                                </Link>
                                            </Button>
                                            .
                                        </FormLabel>
                                        <FormMessage />
                                    </div>
                                </FormItem>
                            )}
                        />
                        <Button type="submit" className="w-full" disabled={!!loadingProvider || !termsAccepted}>
                            {loadingProvider === 'email' ? <Loader2 className="animate-spin" /> : 'Create Account'}
                        </Button>
                    </form>
                </Form>
            </TabsContent>
          </Tabs>
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                    Or continue with
                </span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4">
              <Button variant="outline" onClick={() => handleOAuthSignIn('google')} disabled={!!loadingProvider || (activeTab === 'signup' && !termsAccepted)}>
                {loadingProvider === 'google' ? <Loader2 className="animate-spin" /> : <><GoogleIcon className="mr-2 h-4 w-4" /> {activeTab === 'login' ? 'Sign In with Google' : 'Sign Up with Google'}</>}
              </Button>
          </div>
        </CardContent>
      </Card>
      <footer className="py-6 text-center text-muted-foreground text-sm mt-8">
            <p>Kiadas © {new Date().getFullYear()}</p>
      </footer>
      
      <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Reset Password</DialogTitle>
                <DialogDescription>
                    Enter your email address and we will send you a link to reset your password.
                </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
                <div className="space-y-2">
                    <Label htmlFor="reset-email">Email</Label>
                    <Input id="reset-email" type="email" placeholder="you@example.com" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
                </div>
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsResetDialogOpen(false)}>Cancel</Button>
                <Button onClick={handlePasswordReset} disabled={resetLoading}>
                    {resetLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Send Reset Link
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
