import { useEffect, useRef, useState, type FormEvent } from 'react';
import { divIcon } from 'leaflet';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './command.css';
import { recommendUnits, type UnitRecommendation } from '../../shared/dispatch';
import type { Dispatch, Incident, Report, Severity, SeverityReasoning, Unit, UnitStatus, UnitType } from '../../shared/types';

type AuthStatus = 'checking' | 'login' | 'authenticated' | 'unavailable';
type ConnectionStatus = 'connecting' | 'live' | 'stale' | 'offline';
type PanelMode = 'incidents' | 'units';

interface CommandSnapshot {
  ok: true;
  server_time: string;
  counters: { open: number; critical: number; available: number; en_route: number };
  incidents: Incident[];
  reports: Report[];
  units: Unit[];
  dispatches: Dispatch[];
  recommendations: Record<string, UnitRecommendation[]>;
}

interface ApiPayload { ok?: boolean; authenticated?: boolean; error?: { message?: string }; result?: { status?: string } }

class ApiFailure extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  let payload: ApiPayload;
  try { payload = await response.json() as ApiPayload; }
  catch { payload = {}; }
  if (!response.ok) throw new ApiFailure(payload.error?.message ?? `Request failed (${response.status})`, response.status);
  return payload as T;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  Critical: '#ba3328', High: '#dc7b26', Medium: '#c6a632', Low: '#398265',
};
const UNIT_GLYPH: Record<UnitType, string> = {
  ambulance: 'A', fire_engine: 'F', rescue_boat: 'B', ndrf_team: 'N', general_rescue: 'R',
};
const UNIT_LABEL: Record<UnitType, string> = {
  ambulance: 'Ambulance', fire_engine: 'Fire engine', rescue_boat: 'Rescue boat', ndrf_team: 'NDRF team', general_rescue: 'General rescue',
};
const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  available: 'Available', en_route: 'En route', on_scene: 'On scene', returning: 'Returning',
};
const CHENNAI_CENTER: [number, number] = [13.0827, 80.2707];

