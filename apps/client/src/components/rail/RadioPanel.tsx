import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useSessionKey, useTeamRadio, type OpenF1Radio } from '../../hooks/useOpenF1';
import { pitwallApi } from '../../lib/api';

export function RadioPanel() {
  const sessionKey = useSessionKey();
  const clips = useTeamRadio(sessionKey);
  const timing = useAppStore((s) => s.telemetry?.timing ?? []);
  const [filter, setFilter] = useState<number | ''>('');
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const tlaOf = (num: number) => timing.find((t) => t.racingNumber === num)?.tla ?? `#${num}`;

  const drivers = useMemo(() => {
    const nums = Array.from(new Set(clips.map((c) => c.driver_number)));
    return nums.sort((a, b) => a - b);
  }, [clips]);

  const filtered = useMemo(() => {
    const list = filter === '' ? clips : clips.filter((c) => c.driver_number === filter);
    return [...list].reverse().slice(0, 60);
  }, [clips, filter]);

  const play = (clip: OpenF1Radio) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (playingUrl === clip.recording_url) {
      setPlayingUrl(null);
      return;
    }
    const audio = new Audio(clip.recording_url);
    audioRef.current = audio;
    audio.play().catch(() => setPlayingUrl(null));
    audio.onended = () => setPlayingUrl(null);
    setPlayingUrl(clip.recording_url);
  };

  const transcribe = async (clip: OpenF1Radio) => {
    setTranscribing(clip.recording_url);
    try {
      const { text } = await pitwallApi.transcribe(clip.recording_url);
      setTranscripts((t) => ({ ...t, [clip.recording_url]: text || '(no speech detected)' }));
    } catch (err) {
      const msg = String(err);
      setTranscripts((t) => ({
        ...t,
        [clip.recording_url]: msg.includes('Whisper not installed')
          ? 'Install Whisper for transcripts: brew install whisper-cpp'
          : `Transcription failed: ${msg.slice(0, 80)}`,
      }));
    } finally {
      setTranscribing(null);
    }
  };

  if (!sessionKey) {
    return (
      <div className="rail-empty">
        <span className="rail-empty-icon">▤</span>
        <p>Team radio is available for replay sessions matched to OpenF1.</p>
      </div>
    );
  }

  if (clips.length === 0) {
    return <div className="rail-empty"><p>No radio clips found for this session yet.</p></div>;
  }

  return (
    <div className="radio-panel">
      <select
        className="radio-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">All drivers</option>
        {drivers.map((num) => (
          <option key={num} value={num}>{tlaOf(num)}</option>
        ))}
      </select>

      <div className="radio-list">
        {filtered.map((clip) => {
          const playing = playingUrl === clip.recording_url;
          const transcript = transcripts[clip.recording_url];
          return (
            <div key={clip.recording_url} className={`radio-clip${playing ? ' playing' : ''}`}>
              <button type="button" className="radio-play" onClick={() => play(clip)}>
                {playing ? '◼' : '▶'}
              </button>
              <div className="radio-meta">
                <strong>{tlaOf(clip.driver_number)}</strong>
                <span>{new Date(clip.date).toLocaleTimeString()}</span>
                {transcript && <p className="radio-transcript">{transcript}</p>}
              </div>
              {!transcript && (
                <button
                  type="button"
                  className="radio-transcribe"
                  disabled={transcribing === clip.recording_url}
                  onClick={() => transcribe(clip)}
                  title="Transcribe with local Whisper"
                >
                  {transcribing === clip.recording_url ? '…' : 'Aa'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
