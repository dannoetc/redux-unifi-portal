from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models import Site, Tenant, TenantStatus, Voucher, VoucherBatch, VoucherRedemption
from app.services.vouchers import VoucherError, redeem_voucher


def _make_site(db_session):
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
    site = Site(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        slug="lab",
        display_name="Lab",
        enabled=True,
        unifi_base_url="https://unifi.local",
        unifi_site_id="default",
        unifi_api_key_ref="dev",
        default_time_limit_minutes=60,
        default_data_limit_mb=None,
        default_rx_kbps=None,
        default_tx_kbps=None,
    )
    db_session.add_all([tenant, site])
    db_session.commit()
    return tenant, site


def test_voucher_redeem_increments_uses(db_session):
    tenant, site = _make_site(db_session)
    batch = VoucherBatch(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site.id,
        name="Promo",
        max_uses_per_code=2,
    )
    voucher = Voucher(id=uuid.uuid4(), batch_id=batch.id, code="ABC123", uses=0, disabled=False)
    db_session.add_all([batch, voucher])
    db_session.commit()

    redemption = redeem_voucher(
        db_session,
        site_id=site.id,
        tenant_id=tenant.id,
        portal_session_id=uuid.uuid4(),
        code="abc123",
        client_mac="aa:bb:cc:dd:ee:ff",
    )
    assert redemption.voucher_id == voucher.id

    updated = db_session.execute(select(Voucher).where(Voucher.id == voucher.id)).scalar_one()
    assert updated.uses == 1

    redemption_row = db_session.execute(select(VoucherRedemption)).scalars().first()
    assert redemption_row is not None


def test_voucher_exhausted(db_session):
    tenant, site = _make_site(db_session)
    batch = VoucherBatch(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site.id,
        name="Promo",
        max_uses_per_code=1,
    )
    voucher = Voucher(id=uuid.uuid4(), batch_id=batch.id, code="ONCE", uses=1, disabled=False)
    db_session.add_all([batch, voucher])
    db_session.commit()

    with pytest.raises(VoucherError):
        redeem_voucher(
            db_session,
            site_id=site.id,
            tenant_id=tenant.id,
            portal_session_id=uuid.uuid4(),
            code="ONCE",
            client_mac="aa:bb:cc:dd:ee:ff",
        )
