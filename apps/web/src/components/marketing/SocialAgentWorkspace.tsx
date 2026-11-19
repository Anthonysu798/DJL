import "@fontsource-variable/geist";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  IconArchive,
  IconArrowsUpDown,
  IconArrowLeft,
  IconArrowUpRight,
  IconShare3,
  IconChartBar,
  IconLink,
  IconPhoto,
  IconScissors,
  IconUser,
} from "@tabler/icons-react";
import type { Campaign, MediaAsset } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { Skeleton } from "~/components/ui/skeleton";
import { SOCIAL_ACCOUNT_CHANGED } from "./accountCache";
import type { Stored } from "./client";
import "./social-agent-workspace.css";

gsap.registerPlugin(useGSAP);

const Product = lazy(() =>
  import("./SocialKnowledgePanels").then((m) => ({ default: m.ProductSourcePanel })),
);
const Library = lazy(() =>
  import("./SocialKnowledgePanels").then((m) => ({ default: m.MediaLibraryPanel })),
);
const Brand = lazy(() =>
  import("./SocialKnowledgePanels").then((m) => ({ default: m.BrandMemoryPanel })),
);
const Video = lazy(() =>
  import("./SocialVideoPanel").then((m) => ({ default: m.SocialVideoPanel })),
);
const Workflows = lazy(() =>
  import("./SocialWorkflowPanels").then((m) => ({ default: m.WorkflowPanel })),
);
const Inbox = lazy(() =>
  import("./SocialWorkflowPanels").then((m) => ({ default: m.SocialInboxPanel })),
);
const Coach = lazy(() =>
  import("./SocialWorkflowPanels").then((m) => ({ default: m.PerformanceCoachPanel })),
);
const sections = [
  ["product", IconLink, "Product link"],
  ["workflows", IconArrowsUpDown, "Workflows"],
  ["video", IconScissors, "Video clips"],
  ["library", IconPhoto, "Media library"],
  ["brand", IconUser, "Brand memory"],
  ["results", IconChartBar, "Results coach"],
  ["inbox", IconArchive, "Review inbox"],
] as const;

