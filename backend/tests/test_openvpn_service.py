from __future__ import annotations

from pathlib import Path

from app.services import openvpn


def test_generate_openvpn_client_overwrites_existing_request(monkeypatch, tmp_path: Path) -> None:
    pki_path = tmp_path / "pki"
    (pki_path / "reqs").mkdir(parents=True)
    (pki_path / "private").mkdir()
    (pki_path / "issued").mkdir()
    (pki_path / "reqs" / "events-gateway-01.req").write_text("old-req")
    (pki_path / "private" / "events-gateway-01.key").write_text("old-key")
    (pki_path / "issued" / "events-gateway-01.crt").write_text("old-cert")
    (pki_path / "ca.crt").write_text("ca")

    monkeypatch.setattr(openvpn.settings, "OPENVPN_PKI_PATH", str(pki_path))
    monkeypatch.setattr(openvpn.settings, "OPENVPN_DEFAULT_TEMPLATE", "client\n")

    calls: list[list[str]] = []

    def fake_run(cmd: list[str], _message: str, *, capture_output: bool = False) -> str:
        calls.append(cmd)
        if "build-client-full" in cmd:
            (pki_path / "issued" / "events-gateway-01.crt").write_text("new-cert")
            (pki_path / "private" / "events-gateway-01.key").write_text("new-key")
            (pki_path / "ca.crt").write_text("ca")
        return ""

    monkeypatch.setattr(openvpn, "_run_openvpn_command", fake_run)

    profile = openvpn.generate_openvpn_client_profile("events-gateway-01")

    assert "new-cert" in profile
    assert "auth-user-pass" in profile
    assert not (pki_path / "reqs" / "events-gateway-01.req").exists()
    assert any("revoke-issued" in cmd for cmd in calls)
    assert any("gen-crl" in cmd for cmd in calls)
    assert any("build-client-full" in cmd for cmd in calls)
