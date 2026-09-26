import writeXlsxFile from "write-excel-file/browser";
import {
  buildInventoryRows,
  type ExportScope,
} from "@/lib/inventory";
import type { Catalog, OwnedSnapshot } from "@/lib/types";

export async function downloadInventoryXlsx(
  catalog: Catalog,
  owned: OwnedSnapshot | null,
  scope: ExportScope,
): Promise<void> {
  const rows = buildInventoryRows(catalog, owned, scope);
  await writeXlsxFile(rows).toFile(`inventory_${scope}.xlsx`);
}
