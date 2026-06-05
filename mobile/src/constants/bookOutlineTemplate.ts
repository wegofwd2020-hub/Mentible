// A blank book-outline template the user can download from the New Book screen,
// fill out, and re-upload via "Load from a Markdown file". The structurer groups
// the file into subjects → units (chapters) → subtopics following the headings
// below; the user edits the result before generating. Kept in sync with the
// New Book hint and the /structure prompt (pipeline/toc_structurer.py).
export const BOOK_OUTLINE_TEMPLATE = `# Your Book Title

<!--
HOW TO USE THIS TEMPLATE
  • The first "# " heading becomes your book's title.
  • Each "## " heading is a SUBJECT / Part — a broad area.
  • Each "### " heading is a CHAPTER within that subject.
  • Bullet lines under a chapter are its SUBTOPICS (the finer points).
  • Add or remove parts, chapters, and subtopics freely.
  • Delete these instructions and the example below before uploading.
  • Nothing is generated yet — after uploading you can edit everything,
    then generate the content chapter by chapter with your own API key.
-->

## Part I — First subject area
### Chapter 1 title
- First subtopic
- Second subtopic
- Third subtopic

### Chapter 2 title
- First subtopic
- Second subtopic

## Part II — Second subject area
### Chapter 3 title
- First subtopic
- Second subtopic
`;
