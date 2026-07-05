// Simulated weather-API payload. In production this file is the ONLY thing that changes:
// a cron job fetches the real feed, writes this shape, and re-renders the same template —
// vsim's determinism guarantees the video is exactly "template + this data", nothing else.
export interface CityWeather {
  city: string;
  condition: "clear" | "cloudy" | "rain" | "snow";
  /** Temperatures in °C. */
  temp: number;
  hi: number;
  lo: number;
  /** Wind speed in km/h. */
  wind: number;
}

export const FORECAST: CityWeather[] = [
  { city: "TOKYO", condition: "clear", temp: 29, hi: 32, lo: 24, wind: 9 },
  { city: "LONDON", condition: "rain", temp: 14, hi: 17, lo: 11, wind: 26 },
  { city: "DENVER", condition: "snow", temp: -3, hi: 1, lo: -8, wind: 18 },
  { city: "MUMBAI", condition: "cloudy", temp: 31, hi: 33, lo: 27, wind: 14 },
];
