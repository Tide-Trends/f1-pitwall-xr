import { useSessionKey, useWeather } from '../../hooks/useOpenF1';

export function WeatherStrip() {
  const sessionKey = useSessionKey();
  const weather = useWeather(sessionKey);

  if (!weather) return null;

  const raining = weather.rainfall > 0;

  return (
    <div className="weather-strip">
      <div className="ws-item">
        <span className="ws-label">Air</span>
        <span className="ws-value">{weather.air_temperature.toFixed(0)}°</span>
      </div>
      <div className="ws-item">
        <span className="ws-label">Track</span>
        <span className="ws-value">{weather.track_temperature.toFixed(0)}°</span>
      </div>
      <div className="ws-item">
        <span className="ws-label">Wind</span>
        <span className="ws-value">
          {weather.wind_speed.toFixed(1)}
          <em> m/s</em>
        </span>
      </div>
      <div className="ws-item">
        <span className="ws-label">Hum</span>
        <span className="ws-value">{weather.humidity.toFixed(0)}%</span>
      </div>
      <div className={`ws-item${raining ? ' ws-rain' : ''}`}>
        <span className="ws-label">Rain</span>
        <span className="ws-value">{raining ? 'Yes' : 'Dry'}</span>
      </div>
    </div>
  );
}
