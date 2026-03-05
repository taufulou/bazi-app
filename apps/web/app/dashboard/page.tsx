import { redirect } from "next/navigation";

// Dashboard content has moved to the root page (/).
// This redirect ensures old /dashboard links still work.
export default function DashboardPage() {
  redirect("/");
}
