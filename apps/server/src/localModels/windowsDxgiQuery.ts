import { execFile } from "node:child_process";

const DXGI_QUERY_TIMEOUT_MS = 20_000;
const MAX_DXGI_ADAPTERS = 32;
const MAX_QUERY_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface WindowsDxgiAdapter {
  readonly luid: string;
  readonly name: string;
  readonly vendorId: number;
  readonly deviceId: number;
  readonly dedicatedMemoryBytes: number | null;
  readonly sharedMemoryBytes: number | null;
  readonly budgetBytes: number | null;
  readonly currentUsageBytes: number | null;
  readonly availableMemoryBytes: number | null;
  readonly memorySegment: "local" | "non_local" | null;
}

export interface WindowsDxgiQueryOptions {
  readonly platform?: NodeJS.Platform;
  readonly runQuery?: () => Promise<string>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function property(item: Record<string, unknown>, ...names: ReadonlyArray<string>): unknown {
  for (const name of names) {
    if (Object.hasOwn(item, name)) return item[name];
  }
  return undefined;
}

function optionalSafeBytes(value: unknown): number | null {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalUint32(value: unknown): number | null {
  const parsed = optionalSafeBytes(value);
  return parsed !== null && parsed <= 0xffff_ffff ? parsed : null;
}

function normalizedLuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([0-9a-f]{8}):([0-9a-f]{8})$/i.exec(value.trim());
  return match ? `${match[1]!.toUpperCase()}:${match[2]!.toUpperCase()}` : null;
}

function isMicrosoftSoftwareAdapter(
  item: Record<string, unknown>,
  name: string,
  vendorId: number,
): boolean {
  const flags = optionalUint32(property(item, "Flags", "flags")) ?? 0;
  if ((flags & 0x2) !== 0 || property(item, "IsSoftware", "isSoftware") === true) return true;
  if (vendorId !== 0x1414) return false;
  return /microsoft\s+(?:basic\s+render|remote\s+display|hyper-v\s+video)/i.test(name);
}

export function parseWindowsDxgiGpuInventory(output: string): WindowsDxgiAdapter[] {
  try {
    const parsed = JSON.parse(output.replace(/^\uFEFF/, "").trim()) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const seenLuids = new Set<string>();
    const adapters: WindowsDxgiAdapter[] = [];

    for (const value of values) {
      if (adapters.length >= MAX_DXGI_ADAPTERS) break;
      const item = record(value);
      if (!item) continue;
      const luid = normalizedLuid(property(item, "Luid", "luid"));
      const rawName = property(item, "Name", "name");
      const name = typeof rawName === "string" ? rawName.trim().slice(0, 256) : "";
      const vendorId = optionalUint32(property(item, "VendorId", "vendorId"));
      const deviceId = optionalUint32(property(item, "DeviceId", "deviceId"));
      if (!luid || !name || vendorId === null || deviceId === null || seenLuids.has(luid)) continue;
      if (isMicrosoftSoftwareAdapter(item, name, vendorId)) continue;

      const dedicatedMemoryBytes = optionalSafeBytes(
        property(item, "DedicatedMemoryBytes", "dedicatedMemoryBytes"),
      );
      const sharedMemoryBytes = optionalSafeBytes(
        property(item, "SharedMemoryBytes", "sharedMemoryBytes"),
      );
      const budgetBytes = optionalSafeBytes(property(item, "BudgetBytes", "budgetBytes"));
      const currentUsageBytes = optionalSafeBytes(
        property(item, "CurrentUsageBytes", "currentUsageBytes"),
      );
      const rawSegment = property(item, "MemorySegment", "memorySegment");
      const memorySegment =
        rawSegment === "local" || rawSegment === "non_local" ? rawSegment : null;
      const availableMemoryBytes =
        budgetBytes === null || currentUsageBytes === null
          ? null
          : Math.max(0, budgetBytes - currentUsageBytes);

      seenLuids.add(luid);
      adapters.push({
        luid,
        name,
        vendorId,
        deviceId,
        dedicatedMemoryBytes,
        sharedMemoryBytes,
        budgetBytes,
        currentUsageBytes,
        availableMemoryBytes,
        memorySegment,
      });
    }
    return adapters;
  } catch {
    return [];
  }
}

const WINDOWS_DXGI_QUERY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$source = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;

namespace Djl.LocalModels
{
    public static class WindowsDxgiQuery
    {
        private const int DXGI_ERROR_NOT_FOUND = unchecked((int)0x887A0002);
        private const uint DXGI_ADAPTER_FLAG_SOFTWARE = 0x2;
        private const int DXGI_MEMORY_SEGMENT_GROUP_LOCAL = 0;
        private const int DXGI_MEMORY_SEGMENT_GROUP_NON_LOCAL = 1;

