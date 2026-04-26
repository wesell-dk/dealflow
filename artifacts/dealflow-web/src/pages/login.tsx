import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { LogIn, Loader2, Briefcase } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const DEMO_USERS: Array<{ email: string; label: string; scope: string }> = [
  { email: "anna@helix.com",   label: "Anna Brandt",     scope: "Account Executive · Helix DACH" },
  { email: "james@helix.com",  label: "James Whitfield", scope: "Regional Director · Helix UK" },
  { email: "priya@helix.com",  label: "Priya Raman",     scope: "VP Commercial · Tenant-weit" },
];

export default function LoginPage() {
  const { login, user } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("anna@helix.com");
  const [password, setPassword] = useState("dealflow");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    setTimeout(() => setLocation("/"), 0);
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      setLocation("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 bg-background"
      style={{
        backgroundImage:
          "radial-gradient(60rem 40rem at 80% -10%, hsl(var(--brand-2) / 0.18), transparent 60%), radial-gradient(50rem 36rem at 0% 110%, hsl(var(--primary) / 0.12), transparent 55%)",
      }}
    >
      <div className="grid gap-6 md:grid-cols-2 max-w-4xl w-full">
        <Card className="shadow-lg">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2.5 mb-1">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-brand-2 text-primary-foreground shadow-sm">
                <Briefcase className="h-4 w-4" />
              </span>
              <span className="font-semibold tracking-tight">DealFlow One</span>
            </div>
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <CardDescription>B2B Commercial Execution Platform</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4" data-testid="form-login">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
              </div>
              {error && (
                <div className="text-sm text-destructive" data-testid="text-error">{error}</div>
              )}
              <Button type="submit" className="w-full" disabled={busy} data-testid="button-login">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-base">Demo users</CardTitle>
            <CardDescription>Password for all demo accounts: <code className="font-mono">dealflow</code></CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => { setEmail(u.email); setPassword("dealflow"); }}
                className="w-full text-left p-3 rounded-xl border border-border/70 hover-elevate active-elevate-2"
                data-testid={`button-demo-${u.email.split("@")[0]}`}
              >
                <div className="font-medium text-sm">{u.label}</div>
                <div className="text-xs text-muted-foreground">{u.scope}</div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">{u.email}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
