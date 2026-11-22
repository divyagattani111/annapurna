ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'cigarette' NOT NULL;
ALTER TABLE "bill_lines" ALTER COLUMN "product_id" DROP NOT NULL;

