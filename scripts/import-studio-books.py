#!/usr/bin/env python3
"""Bulk import old Studio books into Projects (expert-validation workspace).

Usage:
  python scripts/import-studio-books.py imports/old_studio_books/ \
    --account sxp718@gmail.com \
    --api-url https://mambakkam.net/mentible-api \
    --token <BEARER_TOKEN>
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import httpx

# Default to web app backend URL
DEFAULT_API_URL = "https://mambakkam.net/mentible-api"


def load_manifest(project_dir: Path) -> dict:
    """Load manifest.json from project directory."""
    manifest_path = project_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"manifest.json not found in {project_dir}")
    with open(manifest_path) as f:
        return json.load(f)


def load_topic_content(topic_file: Path) -> str:
    """Load markdown content from topic file."""
    if not topic_file.exists():
        raise FileNotFoundError(f"Topic file not found: {topic_file}")
    with open(topic_file) as f:
        return f.read()


def create_project(
    client: httpx.Client, manifest: dict, account_id: str
) -> str:
    """Create a project and return project_id."""
    payload = {
        "title": manifest["title"],
        "description": manifest.get("description", ""),
    }
    resp = client.post("/api/v1/trust/projects", json=payload)
    resp.raise_for_status()
    project_id = resp.json()["id"]
    print(f"✓ Created project: {manifest['title']} (id={project_id})")
    return project_id


def add_topic(
    client: httpx.Client, project_id: str, topic: dict, content: str
) -> str:
    """Add a topic to a project and return topic_id."""
    payload = {
        "label": topic["label"],
        "body_markdown": content,
    }
    resp = client.post(f"/api/v1/trust/projects/{project_id}/topics", json=payload)
    resp.raise_for_status()
    topic_id = resp.json()["id"]
    print(f"  ✓ Added topic: {topic['label']} (id={topic_id})")
    return topic_id


def import_project(
    client: httpx.Client,
    project_dir: Path,
    account_id: str,
) -> bool:
    """Import one project directory."""
    try:
        manifest = load_manifest(project_dir)
        print(f"\nImporting: {manifest['title']}")

        # Create project
        project_id = create_project(client, manifest, account_id)

        # Add topics
        for topic in manifest.get("topics", []):
            topic_file = project_dir / topic["file"]
            content = load_topic_content(topic_file)
            add_topic(client, project_id, topic, content)

        return True
    except Exception as e:
        print(f"✗ Error importing {project_dir}: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Bulk import old Studio books into Projects"
    )
    parser.add_argument(
        "import_dir",
        type=Path,
        help="Directory containing project subdirectories with manifest.json",
    )
    parser.add_argument(
        "--api-url",
        default=DEFAULT_API_URL,
        help=f"Backend API URL (default: {DEFAULT_API_URL})",
    )
    parser.add_argument(
        "--token",
        required=True,
        help="Bearer token (OAuth or session JWT from auth endpoint)",
    )
    parser.add_argument(
        "--account",
        help="Account email (for logging only)",
    )

    args = parser.parse_args()

    if not args.import_dir.exists():
        print(f"Error: {args.import_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    # Authenticate
    headers = {"Authorization": f"Bearer {args.token}"}
    client = httpx.Client(base_url=args.api_url, headers=headers)

    try:
        # Verify auth works
        resp = client.get("/api/v1/account")
        resp.raise_for_status()
        account = resp.json()
        print(f"✓ Authenticated as: {account.get('email', 'unknown')}")
        account_id = account.get("id")
    except httpx.HTTPError as e:
        print(f"✗ Authentication failed: {e}", file=sys.stderr)
        sys.exit(1)

    # Import all projects in the directory
    project_dirs = [d for d in args.import_dir.iterdir() if d.is_dir()]
    if not project_dirs:
        print(f"No project directories found in {args.import_dir}")
        sys.exit(1)

    print(f"\nImporting {len(project_dirs)} project(s)...\n")
    successes = sum(
        import_project(client, pdir, account_id) for pdir in sorted(project_dirs)
    )
    print(f"\n✓ Imported {successes}/{len(project_dirs)} projects")

    if successes < len(project_dirs):
        sys.exit(1)


if __name__ == "__main__":
    main()