export default function SocialAgentWorkspace({
  threadId,
  campaign,
  assets = [],
  onPrompt,
  onBack,
}: {
  threadId: string;
  campaign?: Stored<Campaign>;
  assets?: MediaAsset[];
  onPrompt?: (text: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const { t } = useTranslation("chat");
  const [tab, setTab] = useState("product");
  const [accountChanged, setAccountChanged] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const motion = gsap.matchMedia();
      motion.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".social-agent-intro, .social-agent-layout", {
          y: 10,
          opacity: 0,
          duration: 0.3,
          stagger: 0.06,
          clearProps: "all",
        });
        gsap.from(".social-agent-illustration", {
          scale: 0.92,
          opacity: 0,
          duration: 0.4,
          clearProps: "all",
        });
      });
      return () => motion.revert();
    },
    { scope: workspace },
  );
  useEffect(() => {
    const close = () => {
      setAccountChanged(true);
      setTab("product");
    };
    window.addEventListener(SOCIAL_ACCOUNT_CHANGED, close);
    return () => window.removeEventListener(SOCIAL_ACCOUNT_CHANGED, close);
  }, []);
  const prompt = onPrompt
    ? async (text: string) => {
        const started = await onPrompt(
          `Social media workspace request. Keep all preparation and review in this chat. Never authorize publication.\n\n${text}`,
        );
        if (started) onBack();
        return started;
      }
    : undefined;
  return (
    <main
      ref={workspace}
      className="social-agent-page overflow-x-hidden w-full max-w-full"
      aria-label={t("socialAgent.navigation", { defaultValue: "Social tools" })}
    >
      <nav
        className="social-agent-page-nav"
        aria-label={t("socialAgent.navigation", { defaultValue: "Social tools" })}
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          <IconArrowLeft size={16} aria-hidden="true" />
          {t("socialAgent.backToChat", { defaultValue: "Back to chat" })}
        </Button>
        <span className="social-agent-wordmark">
          <IconShare3 size={17} aria-hidden="true" />
          {t("socialAgent.navigation", { defaultValue: "Social tools" })}
        </span>
      </nav>
      {accountChanged ? (
        <p role="status" className="p-8">
          {t("socialAgent.accountChanged", {
            defaultValue: "Your account changed. Return to chat to reopen social tools.",
          })}
        </p>
      ) : (
        <>
          <header className="social-agent-header">
            <div className="social-agent-intro">
              <span className="social-agent-eyebrow">
                {t("socialAgent.eyebrow", { defaultValue: "Your social workspace" })}
              </span>
              <h1 className="max-w-5xl">
                {t("socialAgent.title", { defaultValue: "Make your next post happen." })}
              </h1>
              <p>
                {t("socialAgent.description", {
                  defaultValue:
                    "Start with a link, a video, or a workflow. Review every post here.",
                })}
              </p>
              <div className="social-agent-shortcuts">
                <Button variant="outline" size="sm" onClick={() => setTab("workflows")}>
                  <IconArrowsUpDown size={15} aria-hidden="true" />
                  {t("socialAgent.workflows", { defaultValue: "Workflows" })}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setTab("inbox")}>
                  {t("socialAgent.inbox", { defaultValue: "Review inbox" })}
                  <IconArrowUpRight size={15} aria-hidden="true" />
                </Button>
              </div>
            </div>
            <button
              type="button"
              className="social-agent-illustration"
              aria-label={t("socialAgent.exploreVideo", { defaultValue: "Explore video tools" })}
              onClick={() => setTab(tab === "video" ? "workflows" : "video")}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.style.setProperty(
                  "--art-x",
                  `${((event.clientX - rect.left) / rect.width - 0.5) * 7}deg`,
                );
                event.currentTarget.style.setProperty(
                  "--art-y",
                  `${-((event.clientY - rect.top) / rect.height - 0.5) * 7}deg`,
                );
              }}
              onPointerLeave={(event) => {
                event.currentTarget.style.setProperty("--art-x", "0deg");
                event.currentTarget.style.setProperty("--art-y", "0deg");
              }}
            >
              <img
                src={
                  tab === "workflows" || tab === "inbox"
                    ? "/illustrations/social-agent/workflow-loop-v1.png"
                    : "/illustrations/social-agent/media-orbit-v1.png"
                }
                alt=""
                draggable={false}
              />
              <span className="social-agent-art-caption">
                <IconScissors size={14} aria-hidden="true" />
                {t("socialAgent.video", { defaultValue: "Video clips" })}
                <IconArrowUpRight size={14} aria-hidden="true" />
              </span>
            </button>
          </header>
          <div className="social-agent-page-body">
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(String(value))}
              orientation="horizontal"
              className="social-agent-layout"
            >
              <TabsList
                className="social-agent-nav"
                aria-label={t("socialAgent.navigation", { defaultValue: "Social tools" })}
              >
                {sections.map(([id, Icon, label]) => (
                  <TabsTrigger value={id} key={id}>
                    <span className="social-agent-tool-icon">
                      <Icon size={19} aria-hidden="true" />
                    </span>
                    <span className="social-agent-tool-label">
                      {t(`socialAgent.${id}`, { defaultValue: label })}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="social-agent-content">
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-label={t("socialAgent.loading", {
                        defaultValue: "Loading social tools…",
                      })}
                      className="flex flex-col gap-4"
                    >
                      <Skeleton className="h-8 w-1/2" />
                      <Skeleton className="h-36 w-full" />
                    </div>
                  }
                >
                  <TabsContent value="product">
                    <Product threadId={threadId} {...(prompt ? { onPrompt: prompt } : {})} />
                  </TabsContent>
                  <TabsContent value="workflows">
                    <Workflows threadId={threadId} {...(prompt ? { onPrompt: prompt } : {})} />
                  </TabsContent>
                  <TabsContent value="video">
                    <Video
                      threadId={threadId}
                      assets={assets}
                      {...(campaign ? { campaign } : {})}
                    />
                  </TabsContent>
                  <TabsContent value="library">
                    <Library
                      threadId={threadId}
                      assets={assets}
                      {...(campaign ? { campaign } : {})}
                    />
                  </TabsContent>
                  <TabsContent value="brand">
                    <Brand threadId={threadId} />
                  </TabsContent>
                  <TabsContent value="results">
                    <Coach threadId={threadId} {...(prompt ? { onPrompt: prompt } : {})} />
                  </TabsContent>
                  <TabsContent value="inbox">
                    <Inbox threadId={threadId} />
                  </TabsContent>
                </Suspense>
              </div>
            </Tabs>
          </div>
        </>
      )}
    </main>
  );
}
