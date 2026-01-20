from __future__ import annotations

import json

import httpx

from app.services.unifi import UnifiClient, UnifiPolicy


def test_get_clients_by_mac():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/sites/default/clients"
        assert request.url.params.get("filter") == "macAddress.eq('AA:BB:CC:DD:EE:FF')"
        return httpx.Response(200, json={"data": [{"id": "client-1"}]})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(base_url="https://unifi.local", transport=transport)

    api = UnifiClient("https://unifi.local", "key", "default", http_client=client)
    result = api.get_clients_by_mac("AA:BB:CC:DD:EE:FF")
    assert result == [{"id": "client-1"}]


def test_authorize_guest_sends_policy():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/sites/default/clients/client-1/actions"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["action"] == "AUTHORIZE_GUEST_ACCESS"
        assert payload["timeLimitMinutes"] == 60
        assert payload["dataUsageLimitMBytes"] == 500
        assert payload["rxRateLimitKbps"] == 1000
        assert payload["txRateLimitKbps"] == 2000
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(base_url="https://unifi.local", transport=transport)

    api = UnifiClient("https://unifi.local", "key", "default", http_client=client)
    policy = UnifiPolicy(time_limit_minutes=60, data_limit_mb=500, rx_kbps=1000, tx_kbps=2000)
    api.authorize_guest("client-1", policy)


def test_find_client_by_mac_retries():
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] < 2:
            return httpx.Response(200, json={"data": []})
        return httpx.Response(200, json={"data": [{"id": "client-2"}]})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(base_url="https://unifi.local", transport=transport)

    api = UnifiClient("https://unifi.local", "key", "default", http_client=client)
    result = api.find_client_by_mac("AA:BB:CC:DD:EE:FF", attempts=3, backoff_s=0)
    assert result == {"id": "client-2"}


def test_find_client_by_mac_falls_back_to_lowercase():
    seen_filters = []

    def handler(request: httpx.Request) -> httpx.Response:
        filter_value = request.url.params.get("filter")
        seen_filters.append(filter_value)
        if filter_value == "macAddress.eq('aa:bb:cc:dd:ee:ff')":
            return httpx.Response(200, json={"data": [{"id": "client-lower"}]})
        return httpx.Response(200, json={"data": []})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(base_url="https://unifi.local", transport=transport)

    api = UnifiClient("https://unifi.local", "key", "default", http_client=client)
    result = api.find_client_by_mac("AA:BB:CC:DD:EE:FF", attempts=1, backoff_s=0)
    assert result == {"id": "client-lower"}
    assert seen_filters == [
        "macAddress.eq('AA:BB:CC:DD:EE:FF')",
        "macAddress.eq('aa:bb:cc:dd:ee:ff')",
    ]


def test_get_site():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/sites/default"
        return httpx.Response(200, json={"data": {"id": "default", "name": "HQ"}})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(base_url="https://unifi.local", transport=transport)

    api = UnifiClient("https://unifi.local", "key", "default", http_client=client)
    result = api.get_site()
    assert result == {"data": {"id": "default", "name": "HQ"}}
