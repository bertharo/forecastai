/** Page titles matching sidebar labels — used by TopBar. */
export const PAGE_META: Record<
  string,
  { title: string; subtitle?: string; exact?: boolean }
> = {
  "/": {
    title: "Home",
    subtitle: "Here’s where spend stands.",
  },
  "/onboarding": {
    title: "Workspaces",
    subtitle: "Create or open a folder for AI spend.",
  },
  "/budgets": {
    title: "Plan",
    subtitle: "Set monthly limits and track burn.",
  },
  "/ai-cost": {
    title: "AI cost",
    subtitle: "Coding-tool spend by person and team.",
  },
  "/keys": {
    title: "Keys",
    subtitle: "Map API keys to teams.",
  },
  "/scenarios": {
    title: "Scenarios",
    subtitle: "Try a change before you make it.",
  },
  "/model-switch": {
    title: "Scenarios",
    subtitle: "Try a change before you make it.",
  },
  "/connectors": {
    title: "Sources",
    subtitle: "Upload a spreadsheet or connect a vendor.",
  },
  "/import": {
    title: "Sources",
    subtitle: "Upload roster and usage files.",
  },
  "/allocation": {
    title: "Alerts",
    subtitle: "Fix spend that isn’t assigned to a team.",
  },
  "/settings": {
    title: "Settings",
    subtitle: "Workspace data and preferences.",
  },
  "/price-cards": {
    title: "Sources",
    subtitle: "Versioned vendor pricing.",
  },
  "/forecast": {
    title: "Plan",
    subtitle: "Forecast vs plan.",
  },
};

export function metaForPath(pathname: string): {
  title: string;
  subtitle?: string;
  isHome: boolean;
} {
  if (pathname === "/") {
    return { ...PAGE_META["/"], isHome: true };
  }
  const exact = Object.entries(PAGE_META).find(
    ([href, m]) => m.exact && pathname === href
  );
  if (exact) return { ...exact[1], isHome: false };

  const match = Object.entries(PAGE_META)
    .filter(([href]) => href !== "/")
    .sort((a, b) => b[0].length - a[0].length)
    .find(([href]) => pathname === href || pathname.startsWith(`${href}/`));

  if (match) return { ...match[1], isHome: false };
  return { title: "Meter", isHome: false };
}