        private static readonly Guid IID_IDXGIFactory1 =
            new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        private static readonly Guid IID_IDXGIAdapter3 =
            new Guid("645967A4-1392-4310-A798-8053CE3E93FD");

        [StructLayout(LayoutKind.Sequential)]
        private struct Luid
        {
            public uint LowPart;
            public int HighPart;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DxgiAdapterDesc1
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string Description;
            public uint VendorId;
            public uint DeviceId;
            public uint SubSysId;
            public uint Revision;
            public UIntPtr DedicatedVideoMemory;
            public UIntPtr DedicatedSystemMemory;
            public UIntPtr SharedSystemMemory;
            public Luid AdapterLuid;
            public uint Flags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DxgiQueryVideoMemoryInfo
        {
            public ulong Budget;
            public ulong CurrentUsage;
            public ulong AvailableForReservation;
            public ulong CurrentReservation;
        }

        public sealed class AdapterRecord
        {
            public string Luid { get; set; }
            public string Name { get; set; }
            public uint VendorId { get; set; }
            public uint DeviceId { get; set; }
            public string DedicatedMemoryBytes { get; set; }
            public string SharedMemoryBytes { get; set; }
            public string BudgetBytes { get; set; }
            public string CurrentUsageBytes { get; set; }
            public string MemorySegment { get; set; }
            public uint Flags { get; set; }
            public bool IsSoftware { get; set; }
        }

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int EnumAdapters1Delegate(IntPtr factory, uint adapterIndex, out IntPtr adapter);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetDesc1Delegate(IntPtr adapter, out DxgiAdapterDesc1 description);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int QueryInterfaceDelegate(IntPtr instance, ref Guid interfaceId, out IntPtr result);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int QueryVideoMemoryInfoDelegate(
            IntPtr adapter,
            uint nodeIndex,
            int memorySegmentGroup,
            out DxgiQueryVideoMemoryInfo memoryInfo);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate uint ReleaseDelegate(IntPtr instance);

        [DllImport("dxgi.dll", CallingConvention = CallingConvention.StdCall)]
        private static extern int CreateDXGIFactory1(ref Guid interfaceId, out IntPtr factory);

        private static T GetMethod<T>(IntPtr instance, int slot) where T : class
        {
            IntPtr virtualTable = Marshal.ReadIntPtr(instance);
            IntPtr method = Marshal.ReadIntPtr(virtualTable, slot * IntPtr.Size);
            return (T)(object)Marshal.GetDelegateForFunctionPointer(method, typeof(T));
        }

        private static void Release(IntPtr instance)
        {
            if (instance == IntPtr.Zero) return;
            GetMethod<ReleaseDelegate>(instance, 2)(instance);
        }

        private static string Bytes(ulong value)
        {
            return value.ToString(CultureInfo.InvariantCulture);
        }

        private static string PointerBytes(UIntPtr value)
        {
            return Bytes(value.ToUInt64());
        }

        private static string FormatLuid(Luid luid)
        {
            return unchecked((uint)luid.HighPart).ToString("X8", CultureInfo.InvariantCulture) +
                ":" + luid.LowPart.ToString("X8", CultureInfo.InvariantCulture);
        }

