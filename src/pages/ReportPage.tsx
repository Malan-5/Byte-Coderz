import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Coordinates, EmergencyType, Severity } from '../../shared/types';

type ReportChannel = 'text' | 'voice' | 'image';
type SystemStatus = 'checking' | 'connected' | 'offline';

interface SpeechResultLike { 0?: { transcript?: string } }
interface SpeechEventLike { results: ArrayLike<SpeechResultLike> }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SubmissionResult {
  report: { id: string; channel: ReportChannel; location_label: string; location_source: string };
  incident: {
    id: string;
    incident_number: number;
    emergency_type: EmergencyType;
    severity: Severity;
    report_count: number;
    location_label: string;
  };
  cluster_explanation: string;
  dispatch_result: null | {
    status: string;
    dispatch?: { reasoning: string; eta_seconds: number; unit_id: string };
  };
  analysis: {
    location: { label: string; source: string; lat: number | null; lng: number | null };
    entities: { emergency_type: EmergencyType; people_count: number | null; vulnerable_groups: string[] };
    severity: Severity;
    final_score: number;
    llm_status: string;
  };
}

const CHANNELS: { value: ReportChannel; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'voice', label: 'Voice' },
  { value: 'image', label: 'Photo' },
];

function formatType(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function compressImage(file: File): Promise<string> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This image could not be opened. Try another photo.'));
    });

    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.78, 0.62, 0.48]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= 1_400_000) return dataUrl;
    }
    throw new Error('This photo is too large to send. Choose a smaller image.');
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function ReportPage() {
  const [channel, setChannel] = useState<ReportChannel>('text');
  const [description, setDescription] = useState('');
  const [manualLocation, setManualLocation] = useState('');
  const [gps, setGps] = useState<Coordinates | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [locationMessage, setLocationMessage] = useState('');
  const [voiceMessage, setVoiceMessage] = useState('');
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('checking');
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const checkStatus = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch('/api/status', { headers: { Accept: 'application/json' }, signal: controller.signal });
        const status = await response.json() as { ok?: boolean };
        if (active) setSystemStatus(response.ok && status.ok ? 'connected' : 'offline');
      } catch {
        if (active) setSystemStatus('offline');
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void checkStatus();
    const timer = window.setInterval(() => void checkStatus(), 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      speechRef.current?.stop();
    };
  }, []);

  const updateImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setErrorMessage('Choose a photo smaller than 12 MB.');
      return;
    }
    setErrorMessage('');
    setImageName(file.name);
    setImagePreview(URL.createObjectURL(file));
    try {
      setImage(await compressImage(file));
    } catch (error) {
      setImage(null);
      setImagePreview(null);
      setImageName('');
      setErrorMessage(error instanceof Error ? error.message : 'The photo could not be prepared.');
      event.target.value = '';
    }
  };

  const useMyLocation = () => {
    setLocationMessage('');
    if (!navigator.geolocation) {
      setLocationMessage('Location sharing is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocationMessage('Location added. You can still enter a nearby landmark.');
      },
      () => setLocationMessage('Could not access GPS. Enter a Chennai locality or nearby landmark instead.'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const toggleVoice = () => {
    if (isListening) {
      speechRef.current?.stop();
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceMessage('Speech recognition is unavailable here. Type the transcript below.');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((entry) => entry[0]?.transcript ?? '')
        .filter(Boolean)
        .join(' ');
      setDescription(transcript);
    };
    recognition.onerror = () => {
      setIsListening(false);
      setVoiceMessage('Microphone access was not available. Type the transcript below.');
    };
    recognition.onend = () => setIsListening(false);
    speechRef.current = recognition;
    setVoiceMessage('Listening. Speak clearly, then tap Stop listening.');
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceMessage('Could not start the microphone. Type the transcript below.');
    }
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setResult(null);
    if (description.trim().length > 4000 || manualLocation.trim().length > 300) {
      setErrorMessage('Keep the report under 4,000 characters and the location under 300 characters.');
      return;
    }
    if (!description.trim() && !image) {
      setErrorMessage('Describe what is happening or attach a photo.');
      return;
    }
    if (channel === 'image' && !image) {
      setErrorMessage('Add a photo when reporting through the photo channel.');
      return;
    }

    setIsSubmitting(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          channel,
          text: channel === 'voice' ? '' : description.trim(),
          transcript: channel === 'voice' ? description.trim() : '',
          image: image ?? undefined,
          manualLocation: manualLocation.trim(),
          gps,
        }),
      });
      const payload = await response.json() as SubmissionResult & { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? 'Your report could not be sent. Please try again.');
      }
      setResult(payload);
    } catch (error) {
      setErrorMessage(error instanceof DOMException && error.name === 'AbortError'
        ? 'The request took too long. Your report may not have gone through; please try again.'
        : error instanceof Error ? error.message : 'Network issue. Check your connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      setIsSubmitting(false);
    }
  };

  const statusLabel = systemStatus === 'connected' ? 'System online' : systemStatus === 'offline' ? 'Connection unavailable' : 'Checking system';

  return (
    <div className="report-page">
      <header className="site-header">
        <a className="brand" href="/report" aria-label="DisasterMesh report home">
          <span className="brand-mark" aria-hidden="true">D</span>
          <span>DisasterMesh</span>
        </a>
        <div className="network-status" role="status" aria-live="polite">
          <span className={`status-dot status-${systemStatus}`} />
          {statusLabel}
        </div>
        <a className="command-link" href="/command">Dispatcher sign in <span aria-hidden="true">→</span></a>
      </header>

      <main className="report-layout">
        <section className="report-intro" aria-labelledby="report-title">
          <p className="eyebrow"><span>CHENNAI</span> / PUBLIC SAFETY</p>
          <h1 id="report-title">Send a<br /><em>distress report.</em></h1>
          <p className="intro-copy">Tell the response team what is happening and where. Reports are reviewed and grouped with nearby incidents.</p>
          <div className="urgent-note">
            <span className="urgent-symbol" aria-hidden="true">!</span>
            <p><strong>Immediate danger?</strong><br />Call your local emergency number if you can. This form does not replace emergency services.</p>
          </div>
          <div className="privacy-note">
            <span className="privacy-rule" />
            <p>Your report is sent securely to the response system. Location is optional, but helps responders reach you.</p>
          </div>
        </section>

        <section className="form-section" aria-label="Emergency report form">
          <form onSubmit={submitReport}>
            <fieldset className="channel-fieldset">
              <legend>How would you like to report?</legend>
              <div className="channel-switch" role="radiogroup" aria-label="Report method">
                {CHANNELS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={channel === option.value}
                    className={channel === option.value ? 'channel-option selected' : 'channel-option'}
                    onClick={() => { setChannel(option.value); setErrorMessage(''); }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="field-block">
              <label htmlFor="description">What is happening?</label>
              <p className="field-help">Include the emergency, who needs help, and any immediate danger.</p>
              {channel === 'voice' && (
                <div className="voice-controls">
                  <button type="button" className={isListening ? 'voice-button listening' : 'voice-button'} onClick={toggleVoice}>
                    <span className="mic-glyph" aria-hidden="true">{isListening ? '■' : '●'}</span>
                    {isListening ? 'Stop listening' : 'Use microphone'}
                  </button>
                  <span className="voice-hint">Voice transcript or type below</span>
                </div>
              )}
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={4000}
                rows={channel === 'voice' ? 5 : 6}
                placeholder={channel === 'voice'
                  ? 'Your transcript will appear here. You can also type it directly.'
                  : 'Example: Water is rising inside our home. Two people are trapped on the first floor in Velachery.'}
                aria-describedby="description-count"
              />
              <div className="field-meta">
                <span aria-live="polite">{voiceMessage}</span>
                <span id="description-count">{description.length}/4000</span>
              </div>
            </div>

            {channel === 'image' && (
              <div className="field-block image-block">
                <label htmlFor="report-image">Add a photo</label>
                <p className="field-help">Photos are resized before upload. Avoid including sensitive personal details.</p>
                <input
                  ref={fileInputRef}
                  id="report-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => void updateImage(event)}
                />
                {imagePreview && (
                  <div className="image-preview">
                    <img src={imagePreview} alt="Selected emergency scene preview" />
                    <div className="image-preview-info">
                      <span>{imageName}</span>
                      <button type="button" className="text-button" onClick={() => {
                        setImage(null); setImageName(''); setImagePreview(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}>Remove photo</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="field-block location-block">
              <label htmlFor="location">Where is help needed? <span className="optional-label">optional</span></label>
              <p className="field-help">A locality, street, landmark, or GPS location helps responders find you.</p>
              <div className="location-input-row">
                <input
                  id="location"
                  value={manualLocation}
                  onChange={(event) => setManualLocation(event.target.value)}
                  maxLength={300}
                  placeholder="e.g. Velachery, near Vijaya Nagar bus stop"
                />
                <button type="button" className="location-button" onClick={useMyLocation}>Use my location</button>
              </div>
              <div className="field-meta location-feedback" aria-live="polite">
                <span>{gps ? `GPS added · ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : locationMessage}</span>
              </div>
            </div>

            {errorMessage && <div className="form-error" role="alert">{errorMessage}</div>}

            <button className="submit-button" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Sending report…' : 'Send distress report'}</span>
              <span aria-hidden="true">{isSubmitting ? '···' : '→'}</span>
            </button>
            <p className="submit-footnote">No account needed <span>·</span> Do not submit false reports</p>
          </form>

          {result && (
            <section className="result-panel" aria-live="polite" aria-labelledby="result-title">
              <div className="result-heading">
                <span className="result-check" aria-hidden="true">✓</span>
                <div><p className="eyebrow">REPORT RECEIVED</p><h2 id="result-title">Response summary</h2></div>
              </div>
              <div className="result-tags">
                <span className={`severity-badge severity-${result.incident.severity.toLowerCase()}`}>{result.incident.severity}</span>
                <span className="type-badge">{formatType(result.analysis.entities.emergency_type)}</span>
                <span className="incident-number">Incident #{result.incident.incident_number}</span>
              </div>
              <dl className="result-details">
                <div><dt>Location</dt><dd>{result.analysis.location.label || 'Unverified location'}</dd></div>
                <div><dt>Cluster</dt><dd>{result.cluster_explanation}</dd></div>
                <div><dt>Reports grouped</dt><dd>{result.incident.report_count}</dd></div>
                {result.analysis.entities.people_count !== null && (
                  <div><dt>People reported</dt><dd>{result.analysis.entities.people_count}</dd></div>
                )}
                {result.dispatch_result?.dispatch && (
                  <div className="dispatch-detail"><dt>Unit assigned</dt><dd>{result.dispatch_result.dispatch.reasoning}<br /><span>Estimated arrival: {Math.ceil(result.dispatch_result.dispatch.eta_seconds / 60)} min</span></dd></div>
                )}
                {result.dispatch_result && !result.dispatch_result.dispatch && (
                  <div><dt>Dispatch</dt><dd>{result.dispatch_result.status === 'no_compatible_unit'
                    ? 'No compatible unit is available right now.'
                    : result.dispatch_result.status === 'location_unverified'
                      ? 'Location is needed before a unit can be dispatched.'
                      : 'The response team has been notified.'}</dd></div>
                )}
              </dl>
              <p className="result-reassurance">Keep this page open for your incident reference. Dispatchers can see the report in the command center.</p>
            </section>
          )}
        </section>
      </main>

      <footer className="site-footer"><span>DISASTERMESH / PS-05</span><span>Chennai crisis response network</span></footer>
    </div>
  );
}