import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Cpu, Loader2 } from "lucide-react";
import { useEffect } from "react";

const resetSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type ResetFormValues = z.infer<typeof resetSchema>;

export default function ResetPassword() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Extract token from URL search params
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      toast({ variant: "destructive", title: "Invalid Link", description: "No reset token provided." });
      setLocation("/login");
    }
  }, [token, setLocation, toast]);

  const form = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "" },
  });

  const resetMutation = useResetPassword();

  const onSubmit = (data: ResetFormValues) => {
    if (!token) return;

    resetMutation.mutate(
      { data: { token, password: data.password } },
      {
        onSuccess: () => {
          toast({ title: "Password updated", description: "You can now log in with your new password." });
          setLocation("/login");
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Failed",
            description: (err as { data?: { error?: string } }).data?.error || "An error occurred.",
          });
        },
      }
    );
  };

  if (!token) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Cpu className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Reset password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your new password below
          </p>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input id="password" type="password" {...form.register("password")} />
            {form.formState.errors.password && (
              <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={resetMutation.isPending}>
            {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset Password
          </Button>
        </form>

        <div className="text-center text-sm">
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
