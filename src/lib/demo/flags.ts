// What a click test sets on window before the page loads or while it runs: MowBite OS's parts the demo has behind a
// switch (window.mowbiteDemoLights and so on) and the reason for the next refusal

type Flags = Record<string, unknown>;
export const demoFlags = (): Flags => (typeof window === 'undefined' ? {} : (window as unknown as Flags));
export const demoOn = (part: 'Lights' | 'Sounds' | 'Cameras' | 'Undo') => !!demoFlags()[`mowbiteDemo${part}`];
