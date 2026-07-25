import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "@fontsource-variable/jetbrains-mono";
import "./index.css";

import { appHistory } from "./appNavigation";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { isElectron } from "./env";
import { initializeRendererI18n } from "./i18n";

const router = getRouter(appHistory);

document.title = APP_DISPLAY_NAME;

if (isElectron) {
  document.documentElement.dataset.runtime = "electron";
}

async function renderApp(): Promise<void> {
  await initializeRendererI18n();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}

void renderApp();
