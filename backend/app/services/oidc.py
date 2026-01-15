from __future__ import annotations

import json
import os
import secrets
import uuid
from dataclasses import dataclass

import httpx
import structlog
from authlib.integrations.httpx_client import OAuth2Client
from authlib.jose import jwt
from authlib.jose.errors import BadSignatureError, DecodeError, ExpiredTokenError, JoseError
from redis import Redis

from app.settings import settings

logger = structlog.get_logger(__name__)


class OidcError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class OidcState:
    state: str
    nonce: str
    code_verifier: str
    provider_id: uuid.UUID


@dataclass(frozen=True)
class OidcProviderMetadata:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str


def oidc_state_key(portal_session_id: uuid.UUID) -> str:
    return f"oidc:{portal_session_id}"


def store_oidc_state(
    redis_client: Redis,
    *,
    portal_session_id: uuid.UUID,
    state: str,
    nonce: str,
    code_verifier: str,
    provider_id: uuid.UUID,
) -> None:
    payload = {
        "state": state,
        "nonce": nonce,
        "code_verifier": code_verifier,
        "provider_id": str(provider_id),
    }
    redis_client.setex(
        oidc_state_key(portal_session_id),
        settings.OIDC_STATE_TTL_SECONDS,
        json.dumps(payload),
    )


def get_oidc_state(redis_client: Redis, *, portal_session_id: uuid.UUID) -> OidcState | None:
    raw = redis_client.get(oidc_state_key(portal_session_id))
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        return OidcState(
            state=payload["state"],
            nonce=payload["nonce"],
            code_verifier=payload["code_verifier"],
            provider_id=uuid.UUID(payload["provider_id"]),
        )
    except (KeyError, ValueError, json.JSONDecodeError):
        return None


def clear_oidc_state(redis_client: Redis, *, portal_session_id: uuid.UUID) -> None:
    redis_client.delete(oidc_state_key(portal_session_id))


def generate_state_token(portal_session_id: uuid.UUID) -> str:
    return f"{portal_session_id}.{secrets.token_urlsafe(12)}"


def generate_nonce() -> str:
    return secrets.token_urlsafe(16)


def generate_code_verifier() -> str:
    return secrets.token_urlsafe(32)


def resolve_secret(ref: str) -> str:
    value = os.environ.get(ref)
    if not value:
        raise OidcError("OIDC_SECRET_MISSING", "OIDC client secret is not configured.")
    return value


def discover_provider_metadata(issuer: str) -> OidcProviderMetadata:
    well_known = issuer.rstrip("/") + "/.well-known/openid-configuration"
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(well_known)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.error("oidc_discovery_failed", issuer=issuer, error=str(exc))
        raise OidcError("OIDC_DISCOVERY_FAILED", "Failed to load OIDC configuration.") from exc

    try:
        return OidcProviderMetadata(
            issuer=payload["issuer"],
            authorization_endpoint=payload["authorization_endpoint"],
            token_endpoint=payload["token_endpoint"],
            jwks_uri=payload["jwks_uri"],
        )
    except KeyError as exc:
        raise OidcError("OIDC_CONFIG_INVALID", "OIDC configuration missing fields.") from exc


def build_oauth_client(*, client_id: str, client_secret_ref: str, scopes: str, redirect_uri: str) -> OAuth2Client:
    client_secret = resolve_secret(client_secret_ref)
    client = OAuth2Client(
        client_id=client_id,
        client_secret=client_secret,
        scope=scopes,
        redirect_uri=redirect_uri,
        timeout=10.0,
    )
    client.code_challenge_method = "S256"
    return client


def fetch_jwks(jwks_uri: str) -> dict:
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(jwks_uri)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.error("oidc_jwks_failed", jwks_uri=jwks_uri, error=str(exc))
        raise OidcError("OIDC_JWKS_FAILED", "Failed to load OIDC signing keys.") from exc
    return payload


def exchange_code_for_claims(
    *,
    issuer: str,
    client_id: str,
    client_secret_ref: str,
    scopes: str,
    redirect_uri: str,
    code: str,
    code_verifier: str,
    nonce: str,
) -> dict:
    metadata = discover_provider_metadata(issuer)
    client = build_oauth_client(
        client_id=client_id,
        client_secret_ref=client_secret_ref,
        scopes=scopes,
        redirect_uri=redirect_uri,
    )
    try:
        token = client.fetch_token(
            metadata.token_endpoint,
            code=code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
        )
    except Exception as exc:
        logger.error("oidc_token_exchange_failed", issuer=issuer, error=str(exc))
        raise OidcError("OIDC_TOKEN_FAILED", "Failed to exchange code for token.") from exc

    id_token = token.get("id_token")
    if not id_token:
        raise OidcError("OIDC_ID_TOKEN_MISSING", "ID token missing from response.")

    jwks = fetch_jwks(metadata.jwks_uri)
    claims_options = {
        "iss": {"value": metadata.issuer},
        "aud": {"value": client_id},
        "nonce": {"value": nonce},
    }
    try:
        claims = jwt.decode(id_token, jwks, claims_options=claims_options)
        claims.validate()
    except (BadSignatureError, DecodeError, ExpiredTokenError, JoseError) as exc:
        logger.error("oidc_id_token_invalid", issuer=issuer, error=str(exc))
        raise OidcError("OIDC_ID_TOKEN_INVALID", "ID token validation failed.") from exc

    return dict(claims)
