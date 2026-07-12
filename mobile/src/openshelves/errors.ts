// Typed errors for the Open Shelves feed engine — mirrors the backend house
// pattern (PublishError / CompilerError): a distinct class per failure kind with
// a stable `name`, so callers branch on type and the UI maps each to copy.

export class FeedSourceError extends Error {
  authRequired?: boolean;
  constructor(message: string, opts?: { authRequired?: boolean }) {
    super(message);
    this.name = "FeedSourceError";
    if (opts?.authRequired) this.authRequired = true;
  }
}

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

export class FeedRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedRefreshError";
  }
}