        private static bool IsMicrosoftSoftwareAdapter(DxgiAdapterDesc1 description)
        {
            if ((description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) return true;
            if (description.VendorId != 0x1414) return false;
            string name = description.Description ?? String.Empty;
            return name.IndexOf("Microsoft Basic Render", StringComparison.OrdinalIgnoreCase) >= 0 ||
                name.IndexOf("Microsoft Remote Display", StringComparison.OrdinalIgnoreCase) >= 0 ||
                name.IndexOf("Microsoft Hyper-V Video", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static bool TryQueryMemory(
            IntPtr adapter3,
            int segment,
            out DxgiQueryVideoMemoryInfo memoryInfo)
        {
            QueryVideoMemoryInfoDelegate query = GetMethod<QueryVideoMemoryInfoDelegate>(adapter3, 14);
            return query(adapter3, 0, segment, out memoryInfo) >= 0;
        }

        public static AdapterRecord[] Query()
        {
            IntPtr factory = IntPtr.Zero;
            Guid factoryId = IID_IDXGIFactory1;
            int result = CreateDXGIFactory1(ref factoryId, out factory);
            if (result < 0) Marshal.ThrowExceptionForHR(result);
            try
            {
                EnumAdapters1Delegate enumerate = GetMethod<EnumAdapters1Delegate>(factory, 12);
                List<AdapterRecord> records = new List<AdapterRecord>();
                for (uint adapterIndex = 0; adapterIndex < 32; adapterIndex++)
                {
                    IntPtr adapter1 = IntPtr.Zero;
                    result = enumerate(factory, adapterIndex, out adapter1);
                    if (result == DXGI_ERROR_NOT_FOUND) break;
                    if (result < 0) Marshal.ThrowExceptionForHR(result);
                    try
                    {
                        DxgiAdapterDesc1 description;
                        result = GetMethod<GetDesc1Delegate>(adapter1, 10)(adapter1, out description);
                        if (result < 0) Marshal.ThrowExceptionForHR(result);
                        if (IsMicrosoftSoftwareAdapter(description)) continue;

                        string budget = null;
                        string currentUsage = null;
                        string memorySegment = null;
                        IntPtr adapter3 = IntPtr.Zero;
                        Guid adapter3Id = IID_IDXGIAdapter3;
                        result = GetMethod<QueryInterfaceDelegate>(adapter1, 0)(
                            adapter1,
                            ref adapter3Id,
                            out adapter3);
                        if (result >= 0 && adapter3 != IntPtr.Zero)
                        {
                            try
                            {
                                DxgiQueryVideoMemoryInfo localInfo;
                                DxgiQueryVideoMemoryInfo nonLocalInfo;
                                bool hasLocal = TryQueryMemory(
                                    adapter3,
                                    DXGI_MEMORY_SEGMENT_GROUP_LOCAL,
                                    out localInfo);
                                bool hasNonLocal = TryQueryMemory(
                                    adapter3,
                                    DXGI_MEMORY_SEGMENT_GROUP_NON_LOCAL,
                                    out nonLocalInfo);
                                if (hasLocal && (localInfo.Budget > 0 || !hasNonLocal))
                                {
                                    budget = Bytes(localInfo.Budget);
                                    currentUsage = Bytes(localInfo.CurrentUsage);
                                    memorySegment = "local";
                                }
                                else if (hasNonLocal)
                                {
                                    budget = Bytes(nonLocalInfo.Budget);
                                    currentUsage = Bytes(nonLocalInfo.CurrentUsage);
                                    memorySegment = "non_local";
                                }
                            }
                            finally
                            {
                                Release(adapter3);
                            }
                        }

                        records.Add(new AdapterRecord
                        {
                            Luid = FormatLuid(description.AdapterLuid),
                            Name = (description.Description ?? String.Empty).Trim(),
                            VendorId = description.VendorId,
                            DeviceId = description.DeviceId,
                            DedicatedMemoryBytes = PointerBytes(description.DedicatedVideoMemory),
                            SharedMemoryBytes = PointerBytes(description.SharedSystemMemory),
                            BudgetBytes = budget,
                            CurrentUsageBytes = currentUsage,
                            MemorySegment = memorySegment,
                            Flags = description.Flags,
                            IsSoftware = (description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0
                        });
                    }
                    finally
                    {
                        Release(adapter1);
                    }
                }
                return records.ToArray();
            }
            finally
            {
                Release(factory);
            }
        }
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'Djl.LocalModels.WindowsDxgiQuery').Type) {
  Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
}

ConvertTo-Json -InputObject @([Djl.LocalModels.WindowsDxgiQuery]::Query()) -Compress -Depth 4
`;

export async function runWindowsDxgiQuery(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_DXGI_QUERY_SCRIPT],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: DXGI_QUERY_TIMEOUT_MS,
        maxBuffer: MAX_QUERY_OUTPUT_BYTES,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export async function queryWindowsDxgiGpuInventory(
  options: WindowsDxgiQueryOptions = {},
): Promise<WindowsDxgiAdapter[]> {
  if ((options.platform ?? process.platform) !== "win32") return [];
  try {
    return parseWindowsDxgiGpuInventory(await (options.runQuery ?? runWindowsDxgiQuery)());
  } catch {
    return [];
  }
}
