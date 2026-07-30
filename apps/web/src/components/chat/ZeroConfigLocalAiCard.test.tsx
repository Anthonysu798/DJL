// FILE: ZeroConfigLocalAiCard.test.tsx
// Purpose: Guards the zero-config local AI use-case chooser semantics and busy-state lock.
// Layer: Chat composer component tests

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ZeroConfigLocalAiCard, type ZeroConfigLocalAiStatus } from "./ZeroConfigLocalAiCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderCard = (status: ZeroConfigLocalAiStatus) =>
  renderToStaticMarkup(
    <ZeroConfigLocalAiCard
      status={status}
      selectedUseCase="reasoning"
      onUseCaseChange={vi.fn()}
      onPrepare={vi.fn()}
      onRetry={vi.fn()}
    />,
  );

const radioInputs = (markup: string) => markup.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];

describe("ZeroConfigLocalAiCard", () => {
  it("renders one accessible radio choice for every curated use case", () => {
    const markup = renderCard("idle");
    const radios = radioInputs(markup);

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('data-onboarding-target="local-ai-card"');
    expect(markup).toContain('data-onboarding-target="local-ai-purpose"');
    expect(markup).toContain('data-onboarding-target="local-ai-prepare"');
    expect(markup).toContain("composer.zeroConfig.useCaseLabel");
    expect(radios).toHaveLength(4);
    expect(radios.filter((radio) => radio.includes(" checked"))).toHaveLength(1);
    expect(markup).toContain("composer.zeroConfig.useCases.general.label");
    expect(markup).toContain("composer.zeroConfig.useCases.document.label");
    expect(markup).toContain("composer.zeroConfig.useCases.reasoning.label");
    expect(markup).toContain("composer.zeroConfig.useCases.coding.label");
  });

  it("anchors the hardware recommendation when device details are available", () => {
    const markup = renderToStaticMarkup(
      <ZeroConfigLocalAiCard
        status="idle"
        selectedUseCase="general"
        recommendedModelName="Granite 4.1 3B"
        deviceSummary="32 GB RAM and 12 GB VRAM"
        onUseCaseChange={vi.fn()}
        onPrepare={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain('data-onboarding-target="local-ai-device"');
  });

  it("locks every use-case choice while local AI is being prepared", () => {
    const radios = radioInputs(renderCard("preparing"));

    expect(radios).toHaveLength(4);
    expect(radios.every((radio) => radio.includes(" disabled"))).toBe(true);
  });

  it("allows the user to change use case after a failed setup", () => {
    const radios = radioInputs(renderCard("failed"));

    expect(radios).toHaveLength(4);
    expect(radios.every((radio) => !radio.includes(" disabled"))).toBe(true);
  });
});
