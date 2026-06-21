import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Activity } from 'lucide-react';
import { PredictResult } from '@workspace/api-client-react';

const W = 880;
const H = 380;
const PAD = 52;

type VType = 'car' | 'bus' | 'auto' | 'moto';

const VCOLORS: Record<VType, string> = {
  car: '#60A5FA',
  bus: '#34D399',
  auto: '#FBBF24',
  moto: '#A78BFA',
};

interface GeoPoint {
  lat: number;
  lng: number;
}

interface SimNode extends GeoPoint {
  name: string;
  x: number;
  y: number;
}

interface SimLink {
  id: string;
  physicalName: string;
  start: string;
  end: string;
  lanes: number;
  capacity: number;
  isPrimary: boolean;
}

interface Veh {
  id: number;
  type: VType;
  path: string[];
  currentLinkIdx: number;
  progress: number;
  speed: number;
  baseSpeed: number;
  lane: number;
  width: number;
  height: number;
  color: string;
}

interface TrafficSimulationProps {
  corridorName: string;
  junctionName?: string;
  prediction: PredictResult;
  onExit?: () => void;
  lockedStage?: number;
  defaultMode?: 'without' | 'with';
}

let _vid = 2000;

function rtype(): VType {
  const r = Math.random();
  return r < 0.5 ? 'car' : r < 0.65 ? 'bus' : r < 0.85 ? 'auto' : 'moto';
}

function vsize(t: VType) {
  if (t === 'bus') return { w: 22, h: 10 };
  if (t === 'auto') return { w: 14, h: 8 };
  if (t === 'moto') return { w: 11, h: 6 };
  return { w: 16, h: 8 };
}

function eventCauseFromPrediction(prediction: PredictResult) {
  const text = JSON.stringify(prediction.recommendations ?? []).toLowerCase();
  if (text.includes('water')) return 'Water Logging';
  if (text.includes('procession') || text.includes('festival')) return 'Festival / Procession';
  if (text.includes('sports')) return 'Sports Event';
  if (text.includes('construction')) return 'Construction';
  if (text.includes('vip')) return 'VIP Movement';
  return 'Protest';
}

function label(name: string, max = 18) {
  return name.length > max ? `${name.slice(0, max - 1)}...` : name;
}

function uniquePhysicalNames(route: string[], links: Record<string, SimLink>) {
  return Array.from(new Set(route.map(linkId => links[linkId]?.physicalName).filter(Boolean)));
}

function stageTrafficProfile(stage: number, mode: 'without' | 'with') {
  if (stage < 1) return { spawn: 0.05, maxVehicles: 28, label: 'Low demand' };
  if (stage < 2) return { spawn: 0.13, maxVehicles: 54, label: 'Build-up' };
  if (stage < 3) return { spawn: mode === 'with' ? 0.20 : 0.25, maxVehicles: mode === 'with' ? 82 : 110, label: 'Queue forming' };
  if (stage < 3.75) return { spawn: mode === 'with' ? 0.24 : 0.38, maxVehicles: mode === 'with' ? 96 : 155, label: 'Peak load' };
  return { spawn: mode === 'with' ? 0.08 : 0.12, maxVehicles: mode === 'with' ? 58 : 92, label: 'Recovery' };
}

