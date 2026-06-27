import { useAuth } from "@/components/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { User, Mail, Calendar, Clock, ShieldCheck, Link } from "lucide-react";

function initials(name: string | null | undefined, email: string): string {
  if (name) {
    return name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProviderBadge({ provider }: { provider: string | null | undefined }) {
  const p = provider ?? "local";
  const label =
    p === "google" ? "Google"
    : p === "github" ? "GitHub"
    : p === "local" ? "Email & Password"
    : p;
  const color =
    p === "google" ? "bg-blue-500/10 text-blue-500 border-blue-500/30"
    : p === "github" ? "bg-gray-500/10 text-gray-400 border-gray-500/30"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${color}`}>
      <Link className="h-3 w-3" />
      {label}
    </span>
  );
}

export default function Profile() {
  const { user } = useAuth();

  if (!user) return null;

  const displayName = (user as { name?: string | null }).name ?? user.username;
  const provider = (user as { provider?: string | null }).provider;
  const lastLogin = (user as { last_login?: string | null }).last_login;
  const createdAt = (user as { created_at?: string | null }).created_at;

  return (
    <div className="flex-1 space-y-6 p-8 pt-6 w-full max-w-2xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Profile</h2>
        <p className="text-muted-foreground mt-1">Your account details and preferences.</p>
      </div>

      {/* Avatar + name card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-5">
            <Avatar className="h-20 w-20 border-2 border-border">
              <AvatarImage src={(user as { avatar_url?: string | null }).avatar_url ?? undefined} alt={displayName} />
              <AvatarFallback className="text-xl font-semibold bg-primary/10 text-primary">
                {initials(displayName, user.email)}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <h3 className="text-xl font-semibold">{displayName}</h3>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="capitalize">{user.role}</Badge>
                <ProviderBadge provider={provider} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Details</CardTitle>
          <CardDescription>Information associated with your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-0">
          <div className="divide-y divide-border">
            <DetailRow icon={<User className="h-4 w-4" />} label="Username" value={user.username} />
            <DetailRow icon={<Mail className="h-4 w-4" />} label="Email" value={user.email} />
            <DetailRow icon={<ShieldCheck className="h-4 w-4" />} label="Role" value={
              <span className="capitalize">{user.role}</span>
            } />
            <DetailRow
              icon={<Link className="h-4 w-4" />}
              label="Sign-in method"
              value={<ProviderBadge provider={provider} />}
            />
          </div>
          <Separator className="my-4" />
          <div className="divide-y divide-border">
            <DetailRow
              icon={<Calendar className="h-4 w-4" />}
              label="Member since"
              value={formatDate(createdAt)}
            />
            <DetailRow
              icon={<Clock className="h-4 w-4" />}
              label="Last login"
              value={formatDateTime(lastLogin)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
