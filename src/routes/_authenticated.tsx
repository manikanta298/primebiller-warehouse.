import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { canAccess, getSession, useSession } from "@/lib/session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: ({ location }) => {
    const s = getSession();
    if (!s) throw redirect({ to: "/login", search: { redirect: location.href } });
    if (!s.orgId) throw redirect({ to: "/login", search: { redirect: location.href } });
    if (location.pathname !== "/no-access" && !canAccess(s.user.role, location.pathname)) {
      throw redirect({ to: "/no-access" });
    }
  },
  component: Layout,
});

function Layout() {
  const session = useSession();
  if (!session) return null;
  return (
    <AppShell session={session}>
      <Outlet />
    </AppShell>
  );
}
