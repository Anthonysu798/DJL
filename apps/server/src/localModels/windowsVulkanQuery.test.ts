import { describe, expect, it, vi } from "vitest";

import {
  parseWindowsVulkanDeviceInventory,
  queryWindowsVulkanDeviceInventory,
  sanitizedWindowsVulkanEnvironment,
} from "./windowsVulkanQuery";

const supportedDevice = {
  Luid: "abcdef01:23456789",
  DeviceUuid: "00112233445566778899aabbccddeeff",
  LuidValid: true,
  NodeMask: 1,
  DeviceType: 2,
  StorageBuffer16BitAccess: true,
  HasComputeQueue: true,
};

describe("Windows Vulkan device inventory", () => {
  it("accepts only devices that satisfy every managed Vulkan backend gate", () => {
    expect(parseWindowsVulkanDeviceInventory(JSON.stringify(supportedDevice))).toEqual([
      {
        luid: "ABCDEF01:23456789",
        deviceUuid: "00112233445566778899AABBCCDDEEFF",
        deviceType: "discrete",
      },
    ]);

    for (const override of [
      { LuidValid: false },
      { NodeMask: 2 },
      { DeviceType: 4 },
      { StorageBuffer16BitAccess: false },
      { HasComputeQueue: false },
      { Luid: "not-a-luid" },
      { DeviceUuid: "not-a-uuid" },
    ]) {
      expect(
        parseWindowsVulkanDeviceInventory(JSON.stringify({ ...supportedDevice, ...override })),
      ).toEqual([]);
    }
  });

  it("normalizes integrated GPUs and rejects virtual devices", () => {
    expect(
      parseWindowsVulkanDeviceInventory(
        JSON.stringify([
          { ...supportedDevice, DeviceType: "integrated" },
          {
            ...supportedDevice,
            Luid: "00000000:00000002",
            DeviceUuid: "10112233445566778899aabbccddeeff",
            DeviceType: 3,
          },
        ]),
      ).map(({ deviceType }) => deviceType),
    ).toEqual(["integrated"]);
  });

  it("deduplicates one LUID but fails closed when one UUID maps to multiple LUIDs", () => {
    expect(
      parseWindowsVulkanDeviceInventory(
        JSON.stringify([
          supportedDevice,
          { ...supportedDevice, DeviceUuid: "10112233445566778899aabbccddeeff" },
        ]),
      ),
    ).toHaveLength(1);

    expect(
      parseWindowsVulkanDeviceInventory(
        JSON.stringify([
          supportedDevice,
          { ...supportedDevice, DeviceUuid: "10112233445566778899aabbccddeeff" },
          {
            ...supportedDevice,
            Luid: "00000000:00000002",
            DeviceUuid: supportedDevice.DeviceUuid,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("ignores malformed output and caps oversized inventories", () => {
    expect(parseWindowsVulkanDeviceInventory("not json")).toEqual([]);
    const devices = Array.from({ length: 80 }, (_, index) => ({
      ...supportedDevice,
      Luid: `00000000:${index.toString(16).padStart(8, "0")}`,
      DeviceUuid: index.toString(16).padStart(32, "0"),
    }));
    expect(parseWindowsVulkanDeviceInventory(JSON.stringify(devices))).toHaveLength(32);
  });

  it("uses an injected query only on Windows and fails closed on errors", async () => {
    const runQuery = vi.fn(async () => JSON.stringify(supportedDevice));
    await expect(
      queryWindowsVulkanDeviceInventory({ platform: "win32", runQuery }),
    ).resolves.toHaveLength(1);
    expect(runQuery).toHaveBeenCalledOnce();

    runQuery.mockClear();
    await expect(
      queryWindowsVulkanDeviceInventory({ platform: "darwin", runQuery }),
    ).resolves.toEqual([]);
    expect(runQuery).not.toHaveBeenCalled();

    await expect(
      queryWindowsVulkanDeviceInventory({
        platform: "win32",
        runQuery: async () => {
          throw new Error("Vulkan unavailable");
        },
      }),
    ).resolves.toEqual([]);
  });

  it("removes Vulkan driver and layer overrides case-insensitively", () => {
    expect(
      sanitizedWindowsVulkanEnvironment({
        PATH: "safe",
        Vk_Driver_Files: "C:\\custom-icd.json",
        VK_ICD_FILENAMES: "C:\\legacy-icd.json",
        VK_LOADER_DRIVERS_SELECT: "swiftshader*",
        VK_LAYER_PATH: "C:\\custom-layers",
        VK_LOADER_LAYERS_ENABLE: "custom-layer",
        OLLAMA_VULKAN: "0",
      }),
    ).toEqual({ PATH: "safe", VK_LOADER_LAYERS_DISABLE: "~implicit~" });
  });
});
