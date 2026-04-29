import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1517488629431-6427e0ee1e5f?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center opacity-[0.03] pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent pointer-events-none" />
      
      <div className="relative z-10 max-w-lg w-full text-center space-y-8">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="48" height="48" rx="12" fill="#E68A00" />
              <path d="M14 16H34M14 24H34M14 32H24" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
        </div>
        
        <div className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-serif font-semibold tracking-tight text-foreground">
            Presenter Notes
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground font-sans">
            A quiet, focused space for your presentation talking points. Like a well-worn notebook before stepping on stage.
          </p>
        </div>

        <div className="pt-4 flex justify-center">
          <Link href="/sign-in" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8 py-2 w-full sm:w-auto text-base">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}