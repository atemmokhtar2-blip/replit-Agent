import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getGetUnreadCountQueryKey,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Check, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";

export default function Notifications() {
  const queryClient = useQueryClient();
  const { data: notifications, isLoading } = useListNotifications({
    page: 1,
    per_page: 50,
  });

  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();

  const handleMarkRead = (id: string) => {
    markReadMutation.mutate(
      { notificationId: id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListNotificationsQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getGetUnreadCountQueryKey(),
          });
        },
      }
    );
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListNotificationsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetUnreadCountQueryKey(),
        });
      },
    });
  };

  const hasUnread = notifications?.items.some((n) => !n.is_read) ?? false;

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">Notifications</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Stay updated on your workspace activity.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleMarkAllRead}
          disabled={markAllReadMutation.isPending || !hasUnread}
          className="flex-shrink-0"
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Mark all as read</span>
          <span className="sm:hidden">Mark all</span>
        </Button>
      </div>

      <div className="space-y-3 max-w-3xl">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))
        ) : notifications?.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed">
            <Bell className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">All caught up</h3>
            <p className="text-sm text-muted-foreground">
              You don't have any notifications.
            </p>
          </div>
        ) : (
          notifications?.items.map((notification) => (
            <Card
              key={notification.id}
              className={!notification.is_read ? "border-primary/50 bg-primary/5" : ""}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div className="mt-0.5 h-8 w-8 flex-shrink-0 rounded-full bg-muted flex items-center justify-center">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium leading-none">
                    {notification.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {notification.message}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(notification.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                {!notification.is_read && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0 h-8 w-8"
                    onClick={() => handleMarkRead(notification.id)}
                    disabled={markReadMutation.isPending}
                    aria-label="Mark as read"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
