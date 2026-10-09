import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/no-access")({
  head: () => ({ meta: [{ title: "No access — Girder" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <div className="mx-auto mt-16 max-w-md text-center">
      <ShieldAlert className="mx-auto mb-4 size-10 text-ember" />
      <h1 className="text-xl font-semibold">Your role can't open that screen</h1>
      <p className="mt-2 text-sm text-muted-foreground">Ask the Owner to change your role in Users & roles.</p>
      <Button asChild className="mt-6">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  ),
});
