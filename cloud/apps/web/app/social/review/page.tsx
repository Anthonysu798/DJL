import type { Metadata } from "next";
import { PublicSocialReview } from "./PublicSocialReview";
export const metadata: Metadata = {
  title: "Review a social draft · DJL",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};
export default function ReviewPage() {
  return <PublicSocialReview />;
}
