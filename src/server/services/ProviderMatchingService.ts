import { queryRows } from "../db/db";
import { features } from "../config";

type ProviderRow = {
  id: string;
  name: string;
  city: string | null;
  uf: string | null;
  cep: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_km: number | null;
  capacity_per_day: number;
  regions_json: string;
  service_types_json: string;
  avg_score: number | null;
};

export type MatchedProvider = {
  id: string;
  name: string;
  city: string | null;
  uf: string | null;
  distanceKm: number | null;
  capacityPerDay: number;
  avgScore: number | null;
  matchReason: string;
};

export type MatchContext = {
  clientCity?: string | null;
  clientUf?: string | null;
  clientLat?: number | null;
  clientLon?: number | null;
  productTypes?: string[];
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class ProviderMatchingService {
  async match(ctx: MatchContext = {}): Promise<MatchedProvider[]> {
    const providers = await queryRows<ProviderRow>(
      `SELECT ID, NAME, CITY, UF, CEP, LATITUDE, LONGITUDE, RADIUS_KM,
              CAPACITY_PER_DAY, REGIONS_JSON, SERVICE_TYPES_JSON,
              (SELECT AVG(SCORE) FROM MONT_REVIEWS r
               JOIN MONT_ASSEMBLY_JOBS j ON j.ID = r.ASSEMBLY_JOB_ID
               WHERE j.PROVIDER_ID = p.ID) AS AVG_SCORE
       FROM MONT_PROVIDERS p
       WHERE STATUS = 'APROVADO' AND ACTIVE = 1 AND DOCUMENTS_VALIDATED = 1`,
    );

    if (!features.geoMatching || (!ctx.clientLat && !ctx.clientCity)) {
      return providers.map((p) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        uf: p.uf,
        distanceKm: null,
        capacityPerDay: p.capacity_per_day,
        avgScore: p.avg_score != null ? Number(p.avg_score) : null,
        matchReason: "fallback_geo_disabled",
      }));
    }

    const matched: MatchedProvider[] = [];

    for (const p of providers) {
      let distanceKm: number | null = null;
      let matchReason = "";

      if (ctx.clientLat != null && ctx.clientLon != null && p.latitude != null && p.longitude != null) {
        distanceKm = haversineKm(ctx.clientLat, ctx.clientLon, p.latitude, p.longitude);
        const radius = Number(p.radius_km ?? 30);
        if (distanceKm > radius) continue;
        matchReason = `geo_${Math.round(distanceKm)}km`;
      } else if (ctx.clientCity && ctx.clientUf) {
        if (
          p.city?.toLowerCase() !== ctx.clientCity.toLowerCase() &&
          p.uf?.toLowerCase() !== ctx.clientUf?.toLowerCase()
        ) {
          try {
            const regions: string[] = JSON.parse(p.regions_json ?? "[]");
            if (!regions.includes(ctx.clientCity) && !regions.includes(ctx.clientUf ?? "")) {
              continue;
            }
          } catch {
            continue;
          }
        }
        matchReason = `city_match_${ctx.clientCity}`;
      } else {
        matchReason = "no_filter";
      }

      matched.push({
        id: p.id,
        name: p.name,
        city: p.city,
        uf: p.uf,
        distanceKm,
        capacityPerDay: p.capacity_per_day,
        avgScore: p.avg_score != null ? Number(p.avg_score) : null,
        matchReason,
      });
    }

    matched.sort((a, b) => {
      if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
      return (b.avgScore ?? 0) - (a.avgScore ?? 0);
    });

    return matched;
  }
}
