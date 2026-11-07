import { useSearchParams } from "react-router";
import SidebarDemo from "@/components/sidebar-demo";

/** Development-only page for the Aceternity sidebar demo. Add ?theme=dark for dark mode. */
export default function SidebarDemoPage() {
  const [params] = useSearchParams();
  const dark = params.get("theme") === "dark";
  return (
    <div className={dark ? "dark" : undefined}>
      <div className="flex min-h-svh items-center bg-white p-4 dark:bg-neutral-950 md:p-8">
        <SidebarDemo />
      </div>
    </div>
  );
}
