// FILE: hostedPlugins.ts
// Purpose: The hosted tool servers in DJL's bundled catalog: one entry per vendor-run MCP server.
// Every entry was checked against the live service before it was added (the first ten on
// 2026-11-19, the rest on 2026-11-20). For a sign-in server the check is that DJL registered
// itself with a loopback redirect and was given a sign-in page; for an `auth: "none"` server it
// is that the server listed its tools with no credentials. Check a new entry the same way.
// Descriptions and example prompts for sign-in servers come from what each product does; their
// tool lists cannot be read without an account, so they were not checked tool by tool.
//
// GitHub (checked 2026-11-21) does not offer registration, but its sign-in server offers device
// sign-in (RFC 8628), which needs only a public client id: DJL's own GitHub OAuth app,
// `GITHUB_OAUTH_CLIENT_ID`. The user approves DJL on github.com and DJL picks up the sign-in by
// itself, so no token is pasted and no secret ships in the app.
//
// Left out because the check failed: Figma, Gamma, Calendly, ZoomInfo, Salesforce and Similarweb
// refuse registration (Figma's remote server also refuses personal access tokens, by Figma's own
// statement); Slack, Asana, HubSpot, Box, Xero, Chargebee, Render, Smartsheet,
// PagerDuty, Zendesk, Twilio and DocuSign do not offer it (each needs a client DJL registers with
// the vendor first); Attio, Ahrefs, Typeform and Pipedream register DJL but refuse its sign-in
// page; Firecrawl, Browserbase, Telnyx and Teamwork answer without sign-in but need an API key.
// Mercado Pago registers DJL and shows a sign-in page, but its token endpoint answers a public
// client with "invalid_client", so the last step of sign-in would fail.

export interface HostedPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly longDescription: string;
  readonly category: string;
  readonly featured?: boolean;
  /**
   * "none" for servers that are open to everyone; "apiKey" for servers that take a token the
   * user creates with the vendor (`tokenUrl`, `tokenScopes`); sign-in (OAuth) otherwise.
   */
  readonly auth?: "none" | "apiKey";
  /**
   * For a sign-in server that does not let DJL register itself: DJL's own client with the
   * vendor and the scopes to ask for. Sign-in then uses the device flow, which needs no secret.
   */
  readonly oauthClient?: { readonly clientId: string; readonly scopes: ReadonlyArray<string> };
  readonly tokenUrl?: string;
  readonly tokenScopes?: ReadonlyArray<string>;
  readonly url: string;
  readonly websiteUrl: string;
  readonly privacyPolicyUrl?: string;
  readonly termsOfServiceUrl?: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly examplePrompts: readonly [string, string, string];
}

/**
 * DJL's GitHub OAuth app "DJL" (github.com/settings/applications/4041646, owned by Anthonysu798),
 * registered 2026-11-21 with "Enable Device Flow" on and "Expire user access tokens" off: GitHub
 * refreshes an expiring token only with the client secret, which DJL never has. A client id is
 * public by design; the app has no client secret, and none belongs here.
 */
const GITHUB_OAUTH_CLIENT_ID = "Ov23liJjAxwfZDaDrU8Q";

const DEVELOPER_TOOLS = "Developer tools";
const PLANNING = "Planning and docs";
const DESIGN = "Design";
const SUPPORT = "Customer support";
const PAYMENTS = "Payments and finance";
const WEBSITES = "Websites and commerce";
const MONITORING = "Monitoring and incidents";
const DATA = "Data and analytics";
const MEETINGS = "Meetings and scheduling";
const SALES = "Sales and marketing";
const AUTOMATION = "Automation";
const RESEARCH = "Search and reference";
const EVERYDAY = "Shopping and travel";

