import {fromBase64} from '../base64';
import {OBSTACLE_MODES, RPC, TOPIC} from '../openmower';
import {sha256Js} from '../sha256';

// What the obstacle sensors of a mower with MowBite OS saw, for the click tests (vision.obstacles.*), like MowBite OS
// answers it. The demo is an OpenMower and has none, a test switches them on before the page loads
// (window.mowbiteDemoObstacles). Two entries have a small photo of the garden, the person was seen with photos off.
// The platform can stop for them, not drive around yet

// a hedgehog and a ball on the lawn, 160 x 120
const PHOTOS: Record<string, Uint8Array> = {
  hedgehog: fromBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCAB4AKADASIAAhEBAxEB/8QAGgABAAIDAQAAAAAAAAAAAAAAAAIDBAUGAf/EADAQAAIBAgEMAQMEAwAAAAAAAAABAgMRIQQSFBYyUVJkcaGj4TFBYZEFEyKBQlOS/8QAGQEBAAMBAQAAAAAAAAAAAAAAAAECAwQF/8QAHxEBAAMAAwADAQEAAAAAAAAAAAECEhETUQMhMQRB/9oADAMBAAIRAxEAPwDpAAdjiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABzmtPJ+X0NaeT8vo5sHB3X9aZh0mtPJ+X0NaeT8vo5sDuv6Zh0mtPJ+X0NaeT8vo5sDuv6Zh0mtPJ+X0NaeT8vo5sDuv6Zh0mtPJ+X0NaeT8vo5sDuv6Zh0mtPJ+X0NaeT8vo5sDuv6Zh0mtPJ+X0NaeT8vo5sDuv6Zh0mtPJ+X0NaeT8vo5sDuv6Zh0mtPJ+X0NaeT8vo5sDuv6Zh0mtPJ+X0NaeT8vo5sDuv6Zhfotbg7oaLW4O6NmDm1KupazRa3B3Q0Svwd0bMlFWTlu+BqTUtU8krp2zO6Gi1uDujZgak1LWaLW4O6Gi1uDujZkoLFvdiNSalqnkldO2Z3Q0Wtwd0bMDUmpazRa3B3Q0Wtwd0bMlTV5oak1LVPJK6dszuhotbg7o2bd22BqTUtZotbg7oaLW4O6Nmexxkl9xqTUtW8krp2zO6Gi1uDujaS2n1PBqTUtZotbg7oaLW4O6NmBqTUgAKqvUruyJVMLRXwiUFmxcmVN3bYAAACxrNpW+rIwV5I9qu8rbgIAEJVacb3msPuExEz+JllPCMpGLpNLj7MyI1abpJRnFtr4viTwma2j9hEAEKhKntoiWUtpv7AQltPqeEqm2yIAAACUI50vsRL4RzY2AjVlhbeVHsnnSbPAAB7FZ0kgLacbRvvKZyV5SbwWJfJ2gzErxc6MkvkQmscz9sOtlEqjaTcY7ikA24elWsVjiAABLMySdabtZzjv3f2ZTTXyWwUYwShbNthY1mU1svX6rCnCm3k2GObhb6tv6P5/CKccsPl+GvGoZxbRWDZUXUl/DqUcSuptsiSqbbIgAABZSjd3f9EqjtHqTSsrIpqO8ugEAAALaSwvvK0rtIyFgrAV1XglvKidR3n0IAY9bJo1G5RebJ/hmNLJ6sb/xuluNiErtItFphtX5rV+mt/Yq/wCqf/LJrJa11eObfHFm4WCsU1XefQalaf6Lf5CqhF0YZuc5L7/Qm5N/J4COWU/JafqZDIjsroY5kkKKKm2yJOrtLoQAAADIk82LZjgAAABZSj/l+C0ADGbu2wAAJ0led9wAFxRN3mwAIgAD2CvNGQABTV2l0IAAAAB//9k='),
  ball: fromBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCAB4AKADASIAAhEBAxEB/8QAGwABAAMBAQEBAAAAAAAAAAAAAAIDBgUEAQf/xAAzEAACAQIBCgYBBAIDAAAAAAAAAQIDEQUEEhQWIVJkoaPhEzEyQVFxYQYigcGR8AdC0f/EABgBAQADAQAAAAAAAAAAAAAAAAABAgQD/8QAHREBAQACAgMBAAAAAAAAAAAAAAECEhNRAxEhMf/aAAwDAQACEQMRAD8A0gANjEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADOa08H1ew1p4Pq9jNgwc2fbprGk1p4Pq9hrTwfV7GbA5s+zWNJrTwfV7DWng+r2M2BzZ9msaTWng+r2GtPB9XsZsDmz7NY0mtPB9XsNaeD6vYzYHNn2axpNaeD6vYa08H1exmwObPs1jSa08H1ew1p4Pq9jNgc2fZrGk1p4Pq9hrTwfV7GbA5s+zWNJrTwfV7DWng+r2M2BzZ9msaTWng+r2GtPB9XsZsDmz7NYv0Wtuc0NFrbnNHTBm2qu1czRa25zQ0Svuc0dMlFWTl8eQ2ptXKeSV07ZnNDRa25zR0wNqbVzNFrbnNDRa25zR0yUFtb+No2ptXKeSV07ZnNDRa25zR0wNqbVzNFrbnNDRa25zR0yVNXmhtTauU8krp2zOaGi1tzmjpt3bYG1Nq5mi1tzmhotbc5o6Z9jtkl+RtTauW8krp2zOaGi1tzmjqS9T+z4NqbVzNFrbnNDRa25zR0wNqbUABVV9Su7IlU2WivJEoLNi5Mqbu2wAAAFjWbSt7sjBXkj7Vd5W+AIAHcwjAHldHx8qc6dOS/Yo7JP87fb/AH7mY3K+omS35HDLKeyMpGylgGGyi0qDi2rXU5XX+WcPF8Ilh9N1KLlOg9jb84v8/wDv+u+XjsntbLx2T24oAOagSp+tESyl6m/wBCXqf2fCVT1siAAAAlCOdL8ES+Ec2NgI1ZbLfJUfZPOk2fAAB9is6SQFtONo3+SqTvJsuk7QZQB7MIoRynFMnpStmuWc01dNJXt/NrGo/UeKzwbCamV06Eq07qEVb9sW/Jy/H9tL3uZXDMpWSYjQrNpRjK0m1eyex8mbbLMmoYlkFXJ6tp0a8LXVnsfk17X90zR4fxo8X4/LKP6rxWli1XEPFjOdVZsqUk/DzfZWvstfZ7+fy7/qGGZXHFMKo5TKhKlGvC7pVF7eX8p+z900YSh/x/iGkU9IyjJfBzl4nhzlnZt9trxtex+hTlQyPJryzKNClGySVlFLySX9HZ1fn+U0vAymrRzs7w5uF7WvZ2KyderKvXqVZJKVSTk0vK7dyBiYwtorY2VF1Jfs+yEK6nrZElU9bIgAABZSjd3f8EqjtH7JpWVkU1HeX0BAAAC2ktl/krSu0j0LYrAV1XsS+SonUd5/RAAdTCsaq4fCVKUPGo+cYuVs1/h/H4OWErtImWz7Ey2fY17/AFHkrg3GlWcrbE0l/ZwsYxOriFSKa8OlHaoJ32/L+TzLYrFNV3n9FrnlflWudvyoAAooHoj6V9HnPSBRU9bIk6vqX0QAAAD0SebFs84AAAAWUo/9v8FoAHmbu2wAAJ0led/gAC4om7zYAEQAB9grzR6AAKavqX0QAAAAD//Z'),
};
const photo = (name: string, box: {x: number; y: number; w: number; h: number}) => ({
  name,
  sha256: sha256Js(PHOTOS[name]),
  bytes: PHOTOS[name].length,
  width: 160,
  height: 120,
  box,
});
const PIECE = 65536;
const MODE_MAX = 'stop';
const invalid = (field: string, message: string) => Object.assign(new Error(message), {code: -32602, data: {field, reason: 'INVALID'}});

