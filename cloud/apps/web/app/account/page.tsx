import { redirect } from "next/navigation";

export default function AccountPage() {
  redirect("/chat/settings?tab=account");
}
