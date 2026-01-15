from __future__ import annotations

from dataclasses import dataclass

import httpx

@dataclass(frozen=True)
class UnifiPolicy:
    time_limit_minutes: int
    data_limit_mb: int | None = None
    rx_kbps: int | None = None
    tx_kbps: int | None = None

class UnifiApiError(RuntimeError):
    pass

class UnifiClient:
    def __init__(self, base_url: str, api_key: str, site_id: str, timeout_s: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.site_id = site_id
        self.timeout = timeout_s

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers={"X-API-KEY": self.api_key, "Accept": "application/json"},
            timeout=self.timeout,
        )

    def get_clients_by_mac(self, mac: str) -> list[dict]:
        # TODO: implement UniFi filter query
        raise NotImplementedError

    def authorize_guest(self, client_id: str, policy: UnifiPolicy) -> None:
        # TODO: implement AUTHORIZE_GUEST_ACCESS
        raise NotImplementedError
