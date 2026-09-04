import asyncio
import os

import typer
import uvicorn
from redis.asyncio import Redis
from redis.exceptions import RedisError

from .config import Settings
from .redis_actions import purge_oauth2_proxy_session, redis_key_from_oauth2_proxy_cookie

app = typer.Typer(help="Run controlled Erato chaos actions.")


def choose(prompt: str, options: list[str]) -> int:
    typer.echo(prompt)
    for index, option in enumerate(options, start=1):
        typer.echo(f"  {index}) {option}")
    choice = typer.prompt("Choose an option")
    try:
        selected = int(choice) - 1
    except ValueError as error:
        raise typer.BadParameter("choose one of the displayed numbers") from error
    if selected not in range(len(options)):
        raise typer.BadParameter("choose one of the displayed numbers")
    return selected


@app.command()
def serve(
    host: str | None = typer.Option(None, help="Bind host (defaults to ERATO_CHAOS_HOST)."),
    port: int | None = typer.Option(None, help="Bind port (defaults to ERATO_CHAOS_PORT)."),
    redis_url: str | None = typer.Option(
        None, help="Redis URL (defaults to local-auth or ERATO_CHAOS_REDIS_URL)."
    ),
) -> None:
    """Start the FastAPI server."""
    settings = Settings.from_env()
    if redis_url is not None:
        os.environ["ERATO_CHAOS_REDIS_URL"] = redis_url
    uvicorn.run(
        "erato_chaos_creator.main:app",
        host=host or settings.host,
        port=port or settings.port,
        factory=False,
    )


@app.command("purge-session")
def purge_session(
    session_key: str = typer.Argument(help="Exact oauth2-proxy Redis session key."),
    redis_url: str | None = typer.Option(None, help="Redis URL (defaults to ERATO_CHAOS_REDIS_URL)."),
) -> None:
    """Purge one oauth2-proxy session from Redis."""
    settings = Settings.from_env()
    redis = Redis.from_url(redis_url or settings.redis_url)

    async def run() -> None:
        try:
            result = await purge_oauth2_proxy_session(redis, session_key)
        except ValueError as error:
            raise typer.BadParameter(str(error), param_hint="session_key") from error
        finally:
            await redis.aclose()
        typer.echo(f"{'deleted' if result.deleted else 'not found'}: {result.key}")

    asyncio.run(run())


@app.command("purge-cookie")
def purge_cookie(
    cookie: str = typer.Argument(help="Complete oauth2-proxy cookie or ticket value."),
    redis_url: str | None = typer.Option(None, help="Redis URL (defaults to ERATO_CHAOS_REDIS_URL)."),
) -> None:
    """Extract and purge one oauth2-proxy session from a cookie."""
    settings = Settings.from_env()
    redis = Redis.from_url(redis_url or settings.redis_url)

    async def run() -> None:
        try:
            session_key = redis_key_from_oauth2_proxy_cookie(cookie)
            result = await purge_oauth2_proxy_session(redis, session_key)
        except ValueError as error:
            raise typer.BadParameter(str(error), param_hint="cookie") from error
        finally:
            await redis.aclose()
        typer.echo(f"{'deleted' if result.deleted else 'not found'}: {result.key}")

    asyncio.run(run())


@app.command()
def interactive(
    redis_url: str | None = typer.Option(
        None, help="Redis URL (defaults to local-auth or ERATO_CHAOS_REDIS_URL)."
    ),
) -> None:
    """Run chaos actions through an interactive menu."""
    settings = Settings.from_env()
    resolved_redis_url = redis_url or settings.redis_url
    typer.echo(f"Using Redis: {resolved_redis_url}")
    redis = Redis.from_url(resolved_redis_url)

    async def run() -> None:
        try:
            while True:
                typer.echo()
                action = choose(
                    "Select a chaos action:",
                    [
                        "Purge oauth2-proxy session from cookie",
                        "Purge oauth2-proxy session by exact Redis key",
                        "Exit",
                    ],
                )
                if action == 2:
                    return

                if action == 0:
                    value = typer.prompt("Paste the complete oauth2-proxy cookie", hide_input=True)
                    try:
                        session_key = redis_key_from_oauth2_proxy_cookie(value)
                    except ValueError as error:
                        typer.secho(f"Invalid cookie: {error}", fg=typer.colors.RED)
                        continue
                else:
                    session_key = typer.prompt("Exact Redis session key")

                if not typer.confirm(f"Purge session {session_key!r}?", default=False):
                    typer.echo("Cancelled.")
                    continue

                try:
                    result = await purge_oauth2_proxy_session(redis, session_key)
                except ValueError as error:
                    typer.secho(f"Invalid session key: {error}", fg=typer.colors.RED)
                    continue
                except RedisError as error:
                    typer.secho(f"Redis is unavailable: {error}", fg=typer.colors.RED)
                    continue
                status = "deleted" if result.deleted else "not found"
                typer.echo(f"{status}: {result.key}")
        except (EOFError, KeyboardInterrupt):
            typer.echo("\nExiting.")
        finally:
            await redis.aclose()

    asyncio.run(run())
