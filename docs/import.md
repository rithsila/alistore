# Product Import (BACKEND-02)

Bulk-load the catalog with per-size/per-color variants using **Medusa Admin's
built-in product import** and the ready-made template at
[`imports/products-template.csv`](../imports/products-template.csv).

The template is authored against **Medusa v2.15.3's official product-import
column format** — the same column names the Admin importer expects. It ships a
small sample clothing catalog (3 products, 6 variants each) you can import as-is
to verify the flow, then replace with your real catalog.

## What the template contains

| Product | Handle | Variants (Size × Color) | USD | KHR |
|---------|--------|--------------------------|-----|-----|
| Classic Cotton Tee | `classic-cotton-tee` | S/M/L × Black/White | 9.99 | 41000 |
| Everyday Pullover Hoodie | `everyday-hoodie` | S/M/L × Charcoal/Navy | 24.99 | 102500 |
| Slim Chino Pants | `slim-chino-pants` | 30/32/34 × Khaki/Black | 19.99 | 82000 |

One **row per variant**. Rows that share a `Product Handle` are grouped into one
product; the importer derives the option lists (Size, Color) from the variant
rows.

## Columns

These are official Medusa import column names. Include only the columns you use —
the importer matches by header name and ignores empty cells.

| Column | Meaning |
|--------|---------|
| `Product Handle` | **Required.** Groups variant rows into one product (URL slug). |
| `Product Title` | Product display name. |
| `Product Description` | Product description. |
| `Product Status` | `published` (so it can appear in the storefront) or `draft`. |
| `Product Discountable` | `TRUE`/`FALSE`. |
| `Variant Title` | Unique label per variant, e.g. `Black / S`. |
| `Variant SKU` | Unique stock-keeping unit, e.g. `TEE-BLK-S`. |
| `Variant Allow Backorder` | `TRUE`/`FALSE`. |
| `Variant Manage Inventory` | `TRUE` so an inventory item is created per variant. |
| `Variant Price USD` | Price in USD, stored **as-is** (`9.99` = $9.99 — never cents). |
| `Variant Price KHR` | Price in KHR, **whole riel only** (`41000`), no decimals. |
| `Variant Option 1 Name` / `Value` | `Size` and its value (`S`, `M`, `30`, …). |
| `Variant Option 2 Name` / `Value` | `Color` and its value (`Black`, `Navy`, …). |
| `Product Image 1 Url` | Image URL. Add `Product Image 2 Url`, etc. for more. |

**Multi-currency:** USD and KHR are separate price columns. The importer reads
the currency from the column name (`Variant Price <CODE>`), so both currencies
must be enabled on the store (see Prerequisites).

**Images:** the sample uses placeholder URLs under `img.alistore.com`. Replace
them with the real Cloudflare R2 / CDN URLs of your uploaded product photos
before importing your live catalog.

## Prerequisites (one-time, in Admin)

Before importing, make sure the store has:

1. **Currencies enabled** — both `USD` and `KHR` added to the store
   (Settings → Store → Currencies). KHR prices are skipped if KHR is not enabled.
2. **A sales channel + publishable key** — the storefront reads products through
   a publishable key bound to a sales channel.

## How to import

1. Open the Admin dashboard at `http://localhost:9000/app` and log in.
2. Go to **Products → ⋯ (top-right) → Import**.
3. Upload `imports/products-template.csv`.
4. Review the import summary (products / variants to be created), then
   **confirm**. Medusa processes the import and creates the products, variants,
   options, and prices.

## After import — required manual steps

Medusa's **built-in CSV importer does not carry two things**, so set them in
Admin after the import (verified against the v2.15.3 importer source — there is
no stock-quantity column, and category/sales-channel are environment-specific
IDs that can't be hardcoded in a portable template):

1. **Inventory levels (initial stock).** The importer creates inventory *items*
   (because `Manage Inventory = TRUE`) but **not stocked quantities**. Set stock
   per variant: **Inventory → select the item → set quantity at your location**
   (or bulk-edit on the product's Variants tab).
2. **Sales channel.** Assign each product to the storefront's sales channel
   (product page → **Sales Channels**) so it appears in `/store/products`.
3. **Category** *(optional)*. The template omits category (the importer needs a
   category **ID**, which differs per environment). Assign categories on the
   product's **Organize** panel if you use them.

## Verify

- **Admin:** the three products appear under Products, each with its Size × Color
  variants and USD + KHR prices.
- **Storefront API:** once a product is published *and* in the publishable key's
  sales channel, its variants are returned by:

  ```
  GET http://localhost:9000/store/products?handle=classic-cotton-tee
  ```

  (send the `x-publishable-api-key` header).
