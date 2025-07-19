
'use server';

import { z } from 'zod';
import { Resend } from 'resend';

const supportSchema = z.object({
  topic: z.string().min(1, 'Topic is required.'),
  message: z.string().min(10, 'Message must be at least 10 characters.'),
  userEmail: z.string().email('A valid user email is required.'),
});

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendSupportEmail(formData: FormData) {
  const rawFormData = {
    topic: formData.get('topic'),
    message: formData.get('message'),
    userEmail: formData.get('userEmail'),
  };

  const validatedFields = supportSchema.safeParse(rawFormData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Invalid form data. Please check your entries.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { topic, message, userEmail } = validatedFields.data;

  if (!process.env.RESEND_API_KEY) {
    console.error('Resend API key is not set. Cannot send email.');
    return {
      success: false,
      message: "The email service isn't configured. Please contact support manually.",
    };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'support-form@worthwatch.app',
      to: 'support@worthwatch.app',
      subject: `Support: ${topic}`,
      reply_to: userEmail,
      text: `From: ${userEmail}\n\n${message}`,
    });

    if (error) {
      console.error('Resend API Error:', error);
      return { success: false, message: 'Failed to send your message. Please try again later or contact support@worthwatch.app directly.' };
    }

    return { success: true, message: 'Your message has been sent!' };
  } catch (error) {
    console.error('Email sending error:', error);
    return { success: false, message: 'Failed to send your message. Please try again later or contact support@worthwatch.app directly.' };
  }
}
