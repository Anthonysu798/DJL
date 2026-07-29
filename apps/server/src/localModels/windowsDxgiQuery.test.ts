import { describe, expect, it, vi } from "vitest";

import { parseWindowsDxgiGpuInventory, queryWindowsDxgiGpuInventory } from "./windowsDxgiQuery";

describe("Windows DXGI GPU inventory", () => {
  it("keeps same-name physical adapters separate by stable LUID", () => {
    const inventory = parseWindowsDxgiGpuInventory(
      JSON.stringify([
        {
          Luid: "00000000:00000011",
          Name: "NVIDIA RTX 4090",
          VendorId: 0x10de,
          DeviceId: 0x2684,
          DedicatedMemoryBytes: String(24 * 1024 ** 3),
          SharedMemoryBytes: String(16 * 1024 ** 3),
          BudgetBytes: String(22 * 1024 ** 3),
          CurrentUsageBytes: String(20 * 1024 ** 3),
          MemorySegment: "local",
          Flags: 0,
        },
        {
          Luid: "00000000:00000022",
          Name: "NVIDIA RTX 4090",
          VendorId: 0x10de,
          DeviceId: 0x2684,
          DedicatedMemoryBytes: String(24 * 1024 ** 3),
          SharedMemoryBytes: String(16 * 1024 ** 3),
          BudgetBytes: String(22 * 1024 ** 3),
          CurrentUsageBytes: String(2 * 1024 ** 3),
          MemorySegment: "local",
          Flags: 0,
        },
      ]),
    );

    expect(inventory).toHaveLength(2);
    expect(inventory.map(({ luid }) => luid)).toEqual(["00000000:00000011", "00000000:00000022"]);
    expect(inventory.map(({ availableMemoryBytes }) => availableMemoryBytes)).toEqual([
      2 * 1024 ** 3,
      20 * 1024 ** 3,
    ]);
  });

  it("derives live availability from Budget minus CurrentUsage and clamps it at zero", () => {
    const inventory = parseWindowsDxgiGpuInventory(
      JSON.stringify([
        {
          Luid: "abcdef01:23456789",
          Name: "AMD Radeon Test",
          VendorId: 0x1002,
          DeviceId: 1,
          DedicatedMemoryBytes: "17179869184",
          SharedMemoryBytes: "8589934592",
          BudgetBytes: "1000",
          CurrentUsageBytes: "1200",
          MemorySegment: "local",
        },
        {
          Luid: "00000000:00000002",
          Name: "Intel Arc Test",
          VendorId: 0x8086,
          DeviceId: 2,
          DedicatedMemoryBytes: 0,
          SharedMemoryBytes: 1000,
          BudgetBytes: 900,
          CurrentUsageBytes: 200,
          MemorySegment: "non_local",
        },
      ]),
    );

    expect(inventory).toMatchObject([
      {
        luid: "ABCDEF01:23456789",
        availableMemoryBytes: 0,
        memorySegment: "local",
      },
      {
        luid: "00000000:00000002",
        dedicatedMemoryBytes: 0,
        availableMemoryBytes: 700,
        memorySegment: "non_local",
      },
    ]);
  });

  it("filters Microsoft software adapters without filtering physical vendors", () => {
    const inventory = parseWindowsDxgiGpuInventory(
      JSON.stringify([
        {
          Luid: "00000000:00000001",
          Name: "Microsoft Basic Render Driver",
          VendorId: 0x1414,
          DeviceId: 1,
          DedicatedMemoryBytes: "0",
          SharedMemoryBytes: "1000",
          BudgetBytes: "1000",
          CurrentUsageBytes: "0",
          Flags: 2,
        },
        {
          Luid: "00000000:00000002",
          Name: "Physical Test GPU",
          VendorId: 0x1234,
          DeviceId: 2,
          DedicatedMemoryBytes: "1000",
          SharedMemoryBytes: "1000",
          BudgetBytes: "1000",
          CurrentUsageBytes: "0",
          Flags: 0,
        },
      ]),
    );

    expect(inventory.map(({ name }) => name)).toEqual(["Physical Test GPU"]);
  });

  it("accepts one JSON object and ignores malformed, duplicate, or unsafe records", () => {
    expect(
      parseWindowsDxgiGpuInventory(
        `\uFEFF${JSON.stringify({
          luid: "00000000:00000001",
          name: "Single GPU",
          vendorId: 1,
          deviceId: 2,
          dedicatedMemoryBytes: "1024",
          sharedMemoryBytes: "2048",
          budgetBytes: "9007199254740992",
          currentUsageBytes: "1",
        })}`,
      ),
    ).toEqual([
      {
        luid: "00000000:00000001",
        name: "Single GPU",
        vendorId: 1,
        deviceId: 2,
        dedicatedMemoryBytes: 1024,
        sharedMemoryBytes: 2048,
        budgetBytes: null,
        currentUsageBytes: 1,
        availableMemoryBytes: null,
        memorySegment: null,
      },
    ]);
    expect(parseWindowsDxgiGpuInventory("not json")).toEqual([]);
    expect(
      parseWindowsDxgiGpuInventory(
        JSON.stringify([
          { Luid: "invalid", Name: "Missing stable ID", VendorId: 1, DeviceId: 1 },
          { Luid: "00000000:00000001", Name: "", VendorId: 1, DeviceId: 1 },
        ]),
      ),
    ).toEqual([]);
  });

  it("uses an injected query on Windows and skips execution elsewhere", async () => {
    const runQuery = vi.fn(async () =>
      JSON.stringify({
        Luid: "00000000:00000001",
        Name: "Injected GPU",
        VendorId: 1,
        DeviceId: 2,
        DedicatedMemoryBytes: "1000",
        SharedMemoryBytes: "2000",
        BudgetBytes: "900",
        CurrentUsageBytes: "100",
        MemorySegment: "local",
      }),
    );

    await expect(queryWindowsDxgiGpuInventory({ platform: "win32", runQuery })).resolves.toEqual([
      expect.objectContaining({ name: "Injected GPU", availableMemoryBytes: 800 }),
    ]);
    expect(runQuery).toHaveBeenCalledOnce();

    runQuery.mockClear();
    await expect(queryWindowsDxgiGpuInventory({ platform: "darwin", runQuery })).resolves.toEqual(
      [],
    );
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("fails closed when the native query is unavailable", async () => {
    await expect(
      queryWindowsDxgiGpuInventory({
        platform: "win32",
        runQuery: async () => {
          throw new Error("DXGI unavailable");
        },
      }),
    ).resolves.toEqual([]);
  });
});
