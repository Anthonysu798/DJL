import { execFile } from "node:child_process";

const VULKAN_QUERY_TIMEOUT_MS = 20_000;
const MAX_VULKAN_DEVICES = 32;
const MAX_QUERY_OUTPUT_BYTES = 512 * 1024;
const VULKAN_DEVICE_OVERRIDE_KEYS = new Set([
  "GGML_VK_VISIBLE_DEVICES",
  "OLLAMA_VULKAN",
  "VK_ADD_DRIVER_FILES",
  "VK_ADD_IMPLICIT_LAYER_PATH",
  "VK_ADD_LAYER_PATH",
  "VK_DRIVER_FILES",
  "VK_ICD_FILENAMES",
  "VK_IMPLICIT_LAYER_PATH",
  "VK_INSTANCE_LAYERS",
  "VK_LAYER_PATH",
  "VK_LOADER_DRIVERS_DISABLE",
  "VK_LOADER_DRIVERS_SELECT",
  "VK_LOADER_LAYERS_ALLOW",
  "VK_LOADER_LAYERS_DISABLE",
  "VK_LOADER_LAYERS_ENABLE",
]);

export interface WindowsVulkanDevice {
  readonly luid: string;
  readonly deviceUuid: string;
  readonly deviceType: "integrated" | "discrete";
}

export interface WindowsVulkanQueryOptions {
  readonly platform?: NodeJS.Platform;
  readonly runQuery?: () => Promise<string>;
}

export function sanitizedWindowsVulkanEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = Object.fromEntries(
    Object.entries(source).filter(([key]) => !VULKAN_DEVICE_OVERRIDE_KEYS.has(key.toUpperCase())),
  );
  return { ...sanitized, VK_LOADER_LAYERS_DISABLE: "~implicit~" };
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

function normalizedLuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([0-9a-f]{8}):([0-9a-f]{8})$/i.exec(value.trim());
  return match ? `${match[1]!.toUpperCase()}:${match[2]!.toUpperCase()}` : null;
}

function normalizedUuid(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{32}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : null;
}

function normalizedDeviceType(value: unknown): WindowsVulkanDevice["deviceType"] | null {
  if (value === 1 || value === "integrated") return "integrated";
  if (value === 2 || value === "discrete") return "discrete";
  return null;
}

export function parseWindowsVulkanDeviceInventory(output: string): WindowsVulkanDevice[] {
  try {
    const parsed = JSON.parse(output.replace(/^\uFEFF/, "").trim()) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const candidates = values.slice(0, MAX_VULKAN_DEVICES * 2).flatMap((value) => {
      const item = record(value);
      if (!item) return [];
      const luid = normalizedLuid(property(item, "Luid", "luid"));
      const deviceUuid = normalizedUuid(property(item, "DeviceUuid", "deviceUuid"));
      const deviceType = normalizedDeviceType(property(item, "DeviceType", "deviceType"));
      const luidValid = property(item, "LuidValid", "luidValid") === true;
      const nodeMask = property(item, "NodeMask", "nodeMask");
      const storageBuffer16BitAccess =
        property(item, "StorageBuffer16BitAccess", "storageBuffer16BitAccess") === true;
      const hasComputeQueue = property(item, "HasComputeQueue", "hasComputeQueue") === true;
      if (
        !luid ||
        !deviceUuid ||
        !deviceType ||
        !luidValid ||
        nodeMask !== 1 ||
        !storageBuffer16BitAccess ||
        !hasComputeQueue
      ) {
        return [];
      }
      return [{ luid, deviceUuid, deviceType } satisfies WindowsVulkanDevice];
    });

    const uuidLuids = new Map<string, Set<string>>();
    for (const device of candidates) {
      const luids = uuidLuids.get(device.deviceUuid) ?? new Set<string>();
      luids.add(device.luid);
      uuidLuids.set(device.deviceUuid, luids);
    }

    const uniqueByLuid = new Map<string, WindowsVulkanDevice>();
    for (const device of candidates) {
      if (!uniqueByLuid.has(device.luid)) uniqueByLuid.set(device.luid, device);
    }

    // Multiple ICDs may expose one DXGI LUID, which still represents one physical GPU. A UUID
    // mapped to different LUIDs is ambiguous, so reject that UUID group instead of double-counting.
    return [...uniqueByLuid.values()]
      .filter((device) => uuidLuids.get(device.deviceUuid)?.size === 1)
      .slice(0, MAX_VULKAN_DEVICES);
  } catch {
    return [];
  }
}

