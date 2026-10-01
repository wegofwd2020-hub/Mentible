#!/usr/bin/env python3
"""One-time migration: create projects for sxp718@gmail.com's synced books."""

import asyncio
import sys
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import create_async_engine

from src.db import Base
from src.accounts.models import Account
from src.trust.models import Project

async def main():
    # Get DB URL from environment
    from src.core.config import settings
    
    # Create async engine
    engine = create_async_engine(settings.database_url_async, echo=False)
    
    async with engine.begin() as conn:
        # Find account
        result = await conn.execute(
            text("SELECT id FROM account WHERE email = :email"),
            {"email": "sxp718@gmail.com"}
        )
        account_row = result.fetchone()
        if not account_row:
            print("❌ Account sxp718@gmail.com not found")
            await engine.dispose()
            return 1
        
        account_id = account_row[0]
        print(f"✓ Found account: {account_id}")
        
        # Get books for this account
        result = await conn.execute(
            text("""
                SELECT book_id, updated_at FROM synced_book 
                WHERE owner_account_id = :account_id AND deleted = false
                ORDER BY updated_at DESC
            """),
            {"account_id": str(account_id)}
        )
        
        books = result.fetchall()
        print(f"✓ Found {len(books)} books to migrate")
        
        if not books:
            print("No books to migrate.")
            await engine.dispose()
            return 0
        
        # Create project for each book
        created = []
        for book_id, updated_at in books:
            title = f"Project: {book_id}"
            
            result = await conn.execute(
                text("""
                    INSERT INTO project (owner_account_id, title, status, created_at, updated_at)
                    VALUES (:owner_id, :title, 'active', NOW(), NOW())
                    RETURNING id
                """),
                {"owner_id": str(account_id), "title": title}
            )
            
            project_id = result.fetchone()[0]
            created.append((project_id, book_id, title))
            print(f"  ✓ Created project {project_id}: {title}")
        
        await conn.commit()
    
    print(f"\n✅ Created {len(created)} projects")
    print("\nCreated projects (project_id <- book_id):")
    for pid, bid, title in created:
        print(f"  {pid} <- {bid}")
    
    await engine.dispose()
    return 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
