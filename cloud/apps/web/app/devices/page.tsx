import { redirect } from "next/navigation";

export default function DevicesPage() {
  redirect("/chat/settings?tab=devices");
}