const WINDOWS_VULKAN_QUERY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$source = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;

namespace Djl.LocalModels
{
    public static class WindowsVulkanQuery
    {
        private const int VK_SUCCESS = 0;
        private const int VK_INCOMPLETE = 5;
        private const uint VK_API_VERSION_1_2 = (1u << 22) | (2u << 12);
        private const uint VK_STRUCTURE_TYPE_APPLICATION_INFO = 0;
        private const uint VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO = 1;
        private const uint VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2 = 1000059000;
        private const uint VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2 = 1000059001;
        private const uint VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES = 1000071004;
        private const uint VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_16BIT_STORAGE_FEATURES = 1000083000;
        private const uint VK_QUEUE_COMPUTE_BIT = 0x00000002;
        private const int MAX_PHYSICAL_DEVICES = 64;
        private const int PROPERTIES_2_BUFFER_BYTES = 4096;
        private const int FEATURES_2_BUFFER_BYTES = 1024;
        private const int QUEUE_FAMILY_PROPERTIES_BYTES = 24;

        [StructLayout(LayoutKind.Sequential)]
        private struct VkApplicationInfo
        {
            public uint sType;
            public IntPtr pNext;
            public IntPtr pApplicationName;
            public uint applicationVersion;
            public IntPtr pEngineName;
            public uint engineVersion;
            public uint apiVersion;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct VkInstanceCreateInfo
        {
            public uint sType;
            public IntPtr pNext;
            public uint flags;
            public IntPtr pApplicationInfo;
            public uint enabledLayerCount;
            public IntPtr ppEnabledLayerNames;
            public uint enabledExtensionCount;
            public IntPtr ppEnabledExtensionNames;
        }

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int EnumerateInstanceVersionDelegate(ref uint apiVersion);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate void GetPhysicalDeviceProperties2Delegate(
            IntPtr physicalDevice,
            IntPtr properties);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate void GetPhysicalDeviceFeatures2Delegate(
            IntPtr physicalDevice,
            IntPtr features);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate void GetPhysicalDeviceQueueFamilyPropertiesDelegate(
            IntPtr physicalDevice,
            ref uint propertyCount,
            IntPtr properties);

        [DllImport("vulkan-1.dll", CallingConvention = CallingConvention.Winapi)]
        private static extern IntPtr vkGetInstanceProcAddr(
            IntPtr instance,
            [MarshalAs(UnmanagedType.LPStr)] string name);

        [DllImport("vulkan-1.dll", CallingConvention = CallingConvention.Winapi)]
        private static extern int vkCreateInstance(
            ref VkInstanceCreateInfo createInfo,
            IntPtr allocator,
            out IntPtr instance);

        [DllImport("vulkan-1.dll", CallingConvention = CallingConvention.Winapi)]
        private static extern int vkEnumeratePhysicalDevices(
            IntPtr instance,
            ref uint physicalDeviceCount,
            [Out] IntPtr[] physicalDevices);

        [DllImport("vulkan-1.dll", CallingConvention = CallingConvention.Winapi)]
        private static extern void vkDestroyInstance(IntPtr instance, IntPtr allocator);

        public sealed class VulkanDeviceRecord
        {
            public string Luid { get; set; }
            public string DeviceUuid { get; set; }
            public bool LuidValid { get; set; }
            public uint NodeMask { get; set; }
            public uint DeviceType { get; set; }
            public bool StorageBuffer16BitAccess { get; set; }
            public bool HasComputeQueue { get; set; }
        }

        private static IntPtr AllocateZeroed(int byteCount)
        {
            IntPtr pointer = Marshal.AllocHGlobal(byteCount);
            Marshal.Copy(new byte[byteCount], 0, pointer, byteCount);
            return pointer;
        }

        private static Delegate Resolve(IntPtr instance, string name, Type delegateType)
        {
            IntPtr address = vkGetInstanceProcAddr(instance, name);
            if (address == IntPtr.Zero)
                throw new InvalidOperationException("Vulkan function is unavailable: " + name);
            return Marshal.GetDelegateForFunctionPointer(address, delegateType);
        }

        private static bool LoaderSupportsVulkan12()
        {
            IntPtr address = vkGetInstanceProcAddr(IntPtr.Zero, "vkEnumerateInstanceVersion");
            if (address == IntPtr.Zero) return false;
            EnumerateInstanceVersionDelegate enumerate =
                (EnumerateInstanceVersionDelegate)Marshal.GetDelegateForFunctionPointer(
                    address,
                    typeof(EnumerateInstanceVersionDelegate));
            uint apiVersion = 0;
            return enumerate(ref apiVersion) == VK_SUCCESS && apiVersion >= VK_API_VERSION_1_2;
        }

