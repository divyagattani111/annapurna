UPDATE products SET category = 'CG-01 CIGARETTE' WHERE category = 'cigarette';
UPDATE products SET category = 'CF-05 CONFECTIONERY' WHERE category = 'confectionery';
ALTER TABLE "products" ALTER COLUMN "category" SET DEFAULT 'CG-01 CIGARETTE';

