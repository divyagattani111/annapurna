ALTER TABLE products ADD COLUMN IF NOT EXISTS itc_multiple numeric(10, 2) DEFAULT NULL;

UPDATE products SET itc_multiple = '0.40' WHERE code = '3531';
UPDATE products SET itc_multiple = '0.20' WHERE code IN ('3692', '3624', '3757', '3759', '3053', '3752', '3652', '3653', '4546');
UPDATE products SET itc_multiple = '0.10' WHERE itc_multiple IS NULL;