// now: the demo's clock in unix s. param: obstacle_mode and obstacle_photos as params.set has them
export function demoObstacles(deliver: (topic: string, text: string) => void, now: () => number, param: (name: string) => number) {
  const t = now();
  const list = [
    {id: 3, t: t - 600, last_t: t - 300, count: 2, x: 6.5, y: 1.6, r: 0.15, kind: 'ANIMAL', class: 'hedgehog', confidence: 0.82, camera_id: 'stereo', action: 'would_stop', image: photo('hedgehog', {x: 60, y: 76, w: 52, h: 28})},
    {id: 2, t: t - 7200, last_t: t - 7200, count: 1, x: 6.2, y: 11, r: 0.12, kind: 'OBJECT', class: 'sports ball', confidence: 0.91, camera_id: 'stereo', action: 'seen', image: photo('ball', {x: 68, y: 72, w: 30, h: 30})},
    {id: 1, t: t - 86400, last_t: t - 86000, count: 4, x: 4.5, y: 6.6, r: 0.3, kind: 'PERSON', class: 'person', confidence: 0.95, camera_id: 'stereo', action: 'seen', image: null},
  ];
  let n = 0;
  const cleared = (obstacle_id: number | null) =>
    deliver(TOPIC.events, JSON.stringify({id: `seen${++n}`, t: now(), type: 'OBSTACLES_CLEARED', obstacle_id, severity: 'info', resume: 'auto'}));
  return {
    // what mower_logic has of them, at first on the map with photos
    params: {'/mower_logic/obstacle_mode': 1, '/mower_logic/obstacle_photos': 1},
    methods: {
      [RPC.obstaclesList]: (p: unknown) => {
        const since = (p as {since?: number})?.since;
        return {
          mode: OBSTACLE_MODES[Math.min(param('obstacle_mode'), OBSTACLE_MODES.indexOf(MODE_MAX))] ?? 'off',
          mode_max: MODE_MAX,
          photos: !!param('obstacle_photos'),
          sight: {ok: true, reason: null},
          limit: {entries: 200, bytes: 20971520, days: 14},
          obstacles: list.filter((o) => since === undefined || o.last_t > since),
        };
      },
      [RPC.obstaclesImage]: (p: unknown) => {
        const {name, offset = 0, size = PIECE} = (p ?? {}) as {name?: string; offset?: number; size?: number};
        const bytes = name && list.some((o) => o.image?.name === name) ? PHOTOS[name] : undefined;
        if (!bytes) throw invalid('name', 'no such image');
        const piece = bytes.subarray(offset, offset + Math.min(size, PIECE));
        return {size: bytes.length, offset, data: btoa(String.fromCharCode(...piece)), sha256: sha256Js(bytes), type: 'image/jpeg'};
      },
      [RPC.obstaclesClear]: (p: unknown) => {
        const id = (p as {id?: number})?.id;
        if (id !== undefined && !list.some((o) => o.id === id)) throw invalid('id', 'no such entry');
        const removed = id === undefined ? list.length : 1;
        list.splice(0, list.length, ...list.filter((o) => id !== undefined && o.id !== id));
        cleared(id ?? null);
        return {removed};
      },
    } as Record<string, (params: unknown) => unknown>,
  };
}
