import { redirect } from "next/navigation";

// The guide became /docs; this route survives so old links keep working.
export default async function GuidePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  redirect(params.lang === "en" ? "/en/docs" : "/docs");
}
