import type {MowerMap} from '@/hooks/useMowerMap';
import type {MowerParams} from '@/hooks/useMowerParams';
import {mowerPlanAnswer, type PlanRequest} from './areaPlan';
import {loadPlannerSettings} from './mowerBody';
import {closedRings} from './rings';
import {RpcError} from './rpc';
import {saveFile} from './saveFile';
import {APP_VERSION} from './updates';

// One area's plan as a file, to look into a strange plan later and plan it again the same way: what the app asked
// for, the mower's answer as it came (or why there was none), the planner's settings, mower_logic's params and the
// map as saved on the mower.
export async function savePlanCase({
  areaId,
  areaName,
  request,
  viaPlanner,
  map,
  params,
}: {
  areaId: string;
  areaName: string;
  request: PlanRequest;
  viaPlanner: boolean;
  map: MowerMap | null;
  params: MowerParams;
}) {
  const [asked, planner] = await Promise.all([
    mowerPlanAnswer(request, viaPlanner).then(
      (a) => a ?? {error: 'no plan from this mower'},
      (e: unknown) => ({error: e instanceof RpcError ? `${e.method}: ${e.code} ${e.message}` : String(e)}),
    ),
    loadPlannerSettings(true).catch(() => null),
  ]);
  const created = new Date();
  const file = {
    app: APP_VERSION,
    created: created.toISOString(),
    area: {id: areaId, name: areaName},
    request,
    ...asked,
    planner,
    mower_logic: Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith('/mower_logic/'))),
    map: map && closedRings(map),
  };
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}-${pad(created.getHours())}${pad(created.getMinutes())}`;
  const name = areaName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'area';
  await saveFile(`mowbite-plan-${name}-${day}.json`, JSON.stringify(file));
}
