import { getSession } from "@/lib/session";
import { CA_ROLE } from "@/api/types";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Girder — Inventory & GST billing for traders" },
      { name: "description", content: "Multi-godown stock, sales orders, challans and GST invoices for Indian traders." },
      { property: "og:title", content: "Girder — Inventory & GST billing for traders" },
      { property: "og:description", content: "Multi-godown stock, sales orders, challans and GST invoices for Indian traders." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: getSession()?.user.role === CA_ROLE ? "/ca" : "/dashboard" });
  },
});
