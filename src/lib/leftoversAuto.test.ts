import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {PlannerSetting} from './mowerBody';
import type {Settings} from './settings';

const saved = vi.hoisted(() => ({planner: [] as unknown[], settings: [] as unknown[], now: {} as Record<string, unknown>}));
vi.mock('./mowerBody', () => ({savePlannerSettings: async (v: unknown) => saved.planner.push(v)}));
vi.mock('./settings', () => ({
  settingsStore: {snapshot: () => saved.now},
  saveSettings: (s: unknown) => saved.settings.push(s),
}));
vi.mock('./rpc', () => ({rpcMethods: async () => null, callRpc: async () => null}));

const {leftoversOn, setLeftoversAuto} = await import('./leftovers');

const setting = (value: boolean, settable = true) => ({value, settable}) as PlannerSetting;
const container = (auto: boolean) => ({leftovers: {auto}}) as Settings;

describe('the leftovers switch with a planner', () => {
  beforeEach(() => {
    saved.planner = [];
    saved.settings = [];
  });

  it("is on with the planner's or the container's own switched on before", () => {
    expect(leftoversOn(setting(true), container(false))).toBe(true);
    expect(leftoversOn(setting(false), container(true))).toBe(true);
    expect(leftoversOn(setting(false), container(false))).toBe(false);
    // the planner decides it alone
    expect(leftoversOn(setting(false, false), container(true))).toBe(false);
  });

  it("switches the planner's and takes the container's own off", async () => {
    saved.now = {leftovers: {auto: true, min: 2}};
    await setLeftoversAuto(true);
    expect(saved.planner).toEqual([{leftovers_auto: true}]);
    expect(saved.settings).toEqual([{leftovers: {auto: false, min: 2}}]);
  });

  it("leaves the container's alone when it's off", async () => {
    saved.now = {leftovers: {auto: false}};
    await setLeftoversAuto(false);
    expect(saved.planner).toEqual([{leftovers_auto: false}]);
    expect(saved.settings).toEqual([]);
  });
});
