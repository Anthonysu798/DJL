import { describe, expect, it } from "vitest";
import { validateImageModel } from "./configureImageModel.ts";
const endpoint = {
  id: "recraft/recraft-v4.1-flash",
  endpoints: [
    {
      supported_parameters: {
        n: { type: "range", min: 1, max: 6 },
        aspect_ratio: { type: "enum", values: ["1:1", "4:3", "3:4"] },
      },
      pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.007 }],
    },
  ],
};
describe("verified image catalog", () => {
  it("accepts only fixed per-image pricing and supported mobile ratios", () => {
    expect(validateImageModel(endpoint, endpoint.id)).toEqual({
      usdPerImage: 0.007,
      canEdit: false,
    });
  });
  it.each([
    {},
    { ...endpoint, id: "other" },
    { ...endpoint, endpoints: [] },
    {
      ...endpoint,
      endpoints: [
        {
          ...endpoint.endpoints[0],
          pricing: [{ billable: "output_image", unit: "token", cost_usd: 0.007 }],
        },
      ],
    },
  ])("fails closed for invalid catalog metadata", (metadata) => {
    expect(() => validateImageModel(metadata, endpoint.id)).toThrow();
  });
});
