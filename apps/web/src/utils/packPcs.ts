import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../api";

const packPcsCache: Record<string, number> = {};

export function getPackPcsMap(): Record<string, number> {
  return { ...packPcsCache };
}

export function savePackPcsMap(map: Record<string, number>) {
  for (const [k, v] of Object.entries(map)) {
    packPcsCache[k] = v;
    api("product-pack-pcs", z.any(), { productId: k, pcsPerPack: v }, "POST").catch(() => {});
  }
}

export async function saveProductPackPcs(productId: string, pcsPerPack: number) {
  packPcsCache[productId] = pcsPerPack;
  await api("product-pack-pcs", z.any(), { productId, pcsPerPack }, "POST");
}

export function getProductPackPcs(productId: string): number {
  const val = packPcsCache[productId];
  if (typeof val === "number" && val > 0) return val;
  return 100; // default 100 pcs per m/pack
}

export function usePackPcsSynced(enabled = true) {
  return useQuery({
    queryKey: ["product-pack-pcs"],
    queryFn: async () => {
      const r = await fetch("/api/v1/product-pack-pcs");
      if (!r.ok) return [];
      const list = (await r.json()) as Array<{ product_id: string; pcs_per_pack: number }>;
      for (const item of list) {
        packPcsCache[item.product_id] = item.pcs_per_pack;
      }
      return list;
    },
    enabled,
    staleTime: 60000,
  });
}