export const HOSTED_PLUGINS: ReadonlyArray<HostedPlugin> = [
  {
    id: "linear",
    displayName: "Linear",
    shortDescription: "Find, create and update issues",
    longDescription:
      "Use Linear to search issues and projects, file new issues from a conversation, and keep status, assignees and comments up to date.",
    category: PLANNING,
    featured: true,
    url: "https://mcp.linear.app/mcp",
    websiteUrl: "https://linear.app",
    privacyPolicyUrl: "https://linear.app/privacy",
    termsOfServiceUrl: "https://linear.app/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my open issues in the current cycle, grouped by project",
      "Create an issue for the bug we just found and assign it to me",
      "Summarize what changed on [project] this week",
    ],
  },
  {
    id: "github",
    displayName: "GitHub",
    shortDescription: "Work with repositories, issues and pull requests",
    longDescription:
      "Use GitHub to search code and repositories, read and file issues, review pull requests, and check workflow runs.",
    category: DEVELOPER_TOOLS,
    featured: true,
    url: "https://api.githubcopilot.com/mcp/",
    oauthClient: { clientId: GITHUB_OAUTH_CLIENT_ID, scopes: ["repo", "read:org", "read:user"] },
    websiteUrl: "https://github.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the open pull requests waiting for my review",
      "Create an issue in [repository] for the bug we just found",
      "Summarize what changed in [repository] this week",
    ],
  },
  {
    id: "notion",
    displayName: "Notion",
    shortDescription: "Search, read and write pages",
    longDescription:
      "Use Notion to find pages and databases, pull their content into a conversation, and create or update pages with what you worked out.",
    category: PLANNING,
    featured: true,
    url: "https://mcp.notion.com/mcp",
    websiteUrl: "https://www.notion.com",
    termsOfServiceUrl: "https://www.notion.com/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Find our onboarding doc and summarize the first-week checklist",
      "Turn this conversation into a meeting-notes page in [workspace area]",
      "List the rows in [database] that are still marked In progress",
    ],
  },
  {
    id: "atlassian",
    displayName: "Atlassian",
    shortDescription: "Work with Jira issues and Confluence pages",
    longDescription:
      "Use Atlassian to search and update Jira issues and to read or draft Confluence pages from a conversation.",
    category: PLANNING,
    url: "https://mcp.atlassian.com/v1/mcp",
    websiteUrl: "https://www.atlassian.com",
    privacyPolicyUrl: "https://www.atlassian.com/legal/privacy-policy",
    termsOfServiceUrl: "https://www.atlassian.com/legal/atlassian-customer-agreement",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Show the Jira issues assigned to me that are due this week",
      "Create a Jira bug from this stack trace in [project]",
      "Summarize the Confluence page on [topic]",
    ],
  },
  {
    id: "clickup",
    displayName: "ClickUp",
    shortDescription: "Manage tasks, lists and docs",
    longDescription:
      "Use ClickUp to look up tasks, create and update them, and read docs in your workspace.",
    category: PLANNING,
    url: "https://mcp.clickup.com/mcp",
    websiteUrl: "https://clickup.com",
    privacyPolicyUrl: "https://clickup.com/terms/privacy",
    termsOfServiceUrl: "https://clickup.com/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "What tasks are overdue in [list]?",
      "Create a task for each action item above",
      "Move [task] to In review and add a comment with this summary",
    ],
  },
  {
    id: "sentry",
    displayName: "Sentry",
    shortDescription: "Investigate errors and performance issues",
    longDescription:
      "Use Sentry to look up issues, read stack traces and event details, and connect a production error to the code that caused it.",
    category: DEVELOPER_TOOLS,
    featured: true,
    url: "https://mcp.sentry.dev/mcp",
    websiteUrl: "https://sentry.io",
    privacyPolicyUrl: "https://sentry.io/privacy/",
    termsOfServiceUrl: "https://sentry.io/terms/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Show the most frequent unresolved errors in [project] from the last 24 hours",
      "Explain this Sentry issue and find the code that throws it",
      "Which release introduced [issue]?",
    ],
  },
  {
    id: "vercel",
    displayName: "Vercel",
    shortDescription: "Inspect projects, deployments and logs",
    longDescription:
      "Use Vercel to check deployment status, read build and runtime logs, and look up project configuration.",
    category: DEVELOPER_TOOLS,
    featured: true,
    url: "https://mcp.vercel.com",
    websiteUrl: "https://vercel.com",
    privacyPolicyUrl: "https://vercel.com/legal/privacy-notice",
    termsOfServiceUrl: "https://vercel.com/legal/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Why did the latest deployment of [project] fail?",
      "Show runtime errors from production in the last hour",
      "List the environment variables set on [project]",
    ],
  },
  {
    id: "supabase",
    displayName: "Supabase",
    shortDescription: "Query and manage your Supabase projects",
    longDescription:
      "Use Supabase to inspect tables, run SQL, read logs and advisors, and manage migrations for your projects.",
    category: DEVELOPER_TOOLS,
    featured: true,
    url: "https://mcp.supabase.com/mcp",
    websiteUrl: "https://supabase.com",
    privacyPolicyUrl: "https://supabase.com/privacy",
    termsOfServiceUrl: "https://supabase.com/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the tables in [project] and their row counts",
      "Check the security advisors for [project] and explain each warning",
      "Write a migration that adds [column] to [table]",
    ],
  },
  {
    id: "cloudflare",
    displayName: "Cloudflare",
    shortDescription: "Manage Workers, KV, R2 and D1",
    longDescription:
      "Use Cloudflare to inspect and manage Workers and their bindings, including KV namespaces, R2 buckets and D1 databases.",
    category: DEVELOPER_TOOLS,
    url: "https://bindings.mcp.cloudflare.com/mcp",
    websiteUrl: "https://www.cloudflare.com",
    privacyPolicyUrl: "https://www.cloudflare.com/privacypolicy/",
    termsOfServiceUrl: "https://www.cloudflare.com/terms/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my Workers and when each was last deployed",
      "Show the tables in my D1 database [name]",
      "Create a KV namespace for [purpose]",
    ],
  },
  {
    id: "canva",
    displayName: "Canva",
    shortDescription: "Create, review and edit designs",
    longDescription:
      "Use Canva to find your designs, create new ones from a brief, and export them for use elsewhere.",
    category: DESIGN,
    url: "https://mcp.canva.com/mcp",
    websiteUrl: "https://www.canva.com",
    privacyPolicyUrl: "https://www.canva.com/policies/privacy-policy/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Find my most recent presentation and summarize each slide",
      "Create a social post design for [announcement]",
      "Export [design] as a PDF",
    ],
  },
  {
    id: "intercom",
    displayName: "Intercom",
    shortDescription: "Search conversations and contacts",
    longDescription:
      "Use Intercom to look up customer conversations and contacts so you can answer questions with the real history in front of you.",
    category: SUPPORT,
    url: "https://mcp.intercom.com/mcp",
    websiteUrl: "https://www.intercom.com",
    privacyPolicyUrl: "https://www.intercom.com/legal/privacy",
    termsOfServiceUrl: "https://www.intercom.com/legal/terms-and-policies",
    capabilities: ["Read"],
    examplePrompts: [
      "Summarize the open conversations about [topic] from this week",
      "What has [customer] contacted us about before?",
      "List the most common complaints in the last 50 conversations",
    ],
  },
  {
    id: "stripe",
    displayName: "Stripe",
    shortDescription: "Look up payments, customers and subscriptions",
    longDescription:
      "Use Stripe to find customers, payments, invoices and subscriptions, create products, prices and payment links, and search Stripe's documentation.",
    category: PAYMENTS,
    featured: true,
    url: "https://mcp.stripe.com",
    websiteUrl: "https://stripe.com",
    privacyPolicyUrl: "https://stripe.com/privacy",
    termsOfServiceUrl: "https://stripe.com/legal",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Show the payments that failed in the last 7 days and why",
      "Create a payment link for [product] at [price]",
      "How many active subscriptions do we have on [plan]?",
    ],
  },
  {
    id: "paypal",
    displayName: "PayPal",
    shortDescription: "Manage invoices, orders and transactions",
    longDescription:
      "Use PayPal to create and send invoices, look up orders and transactions, and review disputes on your business account.",
    category: PAYMENTS,
    featured: true,
    url: "https://mcp.paypal.com/mcp",
    websiteUrl: "https://www.paypal.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the transactions from the last 30 days over [amount]",
      "Draft an invoice to [customer] for [amount]",
      "Show my open disputes and what each one needs",
    ],
  },
  {
    id: "square",
    displayName: "Square",
    shortDescription: "Work with payments, orders, catalog and customers",
    longDescription:
      "Use Square to look up payments and orders, manage catalog items and inventory, and find customer records for your business.",
    category: PAYMENTS,
    url: "https://mcp.squareup.com/mcp",
    websiteUrl: "https://squareup.com",
    privacyPolicyUrl: "https://squareup.com/legal/general/privacy",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "What were yesterday's sales by location?",
      "List the catalog items that are out of stock",
      "Find the customer record for [name] and their recent orders",
    ],
  },
  {
    id: "ramp",
    displayName: "Ramp",
    shortDescription: "Review company spend, cards and reimbursements",
    longDescription:
      "Use Ramp to look into company spending: transactions, cards, bills and reimbursements.",
    category: PAYMENTS,
    url: "https://mcp.ramp.com/mcp",
    websiteUrl: "https://ramp.com",
    termsOfServiceUrl: "https://ramp.com/legal/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "What did we spend on software last month, by vendor?",
      "List the transactions that are missing receipts",
      "Which bills are due in the next two weeks?",
    ],
  },
  {
    id: "plaid",
    displayName: "Plaid",
    shortDescription: "Debug your Plaid integration",
    longDescription:
      "Use Plaid to look into your own Plaid integration: Link conversion, item health and usage from your Plaid dashboard.",
    category: PAYMENTS,
    url: "https://api.dashboard.plaid.com/mcp/",
    websiteUrl: "https://plaid.com",
    privacyPolicyUrl: "https://plaid.com/legal/#end-user-privacy-policy",
    capabilities: ["Read"],
    examplePrompts: [
      "How is our Link conversion trending this month?",
      "Why is item [id] failing to update?",
      "Summarize our API usage by product for the last 30 days",
    ],
  },
  {
    id: "mercury",
    displayName: "Mercury",
    shortDescription: "Check business account balances and transactions",
    longDescription:
      "Use Mercury to look up balances, transactions and recipients on your Mercury business accounts.",
    category: PAYMENTS,
    url: "https://mcp.mercury.com/mcp",
    websiteUrl: "https://mercury.com",
    privacyPolicyUrl: "https://mercury.com/legal/privacy",
    termsOfServiceUrl: "https://mercury.com/legal/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "What is the current balance of each account?",
      "List last month's outgoing payments over [amount]",
      "How much did we pay [vendor] this year?",
    ],
  },
  {
    id: "dodopayments",
    displayName: "Dodo Payments",
    shortDescription: "Manage products, payments and subscriptions",
    longDescription:
      "Use Dodo Payments to manage products, payments, subscriptions and customers on your merchant account.",
    category: PAYMENTS,
    url: "https://mcp.dodopayments.com/mcp",
    websiteUrl: "https://dodopayments.com",
    privacyPolicyUrl: "https://dodopayments.com/privacy-policy",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the payments from this week and their status",
      "Create a monthly subscription product at [price]",
      "Which subscriptions were cancelled this month?",
    ],
  },
  {
    id: "morningstar",
    displayName: "Morningstar",
    shortDescription: "Look up investment research and data",
    longDescription:
      "Use Morningstar to bring its investment data and research on funds and companies into a conversation.",
    category: PAYMENTS,
    url: "https://mcp.morningstar.com/mcp",
    websiteUrl: "https://www.morningstar.com",
    capabilities: ["Read"],
    examplePrompts: [
      "Summarize Morningstar's research on [company]",
      "Compare the fees and returns of [fund A] and [fund B]",
      "What is the Morningstar rating for [fund]?",
    ],
  },
  {
    id: "daloopa",
    displayName: "Daloopa",
    shortDescription: "Pull sourced financial data on public companies",
    longDescription:
      "Use Daloopa to pull company fundamentals and KPIs from filings, each linked to its source.",
    category: PAYMENTS,
    url: "https://mcp.daloopa.com/server/mcp",
    websiteUrl: "https://daloopa.com",
    privacyPolicyUrl: "https://daloopa.com/privacy-policy",
    capabilities: ["Read"],
    examplePrompts: [
      "Show [company]'s revenue by segment for the last 8 quarters",
      "How has [company]'s gross margin changed since 2023?",
      "Compare the operating metrics of [company A] and [company B]",
    ],
  },
  {
    id: "crypto-com",
    displayName: "Crypto.com",
    shortDescription: "Read live crypto market data",
    longDescription:
      "Use Crypto.com to read public market data: prices, order books, recent trades and instruments. It cannot trade.",
    category: PAYMENTS,
    auth: "none",
    url: "https://mcp.crypto.com/market-data/mcp",
    websiteUrl: "https://crypto.com",
    privacyPolicyUrl: "https://crypto.com/privacy",
    capabilities: ["Read"],
    examplePrompts: [
      "What is the current price of BTC and ETH?",
      "Show the order book for [pair]",
      "How did [token] trade over the last 24 hours?",
    ],
  },
  {
    id: "wordpress",
    displayName: "WordPress.com",
    shortDescription: "Manage your sites, posts and pages",
    longDescription:
      "Use WordPress.com to look through your sites, read and draft posts and pages, and check comments and site stats.",
    category: WEBSITES,
    featured: true,
    url: "https://public-api.wordpress.com/wpcom/v2/mcp/v1",
    websiteUrl: "https://wordpress.com",
    privacyPolicyUrl: "https://automattic.com/privacy/",
    termsOfServiceUrl: "https://wordpress.com/tos/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Draft a blog post from this conversation on [site]",
      "List the posts published this month and their views",
      "Which comments are waiting for moderation?",
    ],
  },
  {
    id: "wix",
    displayName: "Wix",
    shortDescription: "Manage your Wix sites and business tools",
    longDescription:
      "Use Wix to work with your sites and their business tools, such as stores, bookings and the CMS, and to search Wix's documentation.",
    category: WEBSITES,
    url: "https://mcp.wix.com/mcp",
    websiteUrl: "https://www.wix.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the products in my store that have no description",
      "Add a blog post to [site] from this draft",
      "How do I add a booking form with the Wix SDK?",
    ],
  },
  {
    id: "webflow",
    displayName: "Webflow",
    shortDescription: "Edit sites, pages and CMS content",
    longDescription:
      "Use Webflow to look through your sites and pages, manage CMS collections and items, and update page content.",
    category: WEBSITES,
    url: "https://mcp.webflow.com/mcp",
    websiteUrl: "https://webflow.com",
    privacyPolicyUrl: "https://webflow.com/legal/privacy",
    termsOfServiceUrl: "https://webflow.com/legal/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the CMS collections on [site] and their item counts",
      "Add a blog item to [collection] from this draft",
      "Which pages are missing an SEO description?",
    ],
  },
  {
    id: "sanity",
    displayName: "Sanity",
    shortDescription: "Query and edit structured content",
    longDescription:
      "Use Sanity to explore your schemas, query documents, and create or update content in your projects.",
    category: WEBSITES,
    url: "https://mcp.sanity.io",
    websiteUrl: "https://www.sanity.io",
    privacyPolicyUrl: "https://www.sanity.io/legal/privacy",
    termsOfServiceUrl: "https://www.sanity.io/legal/tos",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the document types in [project] and their fields",
      "Find the articles that have no author set",
      "Create a draft [type] document from this text",
    ],
  },
  {
    id: "contentful",
    displayName: "Contentful",
    shortDescription: "Manage entries, assets and content types",
    longDescription:
      "Use Contentful to look through content types, find and edit entries and assets, and publish changes in your spaces.",
    category: WEBSITES,
    url: "https://mcp.contentful.com/mcp",
    websiteUrl: "https://www.contentful.com",
    privacyPolicyUrl:
      "https://www.contentful.com/legal/privacy-and-data-protection/privacy-notice/",
    termsOfServiceUrl: "https://www.contentful.com/legal/customers/terms-of-service/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the content types in [space]",
      "Find the entries that have not been updated this year",
      "Create a draft [type] entry from this text",
    ],
  },
  {
    id: "godaddy",
    displayName: "GoDaddy",
    shortDescription: "Check and suggest domain names",
    longDescription:
      "Use GoDaddy to check whether a domain name is available and to get suggestions for names that are.",
    category: WEBSITES,
    auth: "none",
    url: "https://api.godaddy.com/v1/domains/mcp",
    websiteUrl: "https://www.godaddy.com",
    capabilities: ["Read"],
    examplePrompts: [
      "Is [name].com available?",
      "Suggest ten available domains for a [kind of business]",
      "Check [name] across .com, .io and .dev",
    ],
  },
  {
    id: "gitlab",
    displayName: "GitLab",
    shortDescription: "Work with issues, merge requests and pipelines",
    longDescription:
      "Use GitLab to search projects, read and create issues and merge requests, and check pipeline results on GitLab.com.",
    category: DEVELOPER_TOOLS,
    url: "https://gitlab.com/api/v4/mcp",
    websiteUrl: "https://gitlab.com",
    privacyPolicyUrl: "https://gitlab.com/privacy",
    termsOfServiceUrl: "https://gitlab.com/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the merge requests waiting for my review",
      "Why did the last pipeline on [project] fail?",
      "Create an issue in [project] for the bug we just found",
    ],
  },
  {
    id: "neon",
    displayName: "Neon",
    shortDescription: "Manage Postgres projects and branches",
    longDescription:
      "Use Neon to manage Postgres projects and branches, run SQL, and prepare schema migrations on a branch before applying them.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.neon.tech/mcp",
    websiteUrl: "https://neon.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my Neon projects and their branches",
      "Show the tables in [project] and their sizes",
      "Try a migration that adds [column] to [table] on a new branch",
    ],
  },
  {
    id: "netlify",
    displayName: "Netlify",
    shortDescription: "Manage sites, deploys and environment variables",
    longDescription:
      "Use Netlify to look through your sites, check deploys and their logs, and manage environment variables.",
    category: DEVELOPER_TOOLS,
    url: "https://netlify-mcp.netlify.app/mcp",
    websiteUrl: "https://www.netlify.com",
    privacyPolicyUrl: "https://www.netlify.com/privacy/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Why did the latest deploy of [site] fail?",
      "List the environment variables set on [site]",
      "Which of my sites were deployed this week?",
    ],
  },
  {
    id: "prisma",
    displayName: "Prisma",
    shortDescription: "Manage Prisma Postgres databases",
    longDescription:
      "Use Prisma to create and manage Prisma Postgres databases, run queries, and work with backups.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.prisma.io/mcp",
    websiteUrl: "https://www.prisma.io",
    privacyPolicyUrl: "https://www.prisma.io/legal/privacy",
    termsOfServiceUrl: "https://www.prisma.io/legal/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my Prisma Postgres databases",
      "Create a database for [project] in [region]",
      "Show the schema of [database]",
    ],
  },
  {
    id: "planetscale",
    displayName: "PlanetScale",
    shortDescription: "Inspect databases, branches and query insights",
    longDescription:
      "Use PlanetScale to look through databases and branches, read schemas, run queries and check query insights.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.pscale.dev/mcp/planetscale",
    websiteUrl: "https://planetscale.com",
    privacyPolicyUrl: "https://planetscale.com/legal/privacy",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the branches of [database] and which are in production",
      "Which queries were slowest on [database] today?",
      "Show the schema of [table]",
    ],
  },
  {
    id: "railway",
    displayName: "Railway",
    shortDescription: "Manage projects, services and deployments",
    longDescription:
      "Use Railway to look through projects and services, check deployments and their logs, and manage variables.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.railway.com/mcp",
    websiteUrl: "https://railway.com",
    privacyPolicyUrl: "https://railway.com/legal/privacy",
    termsOfServiceUrl: "https://railway.com/legal/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Why did the latest deployment of [service] fail?",
      "Show the logs for [service] from the last hour",
      "List the variables set on [service]",
    ],
  },
  {
    id: "buildkite",
    displayName: "Buildkite",
    shortDescription: "Check pipelines, builds and job logs",
    longDescription:
      "Use Buildkite to look through pipelines and builds, read job logs, and find out why a build failed.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.buildkite.com/mcp",
    websiteUrl: "https://buildkite.com",
    privacyPolicyUrl: "https://buildkite.com/about/privacy-policy/",
    termsOfServiceUrl: "https://buildkite.com/about/terms-of-service/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Why did the latest build on [pipeline] fail?",
      "List the builds that are running right now",
      "Which tests have been flaky on main this week?",
    ],
  },
  {
    id: "launchdarkly",
    displayName: "LaunchDarkly",
    shortDescription: "Manage feature flags",
    longDescription:
      "Use LaunchDarkly to look through feature flags, check their targeting in each environment, and create or update flags.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.launchdarkly.com/mcp",
    websiteUrl: "https://launchdarkly.com",
    privacyPolicyUrl: "https://launchdarkly.com/privacy/",
    termsOfServiceUrl: "https://launchdarkly.com/terms-of-service/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Which flags in [project] are on in production?",
      "Create a boolean flag called [name], off by default",
      "List the flags that have not changed in 90 days",
    ],
  },
  {
    id: "stytch",
    displayName: "Stytch",
    shortDescription: "Manage your Stytch projects",
    longDescription:
      "Use Stytch to manage the settings of your authentication projects, such as redirect URLs, email templates and SDK configuration.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.stytch.dev/mcp",
    websiteUrl: "https://stytch.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my Stytch projects and their environments",
      "Add [url] as a redirect URL in the test environment",
      "Show the email templates configured for [project]",
    ],
  },
  {
    id: "clerk",
    displayName: "Clerk",
    shortDescription: "Get Clerk SDK guidance and code",
    longDescription:
      "Use Clerk to look up current Clerk SDK guidance and code examples while you add authentication to an app.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.clerk.com/mcp",
    websiteUrl: "https://clerk.com",
    privacyPolicyUrl: "https://clerk.com/legal/privacy",
    termsOfServiceUrl: "https://clerk.com/legal/standard-terms",
    capabilities: ["Read"],
    examplePrompts: [
      "How do I protect a route in Next.js with Clerk?",
      "Show the current way to read the signed-in user on the server",
      "Add organization switching to this app",
    ],
  },
  {
    id: "upstash",
    displayName: "Upstash",
    shortDescription: "Manage Redis databases and queues",
    longDescription:
      "Use Upstash to manage Redis databases, run commands against them, and work with QStash messages and schedules.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.upstash.com/mcp",
    websiteUrl: "https://upstash.com",
    privacyPolicyUrl: "https://upstash.com/trust/privacy",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my Redis databases and their regions",
      "How many keys match [pattern] in [database]?",
      "Show the QStash schedules that failed today",
    ],
  },
  {
    id: "jam",
    displayName: "Jam",
    shortDescription: "Read bug reports with their console and network logs",
    longDescription:
      "Use Jam to open a bug report and read its video, console logs, network requests and reproduction steps.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.jam.dev/mcp",
    websiteUrl: "https://jam.dev",
    privacyPolicyUrl: "https://jam.dev/legal/privacy-policy",
    termsOfServiceUrl: "https://jam.dev/legal/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "Read this Jam and find the cause: [link]",
      "Which network requests failed in [Jam]?",
      "Summarize the steps to reproduce [Jam]",
    ],
  },
  {
    id: "semgrep",
    displayName: "Semgrep",
    shortDescription: "Scan code for security issues",
    longDescription:
      "Use Semgrep to scan code for security vulnerabilities and review the findings in your Semgrep account.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.semgrep.ai/mcp",
    websiteUrl: "https://semgrep.dev",
    privacyPolicyUrl: "https://semgrep.dev/legal/privacy/",
    termsOfServiceUrl: "https://semgrep.dev/legal/terms/",
    capabilities: ["Read"],
    examplePrompts: [
      "Scan the files I changed for security issues",
      "List the open high-severity findings in [project]",
      "Explain this finding and how to fix it",
    ],
  },
  {
    id: "port",
    displayName: "Port",
    shortDescription: "Query your software catalog and scorecards",
    longDescription:
      "Use Port to look up services in your software catalog, check scorecards, and run the self-service actions your team has set up.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.port.io/v1",
    websiteUrl: "https://www.port.io",
    privacyPolicyUrl: "https://www.port.io/legal/privacy-policy",
    termsOfServiceUrl: "https://www.port.io/legal/terms-of-service",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Who owns [service] and where is it deployed?",
      "Which services are failing the production-readiness scorecard?",
      "List the services with open incidents",
    ],
  },
  {
    id: "scorecard",
    displayName: "Scorecard",
    shortDescription: "Run and review AI evaluations",
    longDescription:
      "Use Scorecard to manage test sets and metrics and to review the results of evaluation runs for your AI features.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.scorecard.io/mcp",
    websiteUrl: "https://www.scorecard.io",
    privacyPolicyUrl: "https://www.scorecard.io/privacy-policy",
    termsOfServiceUrl: "https://www.scorecard.io/terms-of-service",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the latest runs for [project] and their scores",
      "Which test cases regressed in the last run?",
      "Create a test set from these examples",
    ],
  },
  {
    id: "globalping",
    displayName: "Globalping",
    shortDescription: "Run network tests from around the world",
    longDescription:
      "Use Globalping to run ping, traceroute, DNS and HTTP checks from probes in many countries.",
    category: DEVELOPER_TOOLS,
    url: "https://mcp.globalping.dev/mcp",
    websiteUrl: "https://globalping.io",
    termsOfServiceUrl: "https://globalping.io/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "Ping [host] from five continents and compare the latency",
      "Does [domain] resolve the same from Europe and Asia?",
      "Check the HTTP response time of [url] from the US and Germany",
    ],
  },
  {
    id: "huggingface",
    displayName: "Hugging Face",
    shortDescription: "Search models, datasets and Spaces",
    longDescription:
      "Use Hugging Face to search the Hub for models, datasets and Spaces and read their details. This uses public access, without your Hugging Face account.",
    category: DEVELOPER_TOOLS,
    auth: "none",
    url: "https://huggingface.co/mcp",
    websiteUrl: "https://huggingface.co",
    privacyPolicyUrl: "https://huggingface.co/privacy",
    termsOfServiceUrl: "https://huggingface.co/Terms",
    capabilities: ["Read"],
    examplePrompts: [
      "Find small open models for [task], sorted by downloads",
      "What license and context size does [model] have?",
      "Find datasets for [task] in [language]",
    ],
  },
  {
    id: "convex",
    displayName: "Convex",
    shortDescription: "Get setup and scaling guidance for Convex",
    longDescription:
      "Use Convex to get its current guidance for starting a new app, adding Convex to an existing project, and scaling.",
    category: DEVELOPER_TOOLS,
    auth: "none",
    url: "https://mcp.convex.dev/mcp",
    websiteUrl: "https://www.convex.dev",
    privacyPolicyUrl: "https://www.convex.dev/legal/privacy",
    capabilities: ["Read"],
    examplePrompts: [
      "Start a new Convex app with [framework]",
      "Add Convex to this project",
      "What should I check before this Convex app takes more traffic?",
    ],
  },
  {
    id: "datadog",
    displayName: "Datadog",
    shortDescription: "Search logs, metrics, traces and monitors",
    longDescription:
      "Use Datadog to search logs, query metrics, read traces and check monitors and incidents while you debug.",
    category: MONITORING,
    url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
    websiteUrl: "https://www.datadoghq.com",
    privacyPolicyUrl: "https://www.datadoghq.com/privacy/",
    termsOfServiceUrl: "https://www.datadoghq.com/legal/terms/",
    capabilities: ["Read"],
    examplePrompts: [
      "Show the error logs for [service] from the last hour",
      "Which monitors are alerting right now?",
      "Find the slowest traces for [endpoint] today",
    ],
  },
  {
    id: "grafana",
    displayName: "Grafana",
    shortDescription: "Query dashboards, metrics and alerts",
    longDescription:
      "Use Grafana to find dashboards, query your data sources, and check alerts and incidents in Grafana Cloud.",
    category: MONITORING,
    url: "https://mcp.grafana.com/mcp",
    websiteUrl: "https://grafana.com",
    capabilities: ["Read"],
    examplePrompts: [
      "Which alerts are firing right now?",
      "Find the dashboard for [service] and summarize its panels",
      "Query the error rate of [service] for the last 6 hours",
    ],
  },
  {
    id: "honeycomb",
    displayName: "Honeycomb",
    shortDescription: "Query traces and check SLOs",
    longDescription:
      "Use Honeycomb to run queries over your telemetry, read traces, and check SLOs and triggers.",
    category: MONITORING,
    url: "https://mcp.honeycomb.io/mcp",
    websiteUrl: "https://www.honeycomb.io",
    privacyPolicyUrl: "https://www.honeycomb.io/privacy",
    termsOfServiceUrl: "https://www.honeycomb.io/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "What is driving the latency of [endpoint] today?",
      "Which SLOs are burning budget fastest?",
      "Show a slow trace for [service] and explain it",
    ],
  },
  {
    id: "incidentio",
    displayName: "incident.io",
    shortDescription: "Look up incidents and follow-ups",
    longDescription:
      "Use incident.io to look through incidents, their timelines and follow-up actions, and to see who is on call.",
    category: MONITORING,
    url: "https://mcp.incident.io/mcp",
    websiteUrl: "https://incident.io",
    privacyPolicyUrl: "https://incident.io/legal/privacy",
    termsOfServiceUrl: "https://incident.io/legal/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Summarize the incidents from the last 7 days",
      "Which follow-ups from [incident] are still open?",
      "Who is on call for [team] right now?",
    ],
  },
  {
    id: "rootly",
    displayName: "Rootly",
    shortDescription: "Manage incidents and on-call",
    longDescription:
      "Use Rootly to look through incidents and their action items, check on-call schedules, and update an incident from a conversation.",
    category: MONITORING,
    url: "https://mcp.rootly.com/mcp",
    websiteUrl: "https://rootly.com",
    privacyPolicyUrl: "https://rootly.com/legal/privacy",
    termsOfServiceUrl: "https://rootly.com/legal/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the open incidents and their severity",
      "Who is on call for [service] this week?",
      "Write a retrospective draft for [incident]",
    ],
  },
  {
    id: "posthog",
    displayName: "PostHog",
    shortDescription: "Query product analytics, flags and errors",
    longDescription:
      "Use PostHog to query product analytics, read insights and dashboards, manage feature flags, and look into errors.",
    category: DATA,
    url: "https://mcp.posthog.com/mcp",
    websiteUrl: "https://posthog.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "How many weekly active users did we have over the last 8 weeks?",
      "Which errors affected the most users today?",
      "Create a feature flag for [feature] at 10% rollout",
    ],
  },
  {
    id: "amplitude",
    displayName: "Amplitude",
    shortDescription: "Explore charts, dashboards and experiments",
    longDescription:
      "Use Amplitude to search charts and dashboards, query events, and read experiment results.",
    category: DATA,
    url: "https://mcp.amplitude.com/mcp",
    websiteUrl: "https://amplitude.com",
    privacyPolicyUrl: "https://amplitude.com/privacy",
    termsOfServiceUrl: "https://amplitude.com/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "What is our signup-to-activation conversion this month?",
      "Summarize the results of [experiment]",
      "Find the dashboard for [team] and list its charts",
    ],
  },
  {
    id: "mixpanel",
    displayName: "Mixpanel",
    shortDescription: "Query events, funnels and retention",
    longDescription:
      "Use Mixpanel to query events, funnels and retention, and to look through your saved reports.",
    category: DATA,
    url: "https://mcp.mixpanel.com/mcp",
    websiteUrl: "https://mixpanel.com",
    privacyPolicyUrl: "https://mixpanel.com/legal/privacy-policy/",
    termsOfServiceUrl: "https://mixpanel.com/legal/terms-of-use/",
    capabilities: ["Read"],
    examplePrompts: [
      "How did [event] trend over the last 30 days?",
      "Where do users drop off in the onboarding funnel?",
      "Compare 4-week retention for users from [source A] and [source B]",
    ],
  },
  {
    id: "pendo",
    displayName: "Pendo",
    shortDescription: "Look into product usage and feedback",
    longDescription:
      "Use Pendo to look into how pages and features are used, how accounts and visitors behave, and how guides perform.",
    category: DATA,
    url: "https://app.pendo.io/mcp/v0/shttp",
    websiteUrl: "https://www.pendo.io",
    privacyPolicyUrl: "https://www.pendo.io/legal/privacy-policy/",
    termsOfServiceUrl: "https://www.pendo.io/legal/terms-of-use/",
    capabilities: ["Read"],
    examplePrompts: [
      "Which features were used least this quarter?",
      "How is [account] using the product compared with last month?",
      "How did the [guide] guide perform?",
    ],
  },
  {
    id: "hex",
    displayName: "Hex",
    shortDescription: "Ask questions of your data projects",
    longDescription:
      "Use Hex to search your data projects and ask questions that Hex answers from your workspace's data.",
    category: DATA,
    url: "https://app.hex.tech/mcp",
    websiteUrl: "https://hex.tech",
    capabilities: ["Read"],
    examplePrompts: [
      "Find the Hex project on [topic] and summarize it",
      "What was revenue by region last quarter?",
      "Which projects use the [table] table?",
    ],
  },
  {
    id: "thoughtspot",
    displayName: "ThoughtSpot",
    shortDescription: "Get answers from your business data",
    longDescription:
      "Use ThoughtSpot to ask questions of your data models and bring the answers and charts into a conversation.",
    category: DATA,
    url: "https://agent.thoughtspot.app/mcp",
    websiteUrl: "https://www.thoughtspot.com",
    capabilities: ["Read"],
    examplePrompts: [
      "What were sales by product line last quarter?",
      "Which regions grew fastest year over year?",
      "Break down churn by plan for the last 6 months",
    ],
  },
  {
    id: "motherduck",
    displayName: "MotherDuck",
    shortDescription: "Run SQL on your MotherDuck databases",
    longDescription: "Use MotherDuck to explore your databases and run DuckDB SQL against them.",
    category: DATA,
    url: "https://api.motherduck.com/mcp",
    websiteUrl: "https://motherduck.com",
    privacyPolicyUrl: "https://motherduck.com/privacy-policy/",
    termsOfServiceUrl: "https://motherduck.com/terms-of-service/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my databases and their tables",
      "Show the 10 largest tables in [database]",
      "Write and run a query for [question]",
    ],
  },
  {
    id: "semrush",
    displayName: "Semrush",
    shortDescription: "Pull SEO and traffic data",
    longDescription: "Use Semrush to pull keyword, backlink and traffic data for a domain.",
    category: DATA,
    url: "https://mcp.semrush.com/v1/mcp",
    websiteUrl: "https://www.semrush.com",
    privacyPolicyUrl: "https://www.semrush.com/company/legal/privacy-policy/",
    termsOfServiceUrl: "https://www.semrush.com/company/legal/terms-of-service/",
    capabilities: ["Read"],
    examplePrompts: [
      "Which keywords does [domain] rank for in the top 10?",
      "Compare the organic traffic of [domain A] and [domain B]",
      "Find keyword ideas for [topic] with low difficulty",
    ],
  },
  {
    id: "monday",
    displayName: "monday.com",
    shortDescription: "Manage boards, items and updates",
    longDescription:
      "Use monday.com to look through boards, create and update items, and post updates.",
    category: PLANNING,
    url: "https://mcp.monday.com/mcp",
    websiteUrl: "https://monday.com",
    privacyPolicyUrl: "https://monday.com/l/privacy/privacy-policy/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the items assigned to me that are due this week",
      "Create an item on [board] for each action item above",
      "Summarize what changed on [board] this week",
    ],
  },
  {
    id: "airtable",
    displayName: "Airtable",
    shortDescription: "Read and edit bases, tables and records",
    longDescription:
      "Use Airtable to look through bases and tables, search records, and create or update them.",
    category: PLANNING,
    url: "https://mcp.airtable.com/mcp",
    websiteUrl: "https://www.airtable.com",
    privacyPolicyUrl: "https://www.airtable.com/company/privacy",
    termsOfServiceUrl: "https://www.airtable.com/company/tos",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the tables in [base] and their fields",
      "Find the records in [table] where [field] is empty",
      "Add a record to [table] from this conversation",
    ],
  },
  {
    id: "todoist",
    displayName: "Todoist",
    shortDescription: "Manage tasks and projects",
    longDescription:
      "Use Todoist to look through your tasks and projects, add tasks, and reschedule or complete them.",
    category: PLANNING,
    url: "https://ai.todoist.net/mcp",
    websiteUrl: "https://www.todoist.com",
    privacyPolicyUrl: "https://www.todoist.com/privacy",
    termsOfServiceUrl: "https://www.todoist.com/terms-of-service",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "What is due today and overdue?",
      "Add a task for each action item above",
      "Move everything due tomorrow in [project] to Friday",
    ],
  },
  {
    id: "coda",
    displayName: "Coda",
    shortDescription: "Read and edit docs and tables",
    longDescription:
      "Use Coda to search your docs, read pages and tables, and add or update rows and content.",
    category: PLANNING,
    url: "https://coda.io/apis/mcp",
    websiteUrl: "https://coda.io",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Find our planning doc and summarize this quarter's goals",
      "List the rows in [table] that are still open",
      "Add a row to [table] from this conversation",
    ],
  },
  {
    id: "guru",
    displayName: "Guru",
    shortDescription: "Search your company knowledge",
    longDescription:
      "Use Guru to search your company's verified knowledge and get answers with their sources.",
    category: PLANNING,
    url: "https://mcp.api.getguru.com/mcp",
    websiteUrl: "https://www.getguru.com",
    privacyPolicyUrl: "https://www.getguru.com/privacy",
    termsOfServiceUrl: "https://www.getguru.com/terms-of-service",
    capabilities: ["Read"],
    examplePrompts: [
      "What is our policy on [topic]?",
      "Find the card that explains [process]",
      "Which cards about [topic] are out of date?",
    ],
  },
  {
    id: "shortcut",
    displayName: "Shortcut",
    shortDescription: "Work with stories, epics and iterations",
    longDescription:
      "Use Shortcut to search stories and epics, create and update stories, and check an iteration's progress.",
    category: PLANNING,
    url: "https://mcp.shortcut.com/mcp",
    websiteUrl: "https://www.shortcut.com",
    privacyPolicyUrl: "https://www.shortcut.com/privacy/",
    termsOfServiceUrl: "https://www.shortcut.com/terms/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my stories in the current iteration",
      "Create a story for the bug we just found",
      "How far along is [epic]?",
    ],
  },
  {
    id: "dropbox",
    displayName: "Dropbox",
    shortDescription: "Search and read your files",
    longDescription:
      "Use Dropbox to search your files and folders and read their contents in a conversation.",
    category: PLANNING,
    url: "https://mcp.dropbox.com/mcp",
    websiteUrl: "https://www.dropbox.com",
    privacyPolicyUrl: "https://www.dropbox.com/privacy",
    termsOfServiceUrl: "https://www.dropbox.com/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "Find the latest version of [document]",
      "Summarize the files in [folder]",
      "Which files did I change this week?",
    ],
  },
  {
    id: "egnyte",
    displayName: "Egnyte",
    shortDescription: "Search and read company files",
    longDescription:
      "Use Egnyte to search your company's files and read documents you have access to.",
    category: PLANNING,
    url: "https://mcp-server.egnyte.com/mcp",
    websiteUrl: "https://www.egnyte.com",
    privacyPolicyUrl: "https://www.egnyte.com/privacy-policy",
    termsOfServiceUrl: "https://www.egnyte.com/terms-of-service",
    capabilities: ["Read"],
    examplePrompts: [
      "Find the contract with [company]",
      "Summarize the documents in [folder]",
      "Which files mention [topic]?",
    ],
  },
  {
    id: "granola",
    displayName: "Granola",
    shortDescription: "Search your meeting notes",
    longDescription:
      "Use Granola to search your meeting notes and transcripts and pull out decisions and action items.",
    category: MEETINGS,
    url: "https://mcp.granola.ai/mcp",
    websiteUrl: "https://www.granola.ai",
    privacyPolicyUrl: "https://docs.granola.ai/help-center/policies/privacy-policy",
    termsOfServiceUrl:
      "https://docs.granola.ai/help-center/policies/terms-of-service/application-terms-of-service",
    capabilities: ["Read"],
    examplePrompts: [
      "What did we decide in my last meeting with [person]?",
      "List my action items from this week's meetings",
      "Summarize every meeting about [project] this month",
    ],
  },
  {
    id: "fireflies",
    displayName: "Fireflies",
    shortDescription: "Search meeting transcripts and summaries",
    longDescription:
      "Use Fireflies to search your meeting transcripts and read summaries and action items.",
    category: MEETINGS,
    url: "https://api.fireflies.ai/mcp",
    websiteUrl: "https://fireflies.ai",
    capabilities: ["Read"],
    examplePrompts: [
      "Summarize yesterday's [meeting]",
      "What did [person] say about [topic] in recent calls?",
      "List the action items from this week's meetings",
    ],
  },
  {
    id: "calcom",
    displayName: "Cal.com",
    shortDescription: "Manage bookings, event types and availability",
    longDescription:
      "Use Cal.com to look through your bookings, check availability, and manage event types and schedules.",
    category: MEETINGS,
    url: "https://mcp.cal.com/mcp",
    websiteUrl: "https://cal.com",
    privacyPolicyUrl: "https://cal.com/privacy",
    termsOfServiceUrl: "https://cal.com/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "What is on my calendar for tomorrow?",
      "Find three free 30-minute slots next week",
      "Create a 45-minute event type called [name]",
    ],
  },
  {
    id: "miro",
    displayName: "Miro",
    shortDescription: "Read boards and add diagrams",
    longDescription: "Use Miro to read what is on a board and to add diagrams and documents to it.",
    category: DESIGN,
    url: "https://mcp.miro.com/",
    websiteUrl: "https://miro.com",
    privacyPolicyUrl: "https://miro.com/legal/privacy-policy/",
    termsOfServiceUrl: "https://miro.com/legal/terms-of-service/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Summarize the sticky notes on [board] by theme",
      "Draw the architecture we just discussed on [board]",
      "Turn the flow on [board] into a written spec",
    ],
  },
  {
    id: "mermaid-chart",
    displayName: "Mermaid Chart",
    shortDescription: "Create and validate Mermaid diagrams",
    longDescription:
      "Use Mermaid Chart to check Mermaid diagram syntax, render diagrams, and save them to your account.",
    category: DESIGN,
    url: "https://mcp.mermaidchart.com/mcp",
    websiteUrl: "https://www.mermaidchart.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Draw a sequence diagram of the login flow in this repo",
      "Fix the syntax errors in this Mermaid diagram",
      "Turn this description into a flowchart",
    ],
  },
  {
    id: "lucid",
    displayName: "Lucid",
    shortDescription: "Find and create Lucidchart diagrams",
    longDescription:
      "Use Lucid to search your documents, read what a diagram contains, and create new diagrams.",
    category: DESIGN,
    url: "https://mcp.lucid.app/mcp",
    websiteUrl: "https://lucid.co",
    privacyPolicyUrl: "https://lucid.co/privacy",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Find our network diagram and describe it",
      "Create a flowchart of the process we just described",
      "Which documents mention [system]?",
    ],
  },
  {
    id: "excalidraw",
    displayName: "Excalidraw",
    shortDescription: "Sketch hand-drawn style diagrams",
    longDescription:
      "Use Excalidraw to turn a description into a hand-drawn style diagram you can open and edit in Excalidraw.",
    category: DESIGN,
    auth: "none",
    url: "https://mcp.excalidraw.com/mcp",
    websiteUrl: "https://excalidraw.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Sketch the architecture of this project",
      "Draw a flow for the checkout process",
      "Turn this list into a mind map",
    ],
  },
  {
    id: "cloudinary",
    displayName: "Cloudinary",
    shortDescription: "Manage images and videos",
    longDescription:
      "Use Cloudinary to search, upload and organize the images and videos in your media library.",
    category: DESIGN,
    url: "https://asset-management.mcp.cloudinary.com/mcp",
    websiteUrl: "https://cloudinary.com",
    privacyPolicyUrl: "https://cloudinary.com/privacy",
    termsOfServiceUrl: "https://cloudinary.com/tou",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Find the images tagged [tag] that are larger than 2 MB",
      "Upload this image and give me a 1200px wide URL",
      "List the videos added this week",
    ],
  },
  {
    id: "invideo",
    displayName: "invideo",
    shortDescription: "Generate videos from a script",
    longDescription:
      "Use invideo to turn a script or a brief into a video in your invideo account.",
    category: DESIGN,
    url: "https://mcp.invideo.io/mcp",
    websiteUrl: "https://invideo.io",
    privacyPolicyUrl: "https://invideo.io/privacy-policy/",
    termsOfServiceUrl: "https://invideo.io/terms-of-service/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Make a 30-second video announcing [feature]",
      "Turn this blog post into a short explainer video",
      "Create a vertical video from this script",
    ],
  },
  {
    id: "plain",
    displayName: "Plain",
    shortDescription: "Work with support threads and customers",
    longDescription:
      "Use Plain to look through support threads and customers and to draft replies with the full history at hand.",
    category: SUPPORT,
    url: "https://mcp.plain.com/mcp",
    websiteUrl: "https://www.plain.com",
    privacyPolicyUrl: "https://www.plain.com/legal/privacy-policy",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the threads waiting on us for more than a day",
      "What has [customer] written in about before?",
      "Draft a reply to [thread]",
    ],
  },
  {
    id: "pylon",
    displayName: "Pylon",
    shortDescription: "Look up customer issues and accounts",
    longDescription:
      "Use Pylon to search customer issues and accounts so you can answer with the real history in front of you.",
    category: SUPPORT,
    url: "https://mcp.usepylon.com/",
    websiteUrl: "https://www.usepylon.com",
    privacyPolicyUrl: "https://www.usepylon.com/legal/privacy",
    termsOfServiceUrl: "https://www.usepylon.com/legal/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the open issues for [account]",
      "Which issues have been waiting longest?",
      "Summarize this week's issues about [topic]",
    ],
  },
  {
    id: "close",
    displayName: "Close",
    shortDescription: "Work with leads, contacts and opportunities",
    longDescription:
      "Use Close to search leads and opportunities, read their activity, and update them.",
    category: SALES,
    url: "https://mcp.close.com/mcp",
    websiteUrl: "https://www.close.com",
    privacyPolicyUrl: "https://close.com/privacy",
    termsOfServiceUrl: "https://close.com/tos",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List the opportunities expected to close this month",
      "What was the last contact with [lead]?",
      "Add a note to [lead] summarizing this call",
    ],
  },
  {
    id: "apollo",
    displayName: "Apollo",
    shortDescription: "Find and enrich contacts and companies",
    longDescription:
      "Use Apollo to search for people and companies, enrich records, and work with your sequences.",
    category: SALES,
    url: "https://mcp.apollo.io/mcp",
    websiteUrl: "https://www.apollo.io",
    privacyPolicyUrl: "https://www.apollo.io/privacy-policy",
    termsOfServiceUrl: "https://www.apollo.io/terms",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Find heads of engineering at [kind of company] in [region]",
      "Enrich this list of company domains",
      "Which contacts replied to [sequence] this week?",
    ],
  },
  {
    id: "clay",
    displayName: "Clay",
    shortDescription: "Research people and companies",
    longDescription: "Use Clay to look up and enrich information about people and companies.",
    category: SALES,
    url: "https://api.clay.com/v3/mcp",
    websiteUrl: "https://www.clay.com",
    privacyPolicyUrl: "https://www.clay.com/privacy",
    capabilities: ["Read"],
    examplePrompts: [
      "Research [company] before my call",
      "Find the people at [company] who work on [function]",
      "What do we know about [person]?",
    ],
  },
  {
    id: "klaviyo",
    displayName: "Klaviyo",
    shortDescription: "Review campaigns, flows and audiences",
    longDescription:
      "Use Klaviyo to look into campaign and flow performance, and to work with lists, segments and profiles.",
    category: SALES,
    url: "https://mcp.klaviyo.com/mcp",
    websiteUrl: "https://www.klaviyo.com",
    privacyPolicyUrl: "https://privacy.klaviyo.com/policies/?name=klaviyo-privacy-policy",
    termsOfServiceUrl: "https://www.klaviyo.com/legal/terms-of-service",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "How did last week's campaigns perform?",
      "Which flows bring in the most revenue?",
      "How large is the [segment] segment and how has it changed?",
    ],
  },
  {
    id: "mailchimp",
    displayName: "Mailchimp",
    shortDescription: "Review audiences and campaigns",
    longDescription:
      "Use Mailchimp to look through audiences and campaigns and see how each one performed.",
    category: SALES,
    url: "https://mcp.mailchimp.com/mcp",
    websiteUrl: "https://mailchimp.com",
    termsOfServiceUrl: "https://mailchimp.com/legal/terms/",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "How did the last five campaigns perform?",
      "How has [audience] grown this quarter?",
      "Draft a campaign announcing [news]",
    ],
  },
  {
    id: "customerio",
    displayName: "Customer.io",
    shortDescription: "Work with campaigns, segments and people",
    longDescription:
      "Use Customer.io to look through campaigns and segments and to check what messages a person has received.",
    category: SALES,
    url: "https://mcp.customer.io/mcp",
    websiteUrl: "https://customer.io",
    privacyPolicyUrl: "https://customer.io/legal/privacy-policy",
    termsOfServiceUrl: "https://customer.io/legal/terms-of-service",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Which campaigns are active and how are they converting?",
      "How many people are in [segment]?",
      "What messages did [person] receive this month?",
    ],
  },
  {
    id: "brevo",
    displayName: "Brevo",
    shortDescription: "Manage contacts and email campaigns",
    longDescription:
      "Use Brevo to manage contacts and lists and to review or prepare email campaigns.",
    category: SALES,
    url: "https://mcp.brevo.com/v1/brevo/mcp",
    websiteUrl: "https://www.brevo.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "How did the last campaign perform?",
      "Add these contacts to [list]",
      "Draft an email campaign about [topic]",
    ],
  },
  {
    id: "resend",
    displayName: "Resend",
    shortDescription: "Send email and check delivery",
    longDescription:
      "Use Resend to send email from your verified domains, manage audiences, and check whether messages were delivered.",
    category: SALES,
    url: "https://mcp.resend.com/mcp",
    websiteUrl: "https://resend.com",
    privacyPolicyUrl: "https://resend.com/legal/privacy-policy",
    termsOfServiceUrl: "https://resend.com/legal/terms-of-service",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Was the email to [address] delivered?",
      "List my domains and their verification status",
      "Send this summary to [address]",
    ],
  },
  {
    id: "bitly",
    displayName: "Bitly",
    shortDescription: "Create short links and check clicks",
    longDescription:
      "Use Bitly to shorten links, create QR codes, and see how many clicks each link received.",
    category: SALES,
    url: "https://api-ssl.bitly.com/v4/mcp",
    websiteUrl: "https://bitly.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Shorten [url] with the back-half [name]",
      "How many clicks did [link] get this week?",
      "Create a QR code for [url]",
    ],
  },
  {
    id: "jotform",
    displayName: "Jotform",
    shortDescription: "Build forms and read submissions",
    longDescription:
      "Use Jotform to create and edit forms and to read and summarize their submissions.",
    category: SALES,
    url: "https://mcp.jotform.com",
    websiteUrl: "https://www.jotform.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Summarize the submissions to [form] from this week",
      "Create a feedback form with these questions",
      "How many people answered [question] with [answer]?",
    ],
  },
  {
    id: "zapier",
    displayName: "Zapier",
    shortDescription: "Run actions in thousands of apps",
    longDescription:
      "Use Zapier to run the actions you have enabled in your Zapier account across the apps it connects to.",
    category: AUTOMATION,
    url: "https://mcp.zapier.com/api/mcp/mcp",
    websiteUrl: "https://zapier.com",
    privacyPolicyUrl: "https://zapier.com/privacy",
    termsOfServiceUrl: "https://zapier.com/legal/terms-of-service",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Add a row to [spreadsheet] with this summary",
      "Create a calendar event for [meeting]",
      "Post this update to [channel]",
    ],
  },
  {
    id: "make",
    displayName: "Make",
    shortDescription: "Run your Make scenarios",
    longDescription:
      "Use Make to list the scenarios in your account and run the ones set up to be run on demand.",
    category: AUTOMATION,
    url: "https://mcp.make.com",
    websiteUrl: "https://www.make.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "List my scenarios and when each last ran",
      "Run [scenario] with this input",
      "Which scenarios failed this week?",
    ],
  },
  {
    id: "tavily",
    displayName: "Tavily",
    shortDescription: "Search the web and extract pages",
    longDescription:
      "Use Tavily to search the web and to pull the readable content out of pages for research.",
    category: RESEARCH,
    url: "https://mcp.tavily.com/mcp",
    websiteUrl: "https://www.tavily.com",
    privacyPolicyUrl: "https://www.tavily.com/privacy",
    termsOfServiceUrl: "https://www.tavily.com/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "Research [topic] and cite your sources",
      "Extract the main content of [url]",
      "Find recent news about [company]",
    ],
  },
  {
    id: "apify",
    displayName: "Apify",
    shortDescription: "Run web scrapers and read their results",
    longDescription:
      "Use Apify to find and run Actors, its ready-made web scrapers, and read the data they return.",
    category: RESEARCH,
    url: "https://mcp.apify.com",
    websiteUrl: "https://apify.com",
    privacyPolicyUrl: "https://docs.apify.com/legal/privacy-policy",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Find an Actor that scrapes [site]",
      "Run [Actor] for [input] and summarize the results",
      "Show the results of my last run",
    ],
  },
  {
    id: "exa",
    displayName: "Exa",
    shortDescription: "Search the web",
    longDescription:
      "Use Exa to search the web and read pages. This uses Exa's public access, which is rate limited.",
    category: RESEARCH,
    auth: "none",
    url: "https://mcp.exa.ai/mcp",
    websiteUrl: "https://exa.ai",
    privacyPolicyUrl: "https://exa.ai/privacy-policy",
    capabilities: ["Read"],
    examplePrompts: [
      "Find recent articles about [topic]",
      "Read [url] and summarize it",
      "Find the official documentation for [library]",
    ],
  },
  {
    id: "context7",
    displayName: "Context7",
    shortDescription: "Look up current library documentation",
    longDescription:
      "Use Context7 to pull current, version-specific documentation and code examples for a library.",
    category: RESEARCH,
    auth: "none",
    url: "https://mcp.context7.com/mcp",
    websiteUrl: "https://context7.com",
    privacyPolicyUrl: "https://context7.com/privacy",
    termsOfServiceUrl: "https://context7.com/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "How do I set up routing in the latest [framework]?",
      "Show the current API for [function] in [library]",
      "What changed in [library] version [n]?",
    ],
  },
  {
    id: "deepwiki",
    displayName: "DeepWiki",
    shortDescription: "Ask questions about public GitHub repositories",
    longDescription:
      "Use DeepWiki to read generated documentation for a public GitHub repository and ask questions about how it works.",
    category: RESEARCH,
    auth: "none",
    url: "https://mcp.deepwiki.com/mcp",
    websiteUrl: "https://deepwiki.com",
    privacyPolicyUrl: "https://deepwiki.com/privacy",
    termsOfServiceUrl: "https://deepwiki.com/terms",
    capabilities: ["Read"],
    examplePrompts: [
      "How does [owner/repo] handle authentication?",
      "Give me an overview of the architecture of [owner/repo]",
      "Where is [feature] implemented in [owner/repo]?",
    ],
  },
  {
    id: "gitmcp",
    displayName: "GitMCP",
    shortDescription: "Read docs and code from any GitHub project",
    longDescription:
      "Use GitMCP to fetch and search the documentation and code of a public GitHub project.",
    category: RESEARCH,
    auth: "none",
    url: "https://gitmcp.io/docs",
    websiteUrl: "https://gitmcp.io",
    capabilities: ["Read"],
    examplePrompts: [
      "Read the docs of [owner/repo] and show me how to get started",
      "Search [owner/repo] for how [function] is used",
      "What configuration options does [owner/repo] support?",
    ],
  },
  {
    id: "microsoft-learn",
    displayName: "Microsoft Learn",
    shortDescription: "Search Microsoft's official documentation",
    longDescription:
      "Use Microsoft Learn to search official Microsoft documentation and code samples for Azure, .NET, Microsoft 365 and more.",
    category: RESEARCH,
    auth: "none",
    url: "https://learn.microsoft.com/api/mcp",
    websiteUrl: "https://learn.microsoft.com",
    privacyPolicyUrl: "https://learn.microsoft.com/en-us/privacy/",
    capabilities: ["Read"],
    examplePrompts: [
      "How do I deploy a container app on Azure?",
      "Show a code sample for [task] in C#",
      "What are the limits of [Azure service]?",
    ],
  },
  {
    id: "cloudflare-docs",
    displayName: "Cloudflare Docs",
    shortDescription: "Search Cloudflare's documentation",
    longDescription: "Use Cloudflare Docs to search Cloudflare's developer documentation.",
    category: RESEARCH,
    auth: "none",
    url: "https://docs.mcp.cloudflare.com/mcp",
    websiteUrl: "https://developers.cloudflare.com",
    capabilities: ["Read"],
    examplePrompts: [
      "How do I bind a D1 database to a Worker?",
      "What are the limits of Workers KV?",
      "How do I move a Pages project to Workers?",
    ],
  },
  {
    id: "aws-knowledge",
    displayName: "AWS Knowledge",
    shortDescription: "Search AWS documentation and regional availability",
    longDescription:
      "Use AWS Knowledge to search and read official AWS documentation and check which services are available in each region.",
    category: RESEARCH,
    auth: "none",
    url: "https://knowledge-mcp.global.api.aws",
    websiteUrl: "https://aws.amazon.com",
    privacyPolicyUrl: "https://aws.amazon.com/privacy/",
    termsOfServiceUrl: "https://aws.amazon.com/terms/",
    capabilities: ["Read"],
    examplePrompts: [
      "Is [service] available in [region]?",
      "How do I set up [service] with least-privilege IAM?",
      "Find the documentation for [API]",
    ],
  },
  {
    id: "astro-docs",
    displayName: "Astro Docs",
    shortDescription: "Search Astro's documentation",
    longDescription: "Use Astro Docs to search the official Astro documentation.",
    category: RESEARCH,
    auth: "none",
    url: "https://mcp.docs.astro.build/mcp",
    websiteUrl: "https://astro.build",
    privacyPolicyUrl: "https://astro.build/privacy/",
    termsOfServiceUrl: "https://astro.build/terms/",
    capabilities: ["Read"],
    examplePrompts: [
      "How do content collections work in Astro?",
      "How do I add server-side rendering to this Astro site?",
      "What changed in the latest Astro release?",
    ],
  },
  {
    id: "instacart",
    displayName: "Instacart",
    shortDescription: "Turn recipes into shopping lists",
    longDescription:
      "Use Instacart to turn a recipe or a list of items into a shopping list link you can open on Instacart.",
    category: EVERYDAY,
    auth: "none",
    url: "https://mcp.instacart.com/mcp",
    websiteUrl: "https://www.instacart.com",
    capabilities: ["Read", "Write"],
    examplePrompts: [
      "Make a shopping list for [recipe] for four people",
      "Turn this meal plan into one shopping list",
      "Create a recipe page for [dish] with its ingredients",
    ],
  },
  {
    id: "kiwi",
    displayName: "Kiwi.com",
    shortDescription: "Search for flights",
    longDescription:
      "Use Kiwi.com to search for flights and compare prices and routes. Booking happens on Kiwi.com.",
    category: EVERYDAY,
    auth: "none",
    url: "https://mcp.kiwi.com",
    websiteUrl: "https://www.kiwi.com",
    privacyPolicyUrl: "https://www.kiwi.com/en/pages/content/privacy/",
    capabilities: ["Read"],
    examplePrompts: [
      "Find the cheapest flights from [city] to [city] in [month]",
      "Compare direct and one-stop flights to [city] on [date]",
      "What is the earliest flight to [city] tomorrow?",
    ],
  },
];
