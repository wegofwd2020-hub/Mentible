export const FEATURES = {
  commonProjects: "Common Projects",
  projects: "My Projects",
  reviews: "Reviews",
  analytics: "Analytics",
} as const;

export const HELP_TOPICS = [
  {
    key: "capture-create-project",
    featureKey: "projects" as const,
    title: "How to Create a Project",
    description:
      "Start the Capture phase by creating a new project. Add your topic, audience, and goal.",
    content: `
1. Go to "My Projects"
2. Click "Create New Project"
3. Fill in:
   - **Title**: What is your project about?
   - **Topic**: Subject area (e.g., "Python for Beginners")
   - **Audience**: Who is this for? (e.g., "College students")
   - **Goal**: What should readers learn? (e.g., "Understand loops")
4. Click "Create" to start authoring
5. Add inputs (text, links, documents) to ground your project
6. Generate topics to create the outline
`,
  },
  {
    key: "create-invite-reviewer",
    featureKey: "projects" as const,
    title: "How to Invite a Reviewer",
    description: "Invite an expert to validate your project in the Validate phase.",
    content: `
1. Go to your project detail
2. Click "Invite Reviewer"
3. Enter the expert's email
4. They will receive an invite and see the project in their Reviews tab
5. The expert can then approve your versions one by one
`,
  },
  {
    key: "validate-review-approve",
    featureKey: "reviews" as const,
    title: "How to Review and Approve Versions",
    description: "As a reviewer, validate an expert's work by approving versions.",
    content: `
1. Go to "Reviews" to see projects you're invited to review
2. Click a project to see its versions
3. For each version:
   - Review the content
   - Click "Approve" when satisfied
   - The approval is recorded with your identity
4. When all versions are approved, the project moves to Share phase
`,
  },
  {
    key: "share-publish-common",
    featureKey: "commonProjects" as const,
    title: "How to Publish to Common Projects",
    description: "Share your validated project in the Share phase.",
    content: `
1. Go to your project detail
2. Click "Publish to Common Projects"
3. Fill in:
   - **Title**: How you want it listed
   - **Description**: Brief summary
   - **Tags**: e.g., "AI", "Tutorial"
4. Click "Publish"
5. Your project is now visible in the Common Projects library
6. Others can import and adapt it
`,
  },
  {
    key: "manage-projects",
    featureKey: "projects" as const,
    title: "Managing Your Projects",
    description: "Edit, view versions, and track progress on your projects.",
    content: `
1. In "My Projects", click a project to open it
2. **Edit metadata**: Click on title/goal/audience to edit inline
3. **View inputs**: See all the sources you added
4. **View artifacts**: See generated EPUBs, PDFs, and versions
5. **View topics**: See all generated topics and their status
6. **Validation status**: Check if your book is validated (all versions approved)
`,
  },
  {
    key: "analytics-dashboard",
    featureKey: "analytics" as const,
    title: "Using the Analytics Dashboard",
    description: "Track user engagement and identify where readers get stuck.",
    content: `
1. Go to "Analytics" in Settings
2. **Select a project** to view its data
3. **Journey graph**: See stalled users over time
4. **Bottleneck analysis**: Which stages lose the most readers?
5. **Re-engagement rate**: How many respond to interventions?
6. Use this data to improve future versions
`,
  },
];
