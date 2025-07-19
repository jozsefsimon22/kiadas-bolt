
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function TermsAndConditionsPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 sm:p-6">
      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle>Terms and Conditions</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] pr-4">
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p>Please read these Terms and Conditions ("Terms", "Terms and Conditions") carefully before using the Kiadas application (the "Service") operated by us.</p>
              
              <h3 className="text-lg font-semibold text-foreground mt-4">1. Acceptance of Terms</h3>
              <p>By creating an account and using our Service, you agree to be bound by these Terms. If you disagree with any part of the terms, then you may not access the Service.</p>

              <h3 className="text-lg font-semibold text-foreground mt-4">2. Description of Service</h3>
              <p>Kiadas provides users with tools to track personal finances, including assets, liabilities, income, expenses, and savings goals. The Service also offers financial projection features based on user-provided data.</p>
              
              <h3 className="text-lg font-semibold text-foreground mt-4">3. Financial Projections and Liability</h3>
              <p><strong>Disclaimer: The financial projection tools and any related analysis provided by the Service are for informational and illustrative purposes only. They are not financial advice.</strong> The projections are based on mathematical formulas and the data you provide. We make no representations or warranties about the accuracy, completeness, or reliability of these projections.</p>
              <p><strong>Market conditions, personal circumstances, and other factors can significantly impact financial outcomes. The projections are not a guarantee of future results.</strong> You should consult with a qualified financial professional before making any financial decisions. Kiadas assumes no liability for any actions taken or decisions made in reliance on the information provided by the Service.</p>

              <h3 className="text-lg font-semibold text-foreground mt-4">4. User Accounts</h3>
              <p>When you create an account with us, you must provide information that is accurate, complete, and current at all times. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account on our Service.</p>
              <p>You are responsible for safeguarding the password that you use to access the Service and for any activities or actions under your password. You agree not to disclose your password to any third party.</p>

              <h3 className="text-lg font-semibold text-foreground mt-4">5. Intellectual Property</h3>
              <p>The Service and its original content, features, and functionality are and will remain the exclusive property of Kiadas and its licensors. The Service is protected by copyright, trademark, and other laws of both the United States and foreign countries.</p>

              <h3 className="text-lg font-semibold text-foreground mt-4">6. Limitation Of Liability</h3>
              <p>In no event shall Kiadas, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from (i) your access to or use of or inability to access or use the Service; (ii) any conduct or content of any third party on the Service; (iii) any content obtained from the Service; and (iv) unauthorized access, use or alteration of your transmissions or content, whether based on warranty, contract, tort (including negligence) or any other legal theory, whether or not we have been informed of the possibility of such damage.</p>

              <h3 className="text-lg font-semibold text-foreground mt-4">7. Changes</h3>
              <p>We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material we will try to provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion.</p>
              
              <h3 className="text-lg font-semibold text-foreground mt-4">8. Contact Us</h3>
              <p>If you have any questions about these Terms, please contact us at support@kiadas.app.</p>
            </div>
          </ScrollArea>
        </CardContent>
        <CardFooter>
            <Button asChild>
                <Link href="/login">Back to Login</Link>
            </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
