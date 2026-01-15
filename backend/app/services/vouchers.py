from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Voucher, VoucherBatch, VoucherRedemption
from app.services.portal_session import normalize_mac


class VoucherError(ValueError):
    pass


def redeem_voucher(
    db: Session,
    *,
    site_id: uuid.UUID,
    tenant_id: uuid.UUID,
    portal_session_id: uuid.UUID | None,
    code: str,
    client_mac: str,
) -> VoucherRedemption:
    normalized_code = code.strip().upper()
    normalized_mac = normalize_mac(client_mac)
    now = datetime.now(timezone.utc)

    with db.begin():
        stmt = (
            select(Voucher, VoucherBatch)
            .join(VoucherBatch, VoucherBatch.id == Voucher.batch_id)
            .where(Voucher.code == normalized_code, VoucherBatch.site_id == site_id)
            .with_for_update()
        )
        result = db.execute(stmt).first()
        if not result:
            raise VoucherError("VOUCHER_NOT_FOUND")
        voucher, batch = result
        if voucher.disabled:
            raise VoucherError("VOUCHER_DISABLED")
        if batch.expires_at:
            expires_at = batch.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= now:
                raise VoucherError("VOUCHER_EXPIRED")
        if voucher.uses >= batch.max_uses_per_code:
            raise VoucherError("VOUCHER_EXHAUSTED")

        voucher.uses += 1
        redemption = VoucherRedemption(
            tenant_id=tenant_id,
            site_id=site_id,
            voucher_id=voucher.id,
            portal_session_id=portal_session_id,
            client_mac=normalized_mac,
        )
        db.add(voucher)
        db.add(redemption)

    return redemption
