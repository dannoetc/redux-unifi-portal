from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

@dataclass(frozen=True)
class UnifiPolicy:
    time_limit_minutes: int
    data_limit_mb: int | None = None
    rx_kbps: int | None = None
    tx_kbps: int | None = None

class UnifiApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code

class UnifiClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        site_id: str,
        *,
        tenant_id: str | None = None,
        site_uuid: str | None = None,
        timeout_s: float = 10.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.site_id = site_id
        self.timeout = timeout_s
        self.tenant_id = tenant_id
        self.site_uuid = site_uuid
        self._http_client = http_client

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers={"X-API-KEY": self.api_key, "Accept": "application/json"},
            timeout=self.timeout,
        )

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        if self._http_client:
            return self._http_client.request(method, url, **kwargs)
        with self._client() as client:
            return client.request(method, url, **kwargs)

    def _log_context(self) -> dict[str, Any]:
        return {"unifi_site_id": self.site_id, "tenant_id": self.tenant_id, "site_id": self.site_uuid}

    def get_clients_by_mac(self, mac: str) -> list[dict]:
        params = {"filter": f"macAddress.eq('{mac}')"}
        endpoint = f"/v1/sites/{self.site_id}/clients"
        try:
            response = self._request("GET", endpoint, params=params)
        except httpx.HTTPError as exc:
            logger.error("unifi_request_failed", **self._log_context(), endpoint="GET clients", error=str(exc))
            raise UnifiApiError("UniFi request failed.") from exc
        if response.status_code >= 400:
            logger.error(
                "unifi_request_error",
                **self._log_context(),
                endpoint="GET clients",
                status_code=response.status_code,
            )
            raise UnifiApiError("UniFi returned an error.", status_code=response.status_code)
        payload = response.json()
        return payload.get("data", payload.get("results", []))

    def find_client_by_mac(self, mac: str, attempts: int = 5, backoff_s: float = 0.3) -> dict | None:
        for attempt in range(1, attempts + 1):
            clients = self.get_clients_by_mac(mac)
            if clients:
                return clients[0]
            if attempt < attempts:
                delay = backoff_s * attempt
                logger.info(
                    "unifi_client_not_found_retry",
                    **self._log_context(),
                    attempt=attempt,
                    delay_s=delay,
                )
                import time

                time.sleep(delay)
        return None

    def authorize_guest(self, client_id: str, policy: UnifiPolicy) -> None:
        endpoint = f"/v1/sites/{self.site_id}/clients/{client_id}/actions"
        payload: dict[str, Any] = {
            "action": "AUTHORIZE_GUEST_ACCESS",
            "timeLimitMinutes": policy.time_limit_minutes,
        }
        if policy.data_limit_mb is not None:
            payload["dataUsageLimitMBytes"] = policy.data_limit_mb
        if policy.rx_kbps is not None:
            payload["rxRateLimitKbps"] = policy.rx_kbps
        if policy.tx_kbps is not None:
            payload["txRateLimitKbps"] = policy.tx_kbps
        try:
            response = self._request("POST", endpoint, json=payload)
        except httpx.HTTPError as exc:
            logger.error("unifi_request_failed", **self._log_context(), endpoint="AUTHORIZE", error=str(exc))
            raise UnifiApiError("UniFi request failed.") from exc
        if response.status_code >= 400:
            logger.error(
                "unifi_request_error",
                **self._log_context(),
                endpoint="AUTHORIZE",
                status_code=response.status_code,
            )
            raise UnifiApiError("UniFi returned an error.", status_code=response.status_code)

    def get_client(self, client_id: str) -> dict:
        endpoint = f"/v1/sites/{self.site_id}/clients/{client_id}"
        try:
            response = self._request("GET", endpoint)
        except httpx.HTTPError as exc:
            logger.error("unifi_request_failed", **self._log_context(), endpoint="GET client", error=str(exc))
            raise UnifiApiError("UniFi request failed.") from exc
        if response.status_code >= 400:
            logger.error(
                "unifi_request_error",
                **self._log_context(),
                endpoint="GET client",
                status_code=response.status_code,
            )
            raise UnifiApiError("UniFi returned an error.", status_code=response.status_code)
        return response.json()