function unitIcon(unit: Unit) {
  return divIcon({
    className: 'unit-marker-shell',
    html: `<span class="unit-marker unit-marker-${unit.status}" title="${UNIT_LABEL[unit.unit_type]} · ${UNIT_STATUS_LABEL[unit.status]}">${UNIT_GLYPH[unit.unit_type]}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function MapFocus({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 13), { duration: 0.45 });
  }, [map, target?.[0], target?.[1]]);
  return null;
}

function formatAge(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function formatType(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getReportText(report: Report): string {
  return report.raw_text.trim() || report.image_description?.trim() || 'Photo report with no written description.';
}

export default function CommandPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [snapshot, setSnapshot] = useState<CommandSnapshot | null>(null);
  const [passcode, setPasscode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [pageError, setPageError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('incidents');
  const [freshIncidentIds, setFreshIncidentIds] = useState<Set<string>>(() => new Set());
  const [resetPrompt, setResetPrompt] = useState(false);
  const [resolvePrompt, setResolvePrompt] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const previousIncidentIds = useRef<Set<string> | null>(null);

  const applySnapshot = (next: CommandSnapshot) => {
    const incomingIds = new Set(next.incidents.map((incident) => incident.id));
    const previousIds = previousIncidentIds.current;
    if (previousIds) {
      const arrivals = next.incidents.filter((incident) => !previousIds.has(incident.id)).map((incident) => incident.id);
      if (arrivals.length) {
        setFreshIncidentIds((current) => new Set([...current, ...arrivals]));
        window.setTimeout(() => setFreshIncidentIds((current) => {
          const remaining = new Set(current);
          arrivals.forEach((id) => remaining.delete(id));
          return remaining;
        }), 25_000);
      }
    }
    previousIncidentIds.current = incomingIds;
    setSnapshot(next);
    setSelectedIncidentId((current) => current && incomingIds.has(current) ? current : next.incidents[0]?.id ?? null);
    setConnectionStatus('live');
    setLastUpdated(Date.now());
    setPageError('');
  };

  useEffect(() => {
    let active = true;
    void requestJson<CommandSnapshot>('/api/state').then(() => {
      if (active) setAuthStatus('authenticated');
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof ApiFailure && error.status === 401) setAuthStatus('login');
      else {
        setPageError(error instanceof Error ? error.message : 'Could not connect to the command API.');
        setAuthStatus('unavailable');
        setConnectionStatus('offline');
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let active = true;
    let inFlight = false;

    const pollAndAdvance = async () => {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        try {
          await requestJson<ApiPayload>('/api/tick', { method: 'POST' });
        } catch (error) {
          if (error instanceof ApiFailure && error.status === 401) {
            setSnapshot(null);
            setAuthStatus('login');
            return;
          }
          if (active) setActionMessage(error instanceof Error ? `Simulation tick: ${error.message}` : 'Simulation tick failed.');
        }
        const next = await requestJson<CommandSnapshot>('/api/state');
        if (active) applySnapshot(next);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) {
          setSnapshot(null);
          setAuthStatus('login');
        } else if (active) {
          setConnectionStatus(snapshot ? 'stale' : 'offline');
          setPageError(error instanceof Error ? error.message : 'Live data is temporarily unavailable.');
        }
      } finally {
        inFlight = false;
      }
    };

    void pollAndAdvance();
    const timer = window.setInterval(() => void pollAndAdvance(), 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authStatus]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError('');
    try {
      await requestJson<ApiPayload>('/api/login', { method: 'POST', body: JSON.stringify({ passcode }) });
      setPasscode('');
      setAuthStatus('authenticated');
    } catch (error) {
      setPasscode('');
      setLoginError(error instanceof Error ? error.message : 'Login failed. Try again.');
    }
  };

  const refreshNow = async () => {
    try { applySnapshot(await requestJson<CommandSnapshot>('/api/state')); }
    catch (error) {
      setConnectionStatus('stale');
      setPageError(error instanceof Error ? error.message : 'Could not refresh live data.');
    }
  };

  const performAction = async (path: string, body?: object, label = 'action') => {
    setActionBusy(label);
    setActionMessage('');
    try {
      const response = await requestJson<ApiPayload>(path, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const status = response.result?.status;
      const messages: Record<string, string> = {
        dispatched: 'Unit dispatched. Live unit tracking is active.',
        already_assigned: 'This incident already has an active unit.',
        no_compatible_unit: 'No compatible available unit was found.',
        location_unverified: 'This incident needs a verified location before dispatch.',
        incident_resolved: 'This incident is already resolved.',
        resolved: 'Incident resolved. Assigned units are returning to station.',
        already_resolved: 'This incident was already resolved.',
      };
      setActionMessage(status ? messages[status] ?? `Action complete: ${status}.` : 'Action complete.');
      await refreshNow();
      setResetPrompt(false);
      setResolvePrompt(false);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'The action could not be completed.');
    } finally {
      setActionBusy('');
    }
  };

  const handleLogout = async () => {
    try { await requestJson<ApiPayload>('/api/logout', { method: 'POST' }); }
    finally {
      setSnapshot(null);
      setAuthStatus('login');
      previousIncidentIds.current = null;
      setFreshIncidentIds(new Set());
    }
  };

  const selectedIncident = snapshot?.incidents.find((incident) => incident.id === selectedIncidentId) ?? null;
  const selectedReports = selectedIncident && snapshot
    ? snapshot.reports.filter((report) => report.incident_id === selectedIncident.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    : [];
  const selectedDispatch = selectedIncident && snapshot
    ? snapshot.dispatches.find((dispatch) => dispatch.incident_id === selectedIncident.id && ['en_route', 'on_scene'].includes(dispatch.status))
    : undefined;
  const selectedRecommendations = selectedIncident && snapshot
    ? snapshot.recommendations[selectedIncident.id] ?? recommendUnits(selectedIncident, snapshot.units).slice(0, 3)
    : [];
  const selectedTarget: [number, number] | null = selectedIncident?.lat !== null && selectedIncident?.lat !== undefined && selectedIncident.lng !== null
    ? [selectedIncident.lat, selectedIncident.lng]
    : null;
  const selectedReasoning = selectedReports[0]?.reasoning as Partial<SeverityReasoning> | undefined;
  const activeUnit = selectedDispatch && snapshot ? snapshot.units.find((unit) => unit.id === selectedDispatch.unit_id) : undefined;

  if (authStatus === 'checking') {
    return <div className="command-state"><span className="command-spinner" />Checking dispatcher session…</div>;
  }

  if (authStatus === 'unavailable') {
    return (
      <main className="command-login-page">
        <a className="command-brand" href="/report"><span className="brand-mark">D</span> DisasterMesh</a>
        <section className="login-panel">
          <p className="command-eyebrow">DISPATCHER ACCESS</p>
          <h1>Command center unavailable</h1>
          <p>{pageError || 'The command API could not be reached.'}</p>
          <button className="login-submit" type="button" onClick={() => window.location.reload()}>Try again</button>
        </section>
      </main>
    );
  }

  if (authStatus === 'login') {
    return (
      <main className="command-login-page">
        <header className="command-login-header">
          <a className="command-brand" href="/report"><span className="brand-mark">D</span> DisasterMesh</a>
          <a className="citizen-link" href="/report">Citizen report <span aria-hidden="true">→</span></a>
        </header>
        <section className="login-panel" aria-labelledby="login-title">
          <p className="command-eyebrow">CHENNAI / DISPATCHER ACCESS</p>
          <h1 id="login-title">Command center</h1>
          <p className="login-copy">Sign in with the dispatcher passcode to view incidents and coordinate response units.</p>
          <form onSubmit={handleLogin}>
            <label htmlFor="dispatcher-passcode">Dispatcher passcode</label>
            <input id="dispatcher-passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} autoComplete="current-password" required maxLength={256} />
            {loginError && <p className="login-error" role="alert">{loginError}</p>}
            <button className="login-submit" type="submit">Sign in <span aria-hidden="true">→</span></button>
          </form>
          <p className="login-security">Protected session · passcode stays on this device</p>
        </section>
      </main>
    );
  }

  return (
    <main className="command-page">
      <header className="command-topbar">
        <a className="command-brand" href="/report"><span className="brand-mark">D</span><span>DisasterMesh</span><span className="command-product-label">COMMAND</span></a>
        <div className="command-counters" aria-label="Current response counters">
          <div><span className="counter-value">{snapshot?.counters.open ?? '—'}</span><span className="counter-label">Open</span></div>
          <div><span className="counter-value counter-critical">{snapshot?.counters.critical ?? '—'}</span><span className="counter-label">Critical</span></div>
          <div><span className="counter-value counter-available">{snapshot?.counters.available ?? '—'}</span><span className="counter-label">Available</span></div>
          <div><span className="counter-value counter-route">{snapshot?.counters.en_route ?? '—'}</span><span className="counter-label">En route</span></div>
        </div>
        <div className="command-tools">
          <span className={`command-connection command-connection-${connectionStatus}`}><i />{connectionStatus === 'live' ? 'LIVE' : connectionStatus.toUpperCase()}</span>
          <button className="tool-button" type="button" title="Refresh incident and unit state" onClick={() => void refreshNow()}>Refresh</button>
          <button className="tool-button reset-button" type="button" onClick={() => setResetPrompt((current) => !current)}>Reset demo</button>
          <button className="tool-button logout-button" type="button" onClick={() => void handleLogout()}>Sign out</button>
        </div>
      </header>

      {resetPrompt && (
        <div className="command-confirm-bar" role="alert">
          <span>Reset the demo incidents and units to the seeded scenario?</span>
          <button type="button" disabled={Boolean(actionBusy)} onClick={() => void performAction('/api/seed', undefined, 'reset')}>{actionBusy === 'reset' ? 'Resetting…' : 'Confirm reset'}</button>
          <button type="button" className="quiet-button" onClick={() => setResetPrompt(false)}>Cancel</button>
        </div>
      )}
      {(pageError || actionMessage) && (
        <div className={pageError ? 'command-alert command-alert-error' : 'command-alert'} role="status">
          <span>{pageError || actionMessage}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => { setPageError(''); setActionMessage(''); }}>×</button>
        </div>
      )}

      <div className="command-workspace">
        <aside className="triage-panel">
          <div className="panel-heading">
            <div><p className="command-eyebrow">RESPONSE DESK</p><h1>Live operations</h1></div>
            {lastUpdated && <span className="update-time">Updated {formatAge(new Date(lastUpdated).toISOString())}</span>}
          </div>
          <div className="panel-tabs" role="tablist" aria-label="Dispatcher lists">
            <button type="button" role="tab" aria-selected={panelMode === 'incidents'} className={panelMode === 'incidents' ? 'panel-tab active' : 'panel-tab'} onClick={() => setPanelMode('incidents')}>Incidents <span>{snapshot?.incidents.length ?? 0}</span></button>
            <button type="button" role="tab" aria-selected={panelMode === 'units'} className={panelMode === 'units' ? 'panel-tab active' : 'panel-tab'} onClick={() => setPanelMode('units')}>Units <span>{snapshot?.units.length ?? 0}</span></button>
          </div>

          {panelMode === 'incidents' ? (
            <div className="triage-list" role="tabpanel" aria-label="Open incident triage queue">
              {snapshot?.incidents.length ? snapshot.incidents.map((incident) => (
                <button
                  type="button"
                  key={incident.id}
                  className={`triage-item${selectedIncidentId === incident.id ? ' selected' : ''}${freshIncidentIds.has(incident.id) ? ' incident-arrival' : ''}`}
                  onClick={() => setSelectedIncidentId(incident.id)}
                >
                  <span className={`severity-rail severity-rail-${incident.severity.toLowerCase()}`} />
                  <span className="triage-main">
                    <span className="triage-title-row"><strong>#{incident.incident_number} · {incident.location_label}</strong><span className={`severity-mini severity-${incident.severity.toLowerCase()}`}>{incident.severity}</span></span>
                    <span className="triage-meta">{formatType(incident.emergency_type)} <i>·</i> {incident.report_count} {incident.report_count === 1 ? 'report' : 'reports'}</span>
                    <span className="triage-meta">Updated {formatAge(incident.last_report_at)}</span>
                  </span>
                  {freshIncidentIds.has(incident.id) && <span className="new-marker">NEW</span>}
                </button>
              )) : <div className="empty-state"><strong>No open incidents</strong><span>New citizen reports will appear here.</span></div>}
            </div>
          ) : (
            <div className="unit-list" role="tabpanel" aria-label="Live response unit statuses">
              {snapshot?.units.map((unit) => (
                <article className="unit-row" key={unit.id}>
                  <span className={`unit-row-glyph unit-marker-${unit.status}`}>{UNIT_GLYPH[unit.unit_type]}</span>
                  <div className="unit-row-main"><strong>{unit.name}</strong><span>{UNIT_LABEL[unit.unit_type]} · {unit.station_name}</span></div>
                  <span className={`unit-status-text unit-status-text-${unit.status}`}>{UNIT_STATUS_LABEL[unit.status]}</span>
                </article>
              ))}
            </div>
          )}
          <div className="triage-footer"><span className={`status-dot status-${connectionStatus === 'live' ? 'connected' : connectionStatus === 'offline' ? 'offline' : 'checking'}`} />{connectionStatus === 'live' ? 'State synced every 2 seconds' : connectionStatus === 'offline' ? 'Server connection unavailable' : 'Syncing live state'}</div>
        </aside>

        <section className="map-section" aria-label="Live incident and response unit map">
          <div className="map-heading"><div><span className="map-kicker">LIVE FIELD VIEW</span><span className="map-region">Chennai, Tamil Nadu</span></div><span className="map-updated">{snapshot ? `${snapshot.units.length} units tracked` : 'Loading map data'}</span></div>
          <MapContainer center={CHENNAI_CENTER} zoom={11} scrollWheelZoom className="command-map">
            <TileLayer attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'} url="/api/tiles?z={z}&x={x}&y={y}" />
            <MapFocus target={selectedTarget} />
            {snapshot?.incidents.filter((incident) => incident.lat !== null && incident.lng !== null).map((incident) => (
              <CircleMarker
                key={incident.id}
                center={[incident.lat!, incident.lng!]}
                radius={incident.severity === 'Critical' ? 15 : incident.severity === 'High' ? 13 : 11}
                pathOptions={{ color: SEVERITY_COLOR[incident.severity], weight: selectedIncidentId === incident.id ? 4 : 2, fillColor: SEVERITY_COLOR[incident.severity], fillOpacity: selectedIncidentId === incident.id ? 0.92 : 0.78 }}
                eventHandlers={{ click: () => setSelectedIncidentId(incident.id) }}
              >
                <Tooltip permanent direction="top" offset={[0, -10]} className="incident-map-label">#{incident.incident_number} · {incident.report_count}</Tooltip>
                <Popup><strong>Incident #{incident.incident_number}</strong><br />{incident.location_label}<br />{incident.severity} · {formatType(incident.emergency_type)}<br />{incident.report_count} reports</Popup>
              </CircleMarker>
            ))}
            {snapshot?.units.map((unit) => (
              <Marker key={unit.id} position={[unit.lat, unit.lng]} icon={unitIcon(unit)}>
                <Tooltip direction="right">{unit.name} · {UNIT_LABEL[unit.unit_type]} · {UNIT_STATUS_LABEL[unit.status]}</Tooltip>
                <Popup><strong>{unit.name}</strong><br />{UNIT_LABEL[unit.unit_type]}<br />{UNIT_STATUS_LABEL[unit.status]}<br />{unit.station_name}</Popup>
              </Marker>
            ))}
          </MapContainer>
          <div className="map-legend" aria-label="Map legend">
            <span><i className="legend-dot legend-critical" />Critical</span>
            <span><i className="legend-dot legend-high" />High</span>
            <span><i className="legend-dot legend-medium" />Medium</span>
            <span><i className="legend-dot legend-low" />Low</span>
            <span><i className="legend-unit">A</i>Available unit</span>
            <span><i className="legend-unit legend-unit-moving">B</i>Moving unit</span>
          </div>
        </section>

        <aside className="incident-detail-panel" aria-label="Selected incident details">
          {selectedIncident ? (
            <>
              <div className="detail-heading">
                <div><p className="command-eyebrow">SELECTED INCIDENT</p><h2>#{selectedIncident.incident_number}</h2></div>
                <span className={`severity-badge severity-${selectedIncident.severity.toLowerCase()}`}>{selectedIncident.severity}</span>
              </div>
              <div className="detail-location"><strong>{selectedIncident.location_label}</strong><span>{formatType(selectedIncident.emergency_type)} · {selectedIncident.report_count} {selectedIncident.report_count === 1 ? 'report' : 'reports'}</span></div>

              <section className="detail-block">
                <h3>Why this severity?</h3>
                <p className="detail-explain">Score {selectedIncident.final_score}/100 classified this incident as {selectedIncident.severity.toLowerCase()}.</p>
                {selectedReasoning?.keyword_hits?.length ? <p className="reasoning-line"><strong>Signal keywords:</strong> {selectedReasoning.keyword_hits.map((hit) => `${hit.label} (+${hit.weight})`).join(', ')}</p> : null}
                {selectedReasoning?.modifiers?.length ? <p className="reasoning-line"><strong>Modifiers:</strong> {selectedReasoning.modifiers.map((hit) => `${hit.label} (+${hit.weight})`).join(', ')}</p> : null}
                {selectedReasoning?.llm_output?.explanation && <p className="model-explanation">“{selectedReasoning.llm_output.explanation}”</p>}
                <p className="score-footnote">Rule score {selectedReasoning?.rule_score ?? selectedIncident.final_score}/100 · {selectedReasoning?.llm_status === 'used' ? 'LLM assisted' : 'Rule-based fallback'}</p>
              </section>

              <section className="detail-block cluster-block">
                <h3>Cluster explanation</h3>
                <p className="detail-explain">Reports join when they are within 300 m and 60 minutes of an open, compatible incident.</p>
                <p className="cluster-stat"><strong>{selectedIncident.report_count}</strong><span>reports grouped</span>
                  {typeof selectedIncident.cluster_reasoning.last_match_distance_m === 'number' && <><strong>{formatDistance(selectedIncident.cluster_reasoning.last_match_distance_m)}</strong><span>last match distance</span></>}
                </p>
                {selectedIncident.report_count >= 3 && <p className="corroboration-note">3+ reports provide corroboration for severity escalation.</p>}
              </section>

              <section className="detail-block reports-block">
                <div className="subsection-heading"><h3>Reports</h3><span>{selectedReports.length}</span></div>
                <div className="report-list">
                  {selectedReports.length ? selectedReports.map((report) => (
                    <article className="report-row" key={report.id}>
                      <div><span className="report-channel">{report.channel.toUpperCase()}</span><time>{formatAge(report.created_at)}</time></div>
                      <p>{getReportText(report)}</p>
                      {report.people_count !== null && <span className="report-people">{report.people_count} people reported</span>}
                    </article>
                  )) : <p className="muted-copy">Report details are not available.</p>}
                </div>
              </section>

              <section className="detail-block dispatch-block">
                <h3>{selectedDispatch ? 'Assigned response' : 'Recommended units'}</h3>
                {selectedDispatch && activeUnit ? (
                  <div className="assigned-unit"><span className={`unit-row-glyph unit-marker-${activeUnit.status}`}>{UNIT_GLYPH[activeUnit.unit_type]}</span><div><strong>{activeUnit.name}</strong><span>{UNIT_STATUS_LABEL[activeUnit.status]} · ETA {Math.ceil(selectedDispatch.eta_seconds / 60)} min</span></div></div>
                ) : selectedRecommendations.length ? selectedRecommendations.map((recommendation) => (
                  <div className="recommendation-row" key={recommendation.unit.id}>
                    <span className="recommendation-distance">{formatDistance(recommendation.distance_m)}</span>
                    <div><strong>{recommendation.unit.name}</strong><span>{recommendation.reasoning}</span></div>
                  </div>
                )) : <p className="muted-copy">No compatible available unit nearby.</p>}
                <div className="detail-actions">
                  {selectedDispatch ? (
                    <button className="resolve-button" type="button" onClick={() => setResolvePrompt(true)} disabled={Boolean(actionBusy)}>Resolve incident</button>
                  ) : (
                    <button className="dispatch-button" type="button" disabled={Boolean(actionBusy) || selectedRecommendations.length === 0 || !selectedTarget} onClick={() => void performAction('/api/dispatch', { incidentId: selectedIncident.id }, 'dispatch')}>
                      {actionBusy === 'dispatch' ? 'Dispatching…' : 'Dispatch nearest unit'}
                    </button>
                  )}
                </div>
                {resolvePrompt && (
                  <div className="inline-confirm" role="alert"><span>Resolve this incident and return assigned units?</span><button type="button" disabled={Boolean(actionBusy)} onClick={() => void performAction('/api/resolve', { incidentId: selectedIncident.id }, 'resolve')}>{actionBusy === 'resolve' ? 'Resolving…' : 'Confirm'}</button><button className="quiet-button" type="button" onClick={() => setResolvePrompt(false)}>Cancel</button></div>
                )}
              </section>
            </>
          ) : (
            <div className="detail-empty"><p className="command-eyebrow">INCIDENT DETAIL</p><h2>Select an incident</h2><p>Choose a triage row or map marker to inspect reports and response options.</p></div>
          )}
        </aside>
      </div>
      <footer className="command-footer"><span>DISASTERMESH / OPERATIONS</span><span>{lastUpdated ? `Last sync ${new Date(lastUpdated).toLocaleTimeString()}` : 'Awaiting state'}</span></footer>
    </main>
  );
}