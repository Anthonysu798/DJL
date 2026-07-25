import { describe, expect, it } from "vitest";

import { isLoopbackAddress, isLoopbackUrl } from "./loopback";

describe("loopback network checks", () => {
  it("accepts only local HTTP endpoint URLs", () => {
    expect(isLoopbackUrl("http://localhost:3773/api/ai-detector/analyze")).toBe(true);
    expect(isLoopbackUrl("https://127.0.0.1:3773/api/ai-detector/analyze")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:3773/api/ai-detector/analyze")).toBe(true);
    expect(isLoopbackUrl("https://djl.example.com/api/ai-detector/analyze")).toBe(false);
    expect(isLoopbackUrl("http://192.168.1.50:3773/api/ai-detector/analyze")).toBe(false);
    expect(isLoopbackUrl("not a URL")).toBe(false);
  });

  it("accepts IPv4, IPv6, and mapped loopback peer addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.50")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
