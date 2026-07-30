import { Ionicons } from "@expo/vector-icons";
import { NAV } from "@/constants/labels";
import { IS_DEMO } from "@/constants/demo";

export type IconName = keyof typeof Ionicons.glyphMap;

// route name → label + active/inactive icon (shared by TopNavBar + SideNav).
export const NAV_TABS: Record<string, { label: string; active: IconName; inactive: IconName }> = {
  library: { label: NAV.library, active: "library", inactive: "library-outline" },
  shelves: { label: NAV.shelves, active: "albums", inactive: "albums-outline" },
  books: { label: NAV.studio, active: "create", inactive: "create-outline" },
  projects: { label: NAV.projects, active: "folder", inactive: "folder-outline" },
  reviews: { label: NAV.reviews, active: "shield-checkmark", inactive: "shield-checkmark-outline" },
  posts: { label: NAV.posts, active: "megaphone", inactive: "megaphone-outline" },
  settings: { label: NAV.settings, active: "settings", inactive: "settings-outline" },
  help: { label: NAV.help, active: "help-circle", inactive: "help-circle-outline" },
  about: { label: NAV.about, active: "information-circle", inactive: "information-circle-outline" },
};

// Visual order. Projects/Reviews/Posts need a backend account (ADR-037) and are
// omitted from the demo build.
export const NAV_ORDER: string[] = [
  "library",
  "shelves",
  "books",
  ...(IS_DEMO ? [] : ["projects", "reviews", "posts"]),
  "settings",
  "help",
  "about",
];