function formatMeters(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function getCoords(
  linkId: string,
  progress: number,
  lane: number,
  links: Record<string, SimLink>,
  nodes: Record<string, SimNode>,
) {
  const link = links[linkId];
  if (!link) return { x: 0, y: 0, angle: 0 };

  const startPt = nodes[link.start];
  const endPt = nodes[link.end];
  if (!startPt || !endPt) return { x: 0, y: 0, angle: 0 };

  const dx = endPt.x - startPt.x;
  const dy = endPt.y - startPt.y;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const px = -dy / len;
  const py = dx / len;
  const laneOffset = (lane - (link.lanes - 1) / 2) * 10;

  return {
    x: startPt.x + dx * progress + px * laneOffset,
    y: startPt.y + dy * progress + py * laneOffset,
    angle: Math.atan2(dy, dx) * 180 / Math.PI,
  };
}

function findRoutes(
  start: string,
  end: string,
  links: Record<string, SimLink>,
  blocked: string,
  maxDepth = 4,
) {
  const routes: string[][] = [];
  const edges = Object.values(links).filter(edge => edge.physicalName !== blocked);

  function walk(node: string, path: string[], seen: Set<string>) {
    if (path.length > maxDepth) return;
    if (node === end && path.length > 0) {
      routes.push(path);
      return;
    }

    for (const edge of edges) {
      if (edge.start !== node || seen.has(edge.end)) continue;
      walk(edge.end, [...path, edge.id], new Set([...seen, edge.end]));
    }
  }

  walk(start, [], new Set([start]));
  return routes.sort((a, b) => a.length - b.length).slice(0, 3);
}

export function TrafficSimulation({
  corridorName,
  junctionName,
  prediction,
  onExit,
  lockedStage,
  defaultMode = 'without',
}: TrafficSimulationProps) {
  const [mode, setMode] = useState<'without' | 'with'>(defaultMode);
  const [stage, setStage] = useState(lockedStage ?? 0);
  const [vehs, setVehs] = useState<Veh[]>([]);
  const [junctionCoords, setJunctionCoords] = useState<Record<string, GeoPoint>>({});
  const [corridorConnections, setCorridorConnections] = useState<Record<string, { start: string; end: string }>>({});
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef(0);

  useEffect(() => {
    fetch('/api/junction_coords')
      .then(res => res.json())
      .then(setJunctionCoords)
      .catch(err => console.error('Error loading simulation junction coordinates:', err));

    fetch('/api/corridor_connections')
      .then(res => res.json())
      .then(setCorridorConnections)
      .catch(err => console.error('Error loading simulation corridor connections:', err));
  }, []);

  useEffect(() => {
    setVehs([]);
  }, [corridorName, mode]);

  useEffect(() => {
    if (lockedStage !== undefined) {
      setStage(lockedStage);
      return;
    }
    const t = setInterval(() => {
      setStage(s => (s >= 4 ? 0 : s + 0.015));
    }, 100);
    return () => clearInterval(t);
  }, [lockedStage]);

  const network = useMemo(() => {
    const selected = corridorConnections[corridorName];
    if (!selected) return null;

    const included = new Set<string>([corridorName]);
    for (const [name, edge] of Object.entries(corridorConnections)) {
      if (
        edge.start === selected.start ||
        edge.end === selected.start ||
        edge.start === selected.end ||
        edge.end === selected.end
      ) {
        included.add(name);
      }
    }

    const nodeNames = new Set<string>();
    for (const name of included) {
      const edge = corridorConnections[name];
      if (!edge) continue;
      nodeNames.add(edge.start);
      nodeNames.add(edge.end);
    }

    const points = [...nodeNames]
      .map(name => ({ name, ...(junctionCoords[name] ?? {}) }))
      .filter((node): node is { name: string; lat: number; lng: number } =>
        typeof node.lat === 'number' && typeof node.lng === 'number',
      );

    if (points.length < 2) return null;

    const minLat = Math.min(...points.map(point => point.lat));
    const maxLat = Math.max(...points.map(point => point.lat));
    const minLng = Math.min(...points.map(point => point.lng));
    const maxLng = Math.max(...points.map(point => point.lng));
    const latSpan = Math.max(0.001, maxLat - minLat);
    const lngSpan = Math.max(0.001, maxLng - minLng);

    const nodes: Record<string, SimNode> = {};
    for (const point of points) {
      nodes[point.name] = {
        ...point,
        x: PAD + ((point.lng - minLng) / lngSpan) * (W - PAD * 2),
        y: PAD + ((maxLat - point.lat) / latSpan) * (H - PAD * 2),
      };
    }

    const links: Record<string, SimLink> = {};
    for (const name of included) {
      const edge = corridorConnections[name];
      if (!edge || !nodes[edge.start] || !nodes[edge.end]) continue;
      links[name] = {
        id: name,
        physicalName: name,
        start: edge.start,
        end: edge.end,
        lanes: name === corridorName ? 3 : 2,
        capacity: name === corridorName ? 30 : 20,
        isPrimary: name === corridorName,
      };
      links[`${name}__reverse`] = {
        id: `${name}__reverse`,
        physicalName: name,
        start: edge.end,
        end: edge.start,
        lanes: name === corridorName ? 3 : 2,
        capacity: name === corridorName ? 30 : 20,
        isPrimary: name === corridorName,
      };
    }

    const alternatives = findRoutes(selected.start, selected.end, links, corridorName);
    return { nodes, links, selected, alternatives };
  }, [corridorConnections, corridorName, junctionCoords]);

  const eventCause = eventCauseFromPrediction(prediction);
  const isCapacityReduction = eventCause === 'Water Logging' || eventCause === 'Construction';
  const stageLabels = ['T-2HRS', 'T-1HR', 'EVENT START', 'PEAK', 'RECOVERY'];
  const stageIdx = Math.round(Math.min(stage, 4));
  const trafficProfile = stageTrafficProfile(stage, mode);

  const chooseManagedRoute = useCallback((prev: Veh[]) => {
    if (!network || network.alternatives.length === 0) return [corridorName];

    const routeCosts = network.alternatives.map(route => {
      const volume = prev.filter(vehicle => vehicle.path.some(linkId => route.includes(linkId))).length;
      return {
        route,
        cost: route.length + Math.pow(volume / 12, 2),
      };
    });

    return routeCosts.sort((a, b) => a.cost - b.cost)[0]?.route ?? [corridorName];
  }, [corridorName, network]);

  useEffect(() => {
    if (!network) return;

    const handleSimulationTick = () => {
      countRef.current++;

      const activeBlockLink = stage >= 1.5 ? corridorName : null;
      const blockProgress = eventCause === 'Sports Event' ? 0.2 : eventCause === 'Festival / Procession' ? Math.min(0.95, stage / 4) : 0.45;

      setVehs(prev => {
        let updatedVehs = [...prev];
        let spawnChance = trafficProfile.spawn;

        if (eventCause === 'Sports Event') spawnChance += stage >= 3 ? 0.08 : 0.04;
        if (eventCause === 'Festival / Procession') spawnChance += 0.04;
        if (stage > 3.75) {
          updatedVehs = updatedVehs.filter((_, index) => index % 3 !== countRef.current % 3);
        }

        if (updatedVehs.length < trafficProfile.maxVehicles && Math.random() < spawnChance) {
          const type = rtype();
          const { w, h } = vsize(type);
          const baseSpd = type === 'bus' ? 0.008 : type === 'moto' ? 0.018 : 0.012;
          const path = mode === 'with' && activeBlockLink ? chooseManagedRoute(prev) : [corridorName];
          const firstLink = network.links[path[0]];

          updatedVehs.push({
            id: _vid++,
            type,
            path,
            currentLinkIdx: 0,
            progress: 0,
            speed: baseSpd,
            baseSpeed: baseSpd,
            lane: Math.floor(Math.random() * Math.max(1, firstLink?.lanes ?? 2)),
            width: w,
            height: h,
            color: VCOLORS[type],
          });
        }

        return updatedVehs.map(vehicle => {
          const linkId = vehicle.path[vehicle.currentLinkIdx];
          const link = network.links[linkId];
          if (!link) return null;

          let blocked = false;
          let speedMult = 1;

          if (activeBlockLink && link.physicalName === activeBlockLink) {
            if (isCapacityReduction) {
              speedMult = 0.25;
            } else if (vehicle.progress < blockProgress && vehicle.progress + vehicle.speed >= blockProgress - 0.02) {
              blocked = true;
            }
          }

          if (!blocked) {
            const leadingVehicles = updatedVehs.filter(other =>
              other.id !== vehicle.id &&
              other.path[other.currentLinkIdx] === linkId &&
              other.lane === vehicle.lane &&
              other.progress > vehicle.progress,
            );

            const leader = leadingVehicles.sort((a, b) => a.progress - b.progress)[0];
            if (leader) {
              const gap = leader.progress - vehicle.progress;
              if (gap < 0.045) {
                blocked = leader.speed === 0 || gap < 0.028;
                speedMult = Math.min(speedMult, leader.speed / vehicle.baseSpeed);
              }
            }
          }

          const nextProgress = vehicle.progress + (blocked ? 0 : vehicle.baseSpeed * speedMult);
          if (nextProgress >= 1) {
            if (vehicle.currentLinkIdx + 1 >= vehicle.path.length) return null;
            const nextLink = network.links[vehicle.path[vehicle.currentLinkIdx + 1]];
            return {
              ...vehicle,
              progress: 0,
              currentLinkIdx: vehicle.currentLinkIdx + 1,
              lane: Math.floor(Math.random() * Math.max(1, nextLink?.lanes ?? 2)),
              speed: vehicle.baseSpeed,
            };
          }

          return {
            ...vehicle,
            progress: nextProgress,
            speed: blocked ? 0 : vehicle.baseSpeed * speedMult,
          };
        }).filter(Boolean) as Veh[];
      });
    };

    animRef.current = setInterval(handleSimulationTick, 40);
    return () => {
      if (animRef.current) clearInterval(animRef.current);
    };
  }, [chooseManagedRoute, corridorName, eventCause, isCapacityReduction, mode, network, stage]);

  const blockPosition = useMemo(() => {
    if (!network) return { x: W / 2, y: H / 2 };
    const progress = eventCause === 'Festival / Procession' ? Math.min(0.95, stage / 4) : eventCause === 'Sports Event' ? 0.2 : 0.45;
    return getCoords(corridorName, progress, 1, network.links, network.nodes);
  }, [corridorName, eventCause, network, stage]);

  const stoppedOnPrimary = vehs.filter(vehicle => {
    const link = network?.links[vehicle.path[vehicle.currentLinkIdx]];
    return link?.physicalName === corridorName && vehicle.speed === 0;
  }).length;

  const physicalLinks = network ? Object.values(network.links).filter(link => !link.id.endsWith('__reverse')) : [];
  const bestRoute = network?.alternatives[0] ?? [];
  const bestRouteNames = network ? uniquePhysicalNames(bestRoute, network.links) : [];
  const bestRouteLinks = network ? bestRoute.map(linkId => network.links[linkId]).filter(Boolean) : [];
  const decisionJunction = bestRouteLinks[0]?.end ?? network?.selected.start ?? 'connected junctions';
  const officersDeployed = prediction.risk_score >= 70 ? 8 : prediction.risk_score >= 50 ? 5 : prediction.risk_score >= 30 ? 3 : 1;
  const barricadesActive = prediction.closure_predicted || prediction.risk_score >= 50 ? (prediction.risk_score >= 70 ? 4 : 2) : 0;

  const spilloverLevel = (link: SimLink) => {
    if (!network || link.physicalName === corridorName || mode === 'with' || stage < 1.5) return 0;
    const direct =
      link.start === network.selected.start ||
      link.end === network.selected.start ||
      link.start === network.selected.end ||
      link.end === network.selected.end;

    if (direct) {
      if (stage >= 3 || stoppedOnPrimary > 8) return 2;
      if (stage >= 2 || stoppedOnPrimary > 3) return 1;
    }

    if (stage >= 3.25) {
      const touchesSpillover = physicalLinks.some(other =>
        other.physicalName !== corridorName &&
        (
          other.start === link.start ||
          other.end === link.start ||
          other.start === link.end ||
          other.end === link.end
        ) &&
        (
          other.start === network.selected.start ||
          other.end === network.selected.start ||
          other.start === network.selected.end ||
          other.end === network.selected.end
        )
      );
      return touchesSpillover ? 1 : 0;
    }

    return 0;
  };

  const spilloverCorridors = physicalLinks.filter(link => spilloverLevel(link) > 0).length;
  const primaryVehicles = vehs.filter(vehicle => network?.links[vehicle.path[vehicle.currentLinkIdx]]?.physicalName === corridorName);
  const divertedVehicles = vehs.filter(vehicle => network?.links[vehicle.path[vehicle.currentLinkIdx]]?.physicalName !== corridorName).length;
  const riskFactor = Math.max(0.75, Math.min(1.25, prediction.risk_score / 70));
  const baselineQueue = stage < 1.5 ? 120 : stage < 2.5 ? 850 : stage < 3.5 ? 1800 : 980;
  const managedQueue = stage < 1.5 ? 80 : stage < 2.5 ? 360 : stage < 3.5 ? 450 : 240;
  const queueMeters = Math.round((mode === 'with' ? managedQueue : baselineQueue) * riskFactor + stoppedOnPrimary * 22);
  const vehiclesTrapped = mode === 'with'
    ? Math.max(0, Math.round(primaryVehicles.length * 2.5 + stoppedOnPrimary * 8))
    : Math.round(queueMeters / 4.2 + primaryVehicles.length * 2);
  const vehiclesDiverted = mode === 'with'
    ? Math.round(divertedVehicles * 5 + Math.max(0, stage - 1.5) * 55)
    : 0;
  const congestionReduction = Math.min(48, Math.max(24, Math.round(18 + prediction.risk_score / 3)));
  const officerNode = network?.nodes[network.selected.start];
  const barricadeNode = network?.nodes[network.selected.end];

  const roadColor = (linkId: string) => {
    if (!network) return '#475569';
    const physicalName = network.links[linkId]?.physicalName ?? linkId;
    const link = network.links[linkId];
    const linkVehs = vehs.filter(vehicle => network.links[vehicle.path[vehicle.currentLinkIdx]]?.physicalName === physicalName);
    const stopped = linkVehs.filter(vehicle => vehicle.speed < vehicle.baseSpeed * 0.4).length;
    if (physicalName === corridorName && isCapacityReduction && stage >= 1.5) return '#F97316';
    if (stopped > 8) return '#EF4444';
    if (stopped > 4) return '#F97316';
    if (stopped > 1) return '#EAB308';
    const spill = link ? spilloverLevel(link) : 0;
    if (spill === 2) return '#F97316';
    if (spill === 1) return '#EAB308';
    return network.links[linkId]?.isPrimary ? '#475569' : '#334155';
  };

  const activeManagedLinks = new Set(
    mode === 'with' && network
      ? network.alternatives.flat().map(linkId => network.links[linkId]?.physicalName ?? linkId)
      : [],
  );

  return (
    <div className="w-full h-full flex flex-col bg-card rounded-xl border border-border overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20 shrink-0">
        {onExit ? (
          <Button variant="ghost" size="sm" onClick={onExit} className="gap-1.5 h-8 text-[13px]">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
            <Activity className="h-4 w-4 text-primary animate-pulse" /> SIMULATION DEPLOYMENT
          </div>
        )}

        <div className="flex bg-muted p-0.5 rounded-lg border border-border/50">
          <button
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${mode === 'without' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('without')}
          >
            Baseline
          </button>
          <button
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${mode === 'with' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('with')}
          >
            AI Plan
          </button>
        </div>

        <div className="text-[10px] bg-muted/60 border border-border font-bold rounded px-2 py-1 uppercase text-primary">
          {eventCause}
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-[#0F172A]" style={{ minHeight: 0 }}>
        {!network ? (
          <div className="h-full flex items-center justify-center text-sm font-semibold text-slate-300">
            Loading road network...
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#334155" strokeWidth="0.5" opacity="0.3" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#0F172A" />
            <rect width="100%" height="100%" fill="url(#grid)" />

            {Object.values(network.links).filter(link => !link.id.endsWith('__reverse')).map(link => {
              const start = network.nodes[link.start];
              const end = network.nodes[link.end];
              const isManaged = activeManagedLinks.has(link.physicalName);
              const isPrimary = link.physicalName === corridorName;
              const width = isPrimary ? 18 : isManaged ? 14 : 10;
              const color = isManaged ? '#2563EB' : roadColor(link.id);

              return (
                <g key={link.id}>
                  <line x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                    stroke={color} strokeWidth={width} strokeLinecap="round" opacity={isPrimary || isManaged ? 0.9 : 0.45} />
                  <line x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                    stroke="white" strokeWidth={1} strokeDasharray="8 6" opacity={isPrimary || isManaged ? 0.32 : 0.12} />
                  <text
                    x={(start.x + end.x) / 2}
                    y={(start.y + end.y) / 2 - 10}
                    fontFamily="IBM Plex Sans, sans-serif"
                    fontSize={8}
                    fill={isPrimary ? '#CBD5E1' : '#94A3B8'}
                    fontWeight={700}
                    textAnchor="middle"
                  >
                    {isPrimary ? label(corridorName, 22) : ''}
                  </text>
                </g>
              );
            })}

            {Object.values(network.nodes).map(node => {
              const isEvent = node.name === network.selected.start || node.name === network.selected.end || node.name === junctionName;
              return (
                <g key={node.name}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={isEvent ? 14 : 10}
                    fill={isEvent ? '#1E293B' : '#334155'}
                    stroke={isEvent ? '#EF4444' : '#64748B'}
                    strokeWidth={2}
                  />
                  <text
                    x={node.x}
                    y={node.y + 25}
                    fontFamily="IBM Plex Sans, sans-serif"
                    fontSize={9}
                    fill="#94A3B8"
                    fontWeight={700}
                    textAnchor="middle"
                  >
                    {label(node.name)}
                  </text>
                </g>
              );
            })}

            {stage >= 1.5 && (
              <g transform={`translate(${blockPosition.x}, ${blockPosition.y})`}>
                {isCapacityReduction ? (
                  <>
                    <rect x={-26} y={-10} width={52} height={20} rx={4} fill="#2563EB" fillOpacity={0.45} />
                    <text x={0} y={-16} fontSize={9} fill="#60A5FA" fontWeight="bold" textAnchor="middle">Capacity loss</text>
                  </>
                ) : (
                  <>
                    <circle cx={0} cy={0} r={20} fill="#EF4444" fillOpacity={0.16} className="animate-pulse" />
                    <polygon points="-12,10 12,10 0,-12" fill="#EF4444" />
                    <text x={0} y={8} fontSize={8} fill="white" fontWeight="bold" textAnchor="middle">!</text>
                    <text x={0} y={-17} fontSize={9} fill="#EF4444" fontWeight="bold" textAnchor="middle">Blockage</text>
                  </>
                )}
              </g>
            )}

            {mode === 'with' && (
              <g>
                {officerNode && (
                  <g transform={`translate(${officerNode.x}, ${officerNode.y - 30})`}>
                    <circle r={12} fill="#2563EB" stroke="white" strokeWidth={1.5} />
                    <text x={0} y={4} fontSize={12} textAnchor="middle">P</text>
                    <rect x={-54} y={-30} width={108} height={14} rx={3} fill="#1E3A8A" fillOpacity={0.94} />
                    <text x={0} y={-20} fontFamily="IBM Plex Sans" fontSize={8} fill="white" fontWeight="bold" textAnchor="middle">
                      {officersDeployed} Officers Deployed
                    </text>
                  </g>
                )}
                {barricadeNode && barricadesActive > 0 && (
                  <g transform={`translate(${barricadeNode.x}, ${barricadeNode.y - 28})`}>
                    <rect x={-16} y={-7} width={32} height={14} rx={3} fill="#F97316" stroke="white" strokeWidth={1} />
                    <line x1={-12} y1={6} x2={-4} y2={-6} stroke="white" strokeWidth={2} />
                    <line x1={0} y1={6} x2={8} y2={-6} stroke="white" strokeWidth={2} />
                    <rect x={-48} y={12} width={96} height={14} rx={3} fill="#7C2D12" fillOpacity={0.94} />
                    <text x={0} y={22} fontFamily="IBM Plex Sans" fontSize={8} fill="white" fontWeight="bold" textAnchor="middle">
                      {barricadesActive} Barricades Active
                    </text>
                  </g>
                )}
              </g>
            )}

            {vehs.map(vehicle => {
              const linkId = vehicle.path[vehicle.currentLinkIdx];
              const link = network.links[linkId];
              if (!link) return null;
              const { x, y, angle } = getCoords(linkId, vehicle.progress, Math.min(vehicle.lane, link.lanes - 1), network.links, network.nodes);
              return (
                <g key={vehicle.id} transform={`translate(${x}, ${y}) rotate(${angle})`}>
                  <rect
                    x={-vehicle.width / 2}
                    y={-vehicle.height / 2}
                    width={vehicle.width}
                    height={vehicle.height}
                    rx={2}
                    fill={vehicle.color}
                    stroke={vehicle.speed === 0 ? '#EF4444' : 'none'}
                    strokeWidth={vehicle.speed === 0 ? 1 : 0}
                    opacity={0.9}
                  />
                </g>
              );
            })}
          </svg>
        )}

        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-3 pointer-events-none">
          <div className="grid grid-cols-3 gap-2 min-w-[430px]">
            <div className="bg-slate-950/90 border border-slate-700 rounded-md px-3 py-2 shadow-md">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Queue Length</div>
              <div className={`text-lg font-bold ${mode === 'with' ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMeters(queueMeters)}</div>
            </div>
            <div className="bg-slate-950/90 border border-slate-700 rounded-md px-3 py-2 shadow-md">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{mode === 'with' ? 'Diverted' : 'Trapped'}</div>
              <div className={`text-lg font-bold ${mode === 'with' ? 'text-sky-300' : 'text-amber-300'}`}>{mode === 'with' ? vehiclesDiverted : vehiclesTrapped}</div>
            </div>
            <div className="bg-slate-950/90 border border-slate-700 rounded-md px-3 py-2 shadow-md">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Spillover Roads</div>
              <div className={`text-lg font-bold ${spilloverCorridors === 0 ? 'text-emerald-400' : 'text-orange-300'}`}>{spilloverCorridors}</div>
            </div>
          </div>

          <div className="bg-slate-950/92 border border-slate-700 rounded-md px-3 py-2 shadow-md w-[250px]">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                {mode === 'with' ? 'AI Decision' : 'Incident Impact'}
              </div>
              <div className="text-[9px] text-slate-500 uppercase">{trafficProfile.label}</div>
            </div>
            {mode === 'with' ? (
              <div className="space-y-1 text-[10px] leading-snug">
                <div className="text-slate-300"><span className="text-rose-300 font-semibold">{label(corridorName, 20)}</span> constrained</div>
                <div className="text-sky-200 font-semibold">Route via {label(decisionJunction, 22)}</div>
                <div className="text-slate-400">Reason: {congestionReduction}% lower projected congestion, closure avoided, capacity available on {bestRouteNames.length || 1} connected road{bestRouteNames.length === 1 ? '' : 's'}.</div>
              </div>
            ) : (
              <div className="space-y-1 text-[10px] leading-snug text-slate-400">
                <div>Blocked road causes queue growth on the primary corridor.</div>
                <div>Spillover spreads to connected roads as peak load rises.</div>
              </div>
            )}
          </div>
        </div>

        <div className="absolute bottom-4 left-4 flex gap-2.5 bg-slate-900/80 border border-slate-700/50 px-2.5 py-1.5 rounded-lg">
          {(['car', 'bus', 'auto', 'moto'] as VType[]).map(type => (
            <div key={type} className="flex items-center gap-1">
              <div className="w-3.5 h-2 rounded-sm" style={{ backgroundColor: VCOLORS[type] }} />
              <span className="text-[9px] text-slate-300 capitalize">{type === 'moto' ? '2-Wheeler' : type}</span>
            </div>
          ))}
        </div>
      </div>

      {lockedStage === undefined && (
        <div className="shrink-0 border-t border-border bg-muted/20 px-8 pt-4 pb-3">
          <div
            className="relative h-2 bg-muted rounded-full cursor-pointer select-none"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setStage(frac * 4);
            }}
          >
            <div className="absolute top-0 left-0 h-full bg-primary/40 rounded-full pointer-events-none" style={{ width: `${(stage / 4) * 100}%` }} />
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary/70 border border-background shadow" style={{ left: `calc(${i * 25}% - 4px)` }} />
            ))}
            <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-primary border-2 border-background shadow pointer-events-none z-10" style={{ left: `calc(${(stage / 4) * 100}% - 7px)` }} />
          </div>
          <div className="flex justify-between mt-2">
            {stageLabels.map((stageLabel, i) => (
              <span
                key={stageLabel}
                className={`text-[9px] font-bold uppercase tracking-wider transition-colors cursor-pointer select-none ${stageIdx === i ? 'text-primary' : 'text-muted-foreground'}`}
                onClick={() => setStage(i)}
              >
                {stageLabel}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
