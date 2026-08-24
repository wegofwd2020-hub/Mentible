import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _async_dsn(dsn: str) -> str:
    """SQLAlchemy needs the +asyncpg driver; the app's DATABASE_URL is a plain
    asyncpg DSN (postgresql://...)."""
    if dsn.startswith("postgresql://"):
        return "postgresql+asyncpg://" + dsn[len("postgresql://") :]
    return dsn


# Take the connection URL from the environment (not the app Settings — migrations
# need only DATABASE_URL, not BYOK/owner secrets). Empty → alembic.ini's value.
_dsn = _async_dsn(os.environ.get("DATABASE_URL", ""))
if _dsn:
    config.set_main_option("sqlalchemy.url", _dsn)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = None

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


# Belt-and-suspenders RLS: after every migration, enable Row-Level Security on any
# public table that still lacks it. Supabase auto-exposes public tables via PostgREST
# and the anon key ships in the mobile bundle, so a table with RLS OFF = anonymous
# CRUD bypassing the backend (advisor `rls_disabled_in_public`). Enabling RLS with NO
# policies and NO FORCE shuts that door and is safe here: the backend connects as the
# table owner / `postgres` role, which BYPASSES RLS, and the mobile client uses
# supabase-js for AUTH ONLY (no `.from()`/`.rpc()`). NEVER add a permissive
# `using(true)` policy (re-opens it) or `force row level security` (blocks the owner).
# See project-critique/mentible-critique.md §5 and memory mentible-supabase-rls-fix.
_ENABLE_RLS_ALL_PUBLIC = """
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and not rowsecurity
  loop
    execute format('alter table public.%I enable row level security;', r.tablename);
  end loop;
end $$;
"""


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()
        # Postgres/Supabase only: secure any table this (or a prior) migration left
        # without RLS. No-op on other dialects (e.g. SQLite in tests).
        if connection.dialect.name == "postgresql":
            connection.exec_driver_sql(_ENABLE_RLS_ALL_PUBLIC)


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