        private static bool HasComputeQueue(
            IntPtr physicalDevice,
            GetPhysicalDeviceQueueFamilyPropertiesDelegate query)
        {
            uint count = 0;
            query(physicalDevice, ref count, IntPtr.Zero);
            if (count == 0 || count > 256) return false;
            IntPtr properties = Marshal.AllocHGlobal(checked((int)count * QUEUE_FAMILY_PROPERTIES_BYTES));
            try
            {
                query(physicalDevice, ref count, properties);
                for (uint index = 0; index < count; index++)
                {
                    int offset = checked((int)index * QUEUE_FAMILY_PROPERTIES_BYTES);
                    uint flags = unchecked((uint)Marshal.ReadInt32(properties, offset));
                    uint queueCount = unchecked((uint)Marshal.ReadInt32(properties, offset + 4));
                    if (queueCount > 0 && (flags & VK_QUEUE_COMPUTE_BIT) != 0) return true;
                }
                return false;
            }
            finally
            {
                Marshal.FreeHGlobal(properties);
            }
        }

        private static VulkanDeviceRecord QueryDevice(
            IntPtr physicalDevice,
            GetPhysicalDeviceProperties2Delegate getProperties,
            GetPhysicalDeviceFeatures2Delegate getFeatures,
            GetPhysicalDeviceQueueFamilyPropertiesDelegate getQueueFamilies)
        {
            int pointerOffset = IntPtr.Size == 8 ? 8 : 4;
            int wrapperHeaderBytes = pointerOffset + IntPtr.Size;
            int idPropertiesBytes = wrapperHeaderBytes + 16 + 16 + 8 + 4 + 4;
            int luidOffset = wrapperHeaderBytes + 16 + 16;
            int nodeMaskOffset = luidOffset + 8;
            int luidValidOffset = nodeMaskOffset + 4;
            int storageFeatureOffset = wrapperHeaderBytes;

            IntPtr idProperties = AllocateZeroed(idPropertiesBytes);
            IntPtr properties2 = AllocateZeroed(PROPERTIES_2_BUFFER_BYTES);
            IntPtr storageFeatures = AllocateZeroed(wrapperHeaderBytes + 16);
            IntPtr features2 = AllocateZeroed(FEATURES_2_BUFFER_BYTES);
            try
            {
                Marshal.WriteInt32(idProperties, 0,
                    unchecked((int)VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES));
                Marshal.WriteInt32(properties2, 0,
                    unchecked((int)VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2));
                Marshal.WriteIntPtr(properties2, pointerOffset, idProperties);
                getProperties(physicalDevice, properties2);

                byte[] deviceUuid = new byte[16];
                Marshal.Copy(
                    IntPtr.Add(idProperties, wrapperHeaderBytes),
                    deviceUuid,
                    0,
                    deviceUuid.Length);
                byte[] luid = new byte[8];
                Marshal.Copy(IntPtr.Add(idProperties, luidOffset), luid, 0, luid.Length);
                uint highPart = BitConverter.ToUInt32(luid, 4);
                uint lowPart = BitConverter.ToUInt32(luid, 0);

                Marshal.WriteInt32(storageFeatures, 0,
                    unchecked((int)VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_16BIT_STORAGE_FEATURES));
                Marshal.WriteInt32(features2, 0,
                    unchecked((int)VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2));
                Marshal.WriteIntPtr(features2, pointerOffset, storageFeatures);
                getFeatures(physicalDevice, features2);

                int physicalPropertiesOffset = wrapperHeaderBytes;
                uint deviceType = unchecked((uint)Marshal.ReadInt32(
                    properties2,
                    physicalPropertiesOffset + 16));
                return new VulkanDeviceRecord
                {
                    Luid = highPart.ToString("X8", CultureInfo.InvariantCulture) + ":" +
                        lowPart.ToString("X8", CultureInfo.InvariantCulture),
                    DeviceUuid = BitConverter.ToString(deviceUuid).Replace("-", String.Empty),
                    LuidValid = Marshal.ReadInt32(idProperties, luidValidOffset) != 0,
                    NodeMask = unchecked((uint)Marshal.ReadInt32(idProperties, nodeMaskOffset)),
                    DeviceType = deviceType,
                    StorageBuffer16BitAccess =
                        Marshal.ReadInt32(storageFeatures, storageFeatureOffset) != 0,
                    HasComputeQueue = HasComputeQueue(physicalDevice, getQueueFamilies)
                };
            }
            finally
            {
                Marshal.FreeHGlobal(features2);
                Marshal.FreeHGlobal(storageFeatures);
                Marshal.FreeHGlobal(properties2);
                Marshal.FreeHGlobal(idProperties);
            }
        }

