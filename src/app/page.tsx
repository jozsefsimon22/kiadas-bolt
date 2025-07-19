import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Logo />
            <span className="font-bold">Kiadas</span>
          </Link>
          <div className="flex flex-1 items-center justify-end space-x-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/login">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <section className="py-12 md:py-24 lg:py-32">
          <div className="container text-center">
            <h1 className="text-4xl font-extrabold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
              Master Your Money with Kiadas
            </h1>
            <p className="mx-auto mt-4 max-w-[700px] text-lg text-muted-foreground md:text-xl">
              Kiadas helps you automate your budget, track your net worth, and build a secure financial future. Effortlessly.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <Button size="lg" asChild>
                <Link href="/login">Get Started Now</Link>
              </Button>
            </div>
          </div>
        </section>

        <section id="philosophy" className="w-full bg-muted py-12 md:py-24 lg:py-32">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">A Smarter Way to Budget</h2>
              <p className="mt-4 text-muted-foreground md:text-xl">
                We're built on the popular 50/30/20 budget rule, popularized by U.S. Senator Elizabeth Warren. Our philosophy is simple: cover your needs and savings first. The rest is yours to enjoy, guilt-free.
              </p>
            </div>
            <div className="mx-auto mt-12 grid max-w-5xl items-start gap-8 sm:grid-cols-1 md:grid-cols-3">
              <div className="grid gap-1 text-center">
                <h3 className="text-2xl font-bold text-primary">50%</h3>
                <p className="font-semibold">Needs</p>
                <p className="text-sm text-muted-foreground">
                  Allocate half of your income to essentials like housing and utilities. Kiadas tracks your recurring expenses automatically.
                </p>
              </div>
              <div className="grid gap-1 text-center">
                <h3 className="text-2xl font-bold text-chart-2">20%</h3>
                <p className="font-semibold">Savings & Investments</p>
                <p className="text-sm text-muted-foreground">
                  Dedicate 20% to your future. Set savings goals, track investments, and watch your net worth grow.
                </p>
              </div>
              <div className="grid gap-1 text-center">
                <h3 className="text-2xl font-bold text-chart-4">30%</h3>
                <p className="font-semibold">Wants</p>
                <p className="text-sm text-muted-foreground">
                  The remaining 30% is for you. From dining out to hobbies, spend confidently knowing your future is secure.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="py-12 md:py-24 lg:py-32">
          <div className="container space-y-20">
            <Feature
              title="Visualize Your Growth"
              description="Track your net worth over time with beautiful, insightful charts. See how your assets grow and liabilities shrink, giving you a clear picture of your financial health."
              imageSrc="/images/dashboard-light.png"
            />
            <Feature
              title="Intelligent Projections"
              description="See where you'll be in 10, 20, or 30 years. Make informed decisions with our powerful projection tools that adapt to your financial habits."
              imageSrc="/images/projection-light.png"
              reverse
            />
            <Feature
              title="Deep Dive into Your Spending"
              description="Go beyond simple tracking. Analyze your spending habits, compare expenses across different periods, and discover where your money is really going with our powerful analytics tools."
              imageSrc="/images/analytics-light.png"
            />
            <Feature
              title="Shared Finances, Simplified"
              description="Invite your partner or roommates to a household to track shared expenses and manage your finances as a team. No more awkward conversations about who paid for what."
              imageSrc="/images/household-light.png"
              reverse
            />
          </div>
        </section>
        
        <section className="py-12 md:py-24 lg:py-32 bg-primary text-primary-foreground">
            <div className="container text-center">
                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">Ready to Take Control?</h2>
                <p className="mx-auto mt-4 max-w-md">
                    Sign up for free and start your journey to financial clarity today. No credit card required.
                </p>
                <div className="mt-8">
                    <Button size="lg" variant="secondary" asChild>
                        <Link href="/login">Start for Free</Link>
                    </Button>
                </div>
            </div>
        </section>
      </main>
      <footer className="border-t">
        <div className="container flex h-16 items-center justify-between">
            <p className="text-sm text-muted-foreground">&copy; {new Date().getFullYear()} Kiadas. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function Feature({ title, description, imageSrc, reverse = false }: { title: string; description: string; imageSrc: string; reverse?: boolean }) {
  const imageSrcDark = imageSrc.replace('-light.png', '-dark.png');
  return (
    <div className={`mx-auto grid max-w-6xl items-center gap-8 md:grid-cols-2 md:gap-16 ${reverse ? 'md:grid-flow-row-dense' : ''}`}>
      <div className={`space-y-4 ${reverse ? 'md:col-start-2' : ''}`}>
        <h3 className="text-3xl font-bold tracking-tighter sm:text-4xl">{title}</h3>
        <p className="text-muted-foreground md:text-lg">
          {description}
        </p>
      </div>
      <div className="overflow-hidden rounded-xl shadow-lg transition-transform duration-300 ease-in-out hover:scale-105">
        <Image
          src={imageSrc}
          alt={title}
          width={1200}
          height={800}
          className="w-full block dark:hidden"
        />
        <Image
          src={imageSrcDark}
          alt={title}
          width={1200}
          height={800}
          className="w-full hidden dark:block"
        />
      </div>
    </div>
  );
}
