# Vouchers (idiot-proof)

Vouchers are staff-issued codes guests can type into the captive portal.

---

## 0) Before you start

- You must have at least one **site** created.
- If you want different voucher behavior per location, generate batches per site.

---

## 1) Generate a voucher batch

1. Go to **Admin → Vouchers**
2. Confirm the correct tenant is selected in the top bar.
3. Fill out the form:
   - **Batch name** (e.g., `Front Desk - February`)
   - **Site** (the location this batch applies to)
   - **Count** (how many codes to generate)
   - **Code length** (4–16)
   - **Max uses per code** (e.g., `1` for single-use)
   - **Expires at** (optional)

4. Click **Generate vouchers**

---

## 2) Export vouchers to CSV (for printing / emailing)

1. On the vouchers page, find the batch you generated
2. Click **Export CSV**

You’ll get a file containing one voucher code per row.

---

## 3) What the guest does

1. Guest connects to WiFi
2. Portal shows voucher option
3. Guest enters the code
4. Access is granted and UniFi authorizes them

---

## 4) Troubleshooting

### Guests say “invalid code”
- Confirm they’re on the right site (voucher batches are site-scoped)
- Confirm the code hasn’t hit **max uses**
- Confirm the batch isn’t expired

### Guests get stuck after entering a valid code
- Check UniFi connectivity for the site (base URL, API key, site id)
- Check API logs for authorization errors
