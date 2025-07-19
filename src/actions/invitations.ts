'use server';

import { z } from 'zod';
import { Resend } from 'resend';

const sendInvitationSchema = z.object({
  invitedEmail: z.string().email(),
  householdName: z.string(),
  inviterName: z.string(),
});

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendInvitationEmail(params: z.infer<typeof sendInvitationSchema>) {
  const validatedFields = sendInvitationSchema.safeParse(params);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Invalid parameters for sending invitation.',
    };
  }

  const { invitedEmail, householdName, inviterName } = validatedFields.data;

  if (!process.env.RESEND_API_KEY) {
    console.error('Resend API key is not set. Cannot send email.');
    // Don't fail the whole operation if email is not configured. The invitation is still in the DB.
    return { success: true, message: 'Email service not configured, but invitation created.' };
  }

  const invitationUrl = 'https://worthwatch.app/household';

  try {
    const { data, error } = await resend.emails.send({
      from: 'WorthWatch <invitations@worthwatch.app>',
      to: invitedEmail,
      subject: `You're invited to join "${householdName}" on WorthWatch!`,
      html: `
        <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
          <h1 style="color: #111;">You're Invited!</h1>
          <p>${inviterName} has invited you to join the "<strong>${householdName}</strong>" household on WorthWatch.</p>
          <p>WorthWatch is a modern app for tracking your finances and net worth. By joining this household, you can manage shared expenses and budgets together.</p>
          <p style="margin: 24px 0;">
            <a 
              href="${invitationUrl}" 
              style="display: inline-block; padding: 12px 24px; background-color: #008080; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;"
            >
              Accept Invitation
            </a>
          </p>
          <p>To accept, please sign up or log in to your WorthWatch account with this email address.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 0.8em; color: #777;">If you did not expect this invitation, you can safely ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      console.error('Resend API Error:', error);
      // Even if email fails, don't throw an error to the user, because the invitation was created in the database.
      return { success: true, message: 'Invitation created, but failed to send email.' };
    }

    return { success: true, message: 'Invitation email sent!' };
  } catch (error) {
    console.error('Email sending error:', error);
    return { success: true, message: 'Invitation created, but failed to send email.' };
  }
}
