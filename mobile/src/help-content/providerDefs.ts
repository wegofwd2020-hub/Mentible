import { PROVIDERS } from "@/constants/providers";
import { COST_LABEL, PROVIDER_GUIDES } from "@/constants/providerGuides";

// One "where to get a key" line per provider, derived from the provider guides
// so the help page can't drift from the in-wizard guidance.
export function providerKeyDefs(): { term: string; def: string }[] {
  return PROVIDERS.flatMap((p) => {
    const g = PROVIDER_GUIDES[p.id];
    if (!g) return [];
    return [
      {
        term: p.label,
        def: `${COST_LABEL[g.cost]}. Get a key at ${g.consoleLabel} (key looks like ${p.keyHint}).`,
      },
    ];
  });
}
