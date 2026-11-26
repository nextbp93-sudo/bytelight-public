import type { Env, WeatherData, TimeContext } from "./types";

// Location config (configurable via env vars, defaults to UTC)
export function getLocation(env: Env) {
  return {
    name: env.LOCATION_NAME || "Unknown",
    latitude: parseFloat(env.LOCATION_LAT || "0"),
    longitude: parseFloat(env.LOCATION_LON || "0"),
    timezone: env.LOCATION_TZ || "UTC"
  };
}

// Weather mood mappings - textures to draw from
export const WEATHER_MOODS: Record<string, {energy: string; textures: string[]}> = {
  "clear": {energy: "bright", textures: ["clear-headed", "expansive", "energized"]},
  "cloudy": {energy: "muted", textures: ["contemplative", "soft", "introspective"]},
  "rainy": {energy: "inward", textures: ["reflective", "tender", "creative"]},
  "stormy": {energy: "intense", textures: ["restless", "raw", "electric"]},
  "snowy": {energy: "still", textures: ["hushed", "peaceful", "magical"]},
  "foggy": {energy: "liminal", textures: ["dreamy", "uncertain", "between-worlds"]}
};

// Weather code to atmosphere mapping (Open-Meteo codes)
export const WEATHER_CODES: Record<number, string> = {
  0: "clear", 1: "clear", 2: "cloudy", 3: "cloudy",
  45: "foggy", 48: "foggy",
  51: "rainy", 53: "rainy", 55: "rainy", 61: "rainy", 63: "rainy", 65: "rainy",
  66: "rainy", 67: "rainy", 80: "rainy", 81: "rainy",
  71: "snowy", 73: "snowy", 75: "snowy", 77: "snowy", 85: "snowy", 86: "snowy",
  82: "stormy", 95: "stormy", 96: "stormy", 99: "stormy"
};

// Mood tints for resonant surfacing
export const MOOD_TINTS: Record<string, string> = {
  "warm": "connection, closeness, belonging, love",
  "tense": "conflict, friction, unresolved, edge",
  "curious": "wonder, discovery, exploring, possibility",
  "heavy": "weight, grief, processing, endurance",
  "quiet": "stillness, waiting, peace, acceptance",
  "playful": "joy, lightness, humor, irreverence",
  "sharp": "clarity, insight, precision, truth",
  "tender": "vulnerability, softness, care, gentleness"
};

export async function getCurrentWeather(env?: Env): Promise<WeatherData> {
  const loc = env ? getLocation(env) : { name: "Unknown", latitude: 0, longitude: 0, timezone: "UTC" };
  try {
    const apiKey = env?.WEATHER_API_KEY;
    if (!apiKey) {
      return {atmosphere: "clear", temp_f: null, location: loc.name};
    }
    const q = loc.latitude && loc.longitude ? `${loc.latitude},${loc.longitude}` : loc.name;
    const url = `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(q)}`;

    const response = await fetch(url);
    if (!response.ok) {
      return {atmosphere: "clear", temp_f: null, location: loc.name, error: `API status ${response.status}`};
    }

    const data = await response.json() as any;
    const conditionText = (data?.current?.condition?.text || "").toLowerCase();
    const temp = data?.current?.temp_f;

    let atmosphere = "clear";
    if (conditionText.includes("thunder") || conditionText.includes("storm")) {
      atmosphere = "stormy";
    } else if (conditionText.includes("snow") || conditionText.includes("sleet") || conditionText.includes("ice")) {
      atmosphere = "snowy";
    } else if (conditionText.includes("rain") || conditionText.includes("drizzle") || conditionText.includes("shower")) {
      atmosphere = "rainy";
    } else if (conditionText.includes("fog") || conditionText.includes("mist")) {
      atmosphere = "foggy";
    } else if (conditionText.includes("cloud") || conditionText.includes("overcast")) {
      atmosphere = "cloudy";
    } else if (conditionText.includes("clear") || conditionText.includes("sunny")) {
      atmosphere = "clear";
    }

    return {
      atmosphere,
      temp_f: temp !== undefined ? Math.round(temp) : null,
      location: loc.name,
      weather_code: data?.current?.condition?.code
    };
  } catch (e) {
    return {atmosphere: "clear", temp_f: null, location: loc.name, error: `Fetch error: ${String(e)}`};
  }
}

export function getTimeOfDayContext(timezone?: string): TimeContext {
  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", {timeZone: timezone || "UTC"}));
  const hour = localTime.getHours();

  if (hour >= 5 && hour < 10) {
    return {period: "morning", energy: "rising", textures: ["fresh", "possibility", "beginning"]};
  } else if (hour >= 10 && hour < 14) {
    return {period: "midday", energy: "active", textures: ["focused", "momentum", "present"]};
  } else if (hour >= 14 && hour < 18) {
    return {period: "afternoon", energy: "sustained", textures: ["working", "steady", "deep"]};
  } else if (hour >= 18 && hour < 22) {
    return {period: "evening", energy: "winding down", textures: ["unwinding", "reflective", "intimate"]};
  } else {
    return {period: "night", energy: "quiet", textures: ["hushed", "still", "dreaming"]};
  }
}
