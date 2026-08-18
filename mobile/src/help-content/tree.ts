import type { HelpTreeNode } from "@/help";

// The Help navigation tree (Help Tree Restructure, 2026-08-18). References
// HELP_TOPICS by id — content lives in topics.ts, this file is structure
// only.
//
// "How generation works" holds scoped-generation/diagram-types/formats, which
// the design spec's D3 tree layout listed as topics to KEEP but didn't place
// anywhere (they're not in the DROPPED list, so the coverage-preservation
// rule requires they stay reachable). They are cross-cutting CONCEPTS (how
// scoping shapes a draft, which diagrams the AI produces, output formats) that
// apply wherever content is generated — including Projects › Drafts — so they
// live in a neutral concepts branch rather than naming the nav-hidden Studio tab.
export const HELP_TREE: HelpTreeNode[] = [
  {
    id: "getting-started",
    title: "Getting started",
    children: [
      { id: "leaf-welcome", title: "Welcome & setup steps", topicId: "getting-started" },
      { id: "leaf-account", title: "Create your account & sign in", topicId: "getting-started-account" },
      { id: "leaf-provider-keys", title: "Choose a provider & get an API key", topicId: "provider-keys" },
      { id: "leaf-plans", title: "Plans & billing", topicId: "plans" },
      { id: "leaf-appearance", title: "Appearance & themes", topicId: "appearance" },
    ],
  },
  {
    id: "projects",
    title: "Projects — your studio",
    blurb: "The expert-validation loop: capture, draft, validate, share.",
    children: [
      {
        id: "projects-overview",
        title: "Overview",
        children: [
          { id: "leaf-what-is-a-project", title: "What is a project?", topicId: "projects" },
          { id: "leaf-project-fields", title: "New project fields", topicId: "project-fields" },
        ],
      },
      { id: "leaf-input", title: "Input", topicId: "sources" },
      { id: "leaf-structure", title: "Structure", topicId: "project-structure" },
      {
        id: "projects-drafts",
        title: "Drafts",
        children: [
          { id: "leaf-drafts", title: "Generating drafts", topicId: "project-drafts" },
          { id: "leaf-generate-full-book", title: "Generate the whole book at once", topicId: "generate-full-book" },
        ],
      },
      {
        id: "projects-feedback",
        title: "Feedback",
        children: [
          { id: "leaf-reviews-tab", title: "The Reviews tab", topicId: "reviews" },
          { id: "leaf-draft-viewer", title: "Read, approve & revise a draft", topicId: "draft-viewer" },
          { id: "leaf-grounding-report", title: "Quality report", topicId: "grounding-report" },
          { id: "leaf-originality-report", title: "Originality check", topicId: "originality-report" },
        ],
      },
      {
        id: "projects-publish",
        title: "Publish",
        children: [
          { id: "leaf-project-publish", title: "Exporting & sharing validated work", topicId: "project-publish" },
          { id: "leaf-word-export", title: "Word (.docx) export", topicId: "word-export" },
          { id: "leaf-kdp-export", title: "Kindle (KDP) export", topicId: "kdp-export" },
          { id: "leaf-publish-pack", title: "Publish pack (for retailers)", topicId: "publish-pack" },
          { id: "leaf-project-rights", title: "Rights & attribution", topicId: "project-rights" },
        ],
      },
    ],
  },
  {
    id: "how-generation-works",
    title: "How generation works",
    blurb: "The concepts behind drafting — scoping, diagram types, and output formats.",
    children: [
      { id: "leaf-scoped-generation", title: "How scoping works", topicId: "scoped-generation" },
      { id: "leaf-diagram-types", title: "Diagram types", topicId: "diagram-types" },
      { id: "leaf-formats", title: "Formats & books", topicId: "formats" },
    ],
  },
  {
    id: "share-shortform",
    title: "Share & short-form",
    blurb: "The Publish nav tab — posts, image cards, carousels, animated cards.",
    children: [
      { id: "leaf-make-a-post", title: "Make a post from your writing", topicId: "make-a-post" },
      { id: "leaf-publish-card", title: "Publish an image card", topicId: "publish-card" },
      { id: "leaf-publish-carousel", title: "Publish a carousel", topicId: "publish-carousel" },
      { id: "leaf-publish-animated", title: "Publish an animated card", topicId: "publish-animated" },
    ],
  },
  {
    id: "reading-library",
    title: "Reading & Library",
    children: [
      { id: "leaf-reading-a-book", title: "Open a book & get around", topicId: "reading-a-book" },
      { id: "leaf-share-a-draft", title: "Share a draft for feedback", topicId: "share-a-draft" },
      { id: "leaf-attach-figures", title: "Add figures to a topic", topicId: "attach-figures" },
    ],
  },
  {
    id: "reference",
    title: "Reference",
    children: [
      { id: "leaf-glossary", title: "Glossary", topicId: "glossary" },
      { id: "leaf-troubleshooting", title: "Troubleshooting", topicId: "troubleshooting" },
    ],
  },
];
