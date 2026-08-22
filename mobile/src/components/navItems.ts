import { Ionicons } from "@expo/vector-icons";
import { NAV } from "@/constants/labels";
import { IS_DEMO } from "@/constants/demo";

export type IconName = keyof typeof Ionicons.glyphMap;

// route name → label + active/inactive icon (shared by TopNavBar + SideNav).
export const NAV_TABS: Record<string, { label: string; active: IconName; inactive: IconName }> = {
  index: { label: NAV.home, active: "home", inactive: "home-outline" },
  library: { label: NAV.library, active: "library", inactive: "library-outline" },
  shelves: { label: NAV.shelves, active: "albums", inactive: "albums-outline" },
  books: { label: NAV.studio, active: "create", inactive: "create-outline" },
  projects: { label: NAV.projects, active: "folder", inactive: "folder-outline" },
  reviews: { label: NAV.reviews, active: "shield-checkmark", inactive: "shield-checkmark-outline" },
  posts: { label: NAV.publish, active: "megaphone", inactive: "megaphone-outline" },
  settings: { label: NAV.settings, active: "settings", inactive: "settings-outline" },
  help: { label: NAV.help, active: "help-circle", inactive: "help-circle-outline" },
  about: { label: NAV.about, active: "information-circle", inactive: "information-circle-outline" },
};

// Visual order. Shelves, Studio (books) and Publish (posts) are intentionally
// HIDDEN from the nav (routes stay registered + reachable by link). The primary
// create entry is now the Library "Start Creating" button → Projects (ADR-037);
// Studio (books) has no nav/Library entry and is reached only by direct link.
// Projects/Reviews need a backend account and are omitted from the demo.
export const NAV_ORDER: string[] = [
  "index",
  "library",
  ...(IS_DEMO ? [] : ["projects", "reviews"]),
  "settings",
  "help",
  "about",
];

// Marketing-link anchors (signed-out top bar) → sections on the Home surface.
export const MARKETING_LINKS: { label: string; anchor: string }[] = [
  { label: NAV.howItWorks, anchor: "how-it-works" },
  { label: NAV.formats, anchor: "formats" },
  { label: NAV.trust, anchor: "trust" },
  { label: NAV.pricing, anchor: "pricing" },
];