        public static VulkanDeviceRecord[] Query()
        {
            if (!LoaderSupportsVulkan12())
                throw new InvalidOperationException("Vulkan 1.2 loader is required.");

            IntPtr appInfoPointer = IntPtr.Zero;
            IntPtr instance = IntPtr.Zero;
            try
            {
                VkApplicationInfo appInfo = new VkApplicationInfo
                {
                    sType = VK_STRUCTURE_TYPE_APPLICATION_INFO,
                    apiVersion = VK_API_VERSION_1_2
                };
                appInfoPointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(VkApplicationInfo)));
                Marshal.StructureToPtr(appInfo, appInfoPointer, false);
                VkInstanceCreateInfo createInfo = new VkInstanceCreateInfo
                {
                    sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
                    pApplicationInfo = appInfoPointer
                };
                int result = vkCreateInstance(ref createInfo, IntPtr.Zero, out instance);
                if (result != VK_SUCCESS || instance == IntPtr.Zero)
                    throw new InvalidOperationException("vkCreateInstance failed: " + result);

                GetPhysicalDeviceProperties2Delegate getProperties =
                    (GetPhysicalDeviceProperties2Delegate)Resolve(
                        instance,
                        "vkGetPhysicalDeviceProperties2",
                        typeof(GetPhysicalDeviceProperties2Delegate));
                GetPhysicalDeviceFeatures2Delegate getFeatures =
                    (GetPhysicalDeviceFeatures2Delegate)Resolve(
                        instance,
                        "vkGetPhysicalDeviceFeatures2",
                        typeof(GetPhysicalDeviceFeatures2Delegate));
                GetPhysicalDeviceQueueFamilyPropertiesDelegate getQueueFamilies =
                    (GetPhysicalDeviceQueueFamilyPropertiesDelegate)Resolve(
                        instance,
                        "vkGetPhysicalDeviceQueueFamilyProperties",
                        typeof(GetPhysicalDeviceQueueFamilyPropertiesDelegate));

                uint count = 0;
                result = vkEnumeratePhysicalDevices(instance, ref count, null);
                if (result != VK_SUCCESS || count == 0) return new VulkanDeviceRecord[0];
                count = Math.Min(count, MAX_PHYSICAL_DEVICES);
                IntPtr[] devices = new IntPtr[count];
                result = vkEnumeratePhysicalDevices(instance, ref count, devices);
                if (result != VK_SUCCESS && result != VK_INCOMPLETE)
                    throw new InvalidOperationException("vkEnumeratePhysicalDevices failed: " + result);

                List<VulkanDeviceRecord> records = new List<VulkanDeviceRecord>();
                int returnedCount = Math.Min(devices.Length, checked((int)count));
                for (int index = 0; index < returnedCount; index++)
                {
                    if (devices[index] != IntPtr.Zero)
                        records.Add(QueryDevice(devices[index], getProperties, getFeatures, getQueueFamilies));
                }
                return records.ToArray();
            }
            finally
            {
                if (instance != IntPtr.Zero) vkDestroyInstance(instance, IntPtr.Zero);
                if (appInfoPointer != IntPtr.Zero) Marshal.FreeHGlobal(appInfoPointer);
            }
        }
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'Djl.LocalModels.WindowsVulkanQuery').Type) {
  Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
}

ConvertTo-Json -InputObject @([Djl.LocalModels.WindowsVulkanQuery]::Query()) -Compress -Depth 4
`;

export async function runWindowsVulkanQuery(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_VULKAN_QUERY_SCRIPT],
      {
        encoding: "utf8",
        env: sanitizedWindowsVulkanEnvironment(process.env),
        windowsHide: true,
        timeout: VULKAN_QUERY_TIMEOUT_MS,
        maxBuffer: MAX_QUERY_OUTPUT_BYTES,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export async function queryWindowsVulkanDeviceInventory(
  options: WindowsVulkanQueryOptions = {},
): Promise<WindowsVulkanDevice[]> {
  if ((options.platform ?? process.platform) !== "win32") return [];
  try {
    return parseWindowsVulkanDeviceInventory(await (options.runQuery ?? runWindowsVulkanQuery)());
  } catch {
    return [];
  }
}
