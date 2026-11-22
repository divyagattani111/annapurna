-- One approved legacy import row cannot create two opening sources, even under different request keys.
CREATE UNIQUE INDEX opening_row_once ON documents(org,(data->>'batchId'),(data->>'rowId')) WHERE kind='opening' OR (kind='loan' AND data->>'opening'='true');
