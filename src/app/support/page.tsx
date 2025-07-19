
'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LifeBuoy, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { sendSupportEmail } from '@/actions/support';

const supportSchema = z.object({
  topic: z.string({ required_error: 'Please select a topic.' }).min(1, 'Please select a topic.'),
  message: z.string().min(10, { message: 'Message must be at least 10 characters long.' }),
});

function Support() {
    const user = useAuth();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<z.infer<typeof supportSchema>>({
        resolver: zodResolver(supportSchema),
        defaultValues: {
            topic: '',
            message: '',
        },
    });

    const handleSubmit = async (values: z.infer<typeof supportSchema>) => {
        setIsSubmitting(true);

        const formData = new FormData();
        formData.append('topic', values.topic);
        formData.append('message', values.message);
        formData.append('userEmail', user.email || '');

        const result = await sendSupportEmail(formData);

        if (result.success) {
            toast({
                title: 'Message Sent!',
                description: "We've received your message and will get back to you shortly.",
            });
            form.reset();
        } else {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: result.message,
            });
        }

        setIsSubmitting(false);
    };
    
    const supportTopics = [
        'General Inquiry',
        'Bug Report',
        'Feature Request',
        'Billing Question',
        'Account Issue',
    ];

    return (
        <>
            <Header title="Support" />
            <main className="flex-1 space-y-6 p-4 sm:p-6">
                <div className="max-w-7xl mx-auto w-full">
                    <Card className="max-w-2xl mx-auto">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><LifeBuoy className="h-6 w-6" />Contact Support</CardTitle>
                            <CardDescription>Have a question or need to report an issue? Fill out the form below and we'll get back to you as soon as possible.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="email">Your Email</Label>
                                        <Input id="email" value={user.email || ''} readOnly disabled />
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="topic"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Topic</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select a topic..." />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {supportTopics.map(topic => (
                                                            <SelectItem key={topic} value={topic}>{topic}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="message"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Message</FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        placeholder="Please describe your issue or question in detail..."
                                                        className="resize-y min-h-[150px]"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="flex justify-end">
                                        <Button type="submit" disabled={isSubmitting}>
                                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Send Message
                                        </Button>
                                    </div>
                                </form>
                            </Form>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </>
    );
}

export default function SupportPage() {
    return (
        <MainLayout>
            <Support />
        </MainLayout>
    );
}
