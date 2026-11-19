import { expect, it } from "vitest";
import { buildCampaignTrackingLink } from "./campaignLinks";

it("preserves product query values and anchors while setting one value per campaign field", () => {
  const link = new URL(
    buildCampaignTrackingLink({
      url: "https://shop.example/product?size=m&utm_source=old&utm_source=duplicate#details",
      source: "instagram",
      campaign: "Spring launch",
    }),
  );
  expect(link.searchParams.get("size")).toBe("m");
  expect(link.hash).toBe("#details");
  expect(link.searchParams.getAll("utm_source")).toEqual(["instagram"]);
  expect(link.searchParams.get("utm_campaign")).toBe("Spring launch");
  expect(link.searchParams.get("utm_medium")).toBe("social");
});
it("refuses unsafe schemes, credentials and literal private destinations", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://shop.example",
    "https://name:password@shop.example",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://192.168.1.3/",
    "https://shop.example/?access_token=private",
    "https://shop.example/\nproduct",
    `https://shop.example/${"x".repeat(4096)}`,
  ]) {
    expect(() =>
      buildCampaignTrackingLink({ url, source: "instagram", campaign: "launch" }),
    ).toThrow();
  }
});
it("rejects missing tracking values instead of making up an attribution", () => {
  expect(() =>
    buildCampaignTrackingLink({ url: "https://shop.example", source: "", campaign: "launch" }),
  ).toThrow();
});
