import { CheckCircle, Clock, Loader2, XCircle } from "@lucide/svelte";
import type { ContainerStatus } from "$lib/types";

export const SERVICE_STATUS_CONFIG: Record<
  ContainerStatus,
  { label: string; class: string; icon: typeof CheckCircle }
> = {
  failed: {
    class: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    icon: XCircle,
    label: "Failed",
  },
  pending: {
    class: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    icon: Clock,
    label: "Pending",
  },
  pulling: {
    class: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    icon: Loader2,
    label: "Pulling",
  },
  running: {
    class:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    icon: CheckCircle,
    label: "Running",
  },
  starting: {
    class:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    icon: Loader2,
    label: "Starting",
  },
  stopped: {
    class: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    icon: XCircle,
    label: "Stopped",
  },
};

export const GRADIENTS = [
  "from-violet-500 to-purple-700",
  "from-blue-500 to-indigo-700",
  "from-rose-500 to-red-700",
  "from-amber-500 to-orange-700",
  "from-emerald-500 to-green-700",
  "from-sky-500 to-cyan-700",
  "from-pink-500 to-fuchsia-700",
  "from-teal-500 to-cyan-700",
] as const;

export const GRADIENTS_DARKER = [
  "from-violet-600 via-purple-700 to-indigo-900",
  "from-blue-600 via-indigo-700 to-violet-900",
  "from-rose-600 via-pink-700 to-purple-900",
  "from-emerald-600 via-teal-700 to-cyan-900",
  "from-amber-600 via-orange-700 to-red-900",
  "from-cyan-600 via-blue-700 to-indigo-900",
  "from-fuchsia-600 via-violet-700 to-purple-900",
  "from-red-600 via-rose-700 to-pink-900",
] as const;
