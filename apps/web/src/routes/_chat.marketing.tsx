import { createFileRoute } from "@tanstack/react-router";
import { MarketingStudio } from "../components/marketing/MarketingStudio";
export const Route = createFileRoute("/_chat/marketing")({ component: MarketingStudio });
