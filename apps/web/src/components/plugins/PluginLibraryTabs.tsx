// FILE: PluginLibraryTabs.tsx
// Purpose: The Plugins page title as two tabs, Plugins and Skills, so the Skills store sits
//          beside the plugin directory without another page.
// Layer: Plugins page presentation. Styles: index.css `.plugin-library-tab`.

import { useTranslation } from "react-i18next";

export type PluginLibraryView = "plugins" | "skills";

export function PluginLibraryTabs(props: {
  value: PluginLibraryView;
  onChange: (view: PluginLibraryView) => void;
}) {
  const { t } = useTranslation("shell");
  const tabs: ReadonlyArray<{ view: PluginLibraryView; label: string }> = [
    { view: "plugins", label: t("pluginLibrary.plugins") },
    { view: "skills", label: t("skillsStore.title") },
  ];
  return (
    <h1
      className="flex items-baseline gap-5"
      role="tablist"
      aria-label={t("pluginLibrary.plugins")}
    >
      {tabs.map((tab) => (
        <button
          key={tab.view}
          type="button"
          role="tab"
          aria-selected={props.value === tab.view}
          className="plugin-library-tab font-heading text-2xl font-semibold tracking-tight"
          onClick={() => props.onChange(tab.view)}
        >
          {tab.label}
        </button>
      ))}
    </h1>
  );
}
