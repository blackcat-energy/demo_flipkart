import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { LiveMap } from '@/components/map/LiveMap';
import { 
  useListEvents, 
  getListEventsQueryKey, 
  useGetHotspots, 
  getGetHotspotsQueryKey, 
  useUpdateEvent 
} from '@workspace/api-client-react';
import { getRiskColor, getRiskLabel } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { 
  AlertCircle, 
  ArrowRight, 
  Shield, 
  Clock, 
  MapPin, 
  Activity, 
  Play, 
  Lock, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';
import { Link } from 'wouter';
import { Event, PredictResult } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrafficSimulation } from '@/components/simulation/TrafficSimulation';
import { TrafficGraph } from '@/lib/graph';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [simulatingEvent, setSimulatingEvent] = useState<Event | null>(null);
  const [simulatingMode, setSimulatingMode] = useState<'without' | 'with'>('without');

  // Load static network parameters for Dijkstra rerouting
  const [junctionCoords, setJunctionCoords] = useState<Record<string, { lat: number, lng: number }>>({});
  const [corridorConnections, setCorridorConnections] = useState<Record<string, { start: string, end: string }>>({});
  
  useEffect(() => {
    fetch('/api/junction_coords')
      .then(res => res.json())
      .then(setJunctionCoords)
      .catch(err => console.error("Error loading junction coordinates on dashboard:", err));

    fetch('/api/corridor_connections')
      .then(res => res.json())
      .then(setCorridorConnections)
      .catch(err => console.error("Error loading corridor connections on dashboard:", err));
  }, []);

  const { data: activeEvents = [], isLoading: isLoadingActive } = useListEvents(
    { status: 'active' },
    { query: { queryKey: getListEventsQueryKey({ status: 'active' }) } }
  );

  const { data: plannedEvents = [], isLoading: isLoadingPlanned } = useListEvents(
    { status: 'planned' },
    { query: { queryKey: getListEventsQueryKey({ status: 'planned' }) } }
  );

  const { data: hotspots = [] } = useGetHotspots({
    query: { queryKey: getGetHotspotsQueryKey() }
  });

  const updateMutation = useUpdateEvent();

  const allEvents = useMemo(() => [...activeEvents, ...plannedEvents], [activeEvents, plannedEvents]);
  const selectedEvent = allEvents.find(e => e.id === selectedEventId) || null;

  const mapCenter: [number, number] = selectedEvent 
    ? [selectedEvent.latitude, selectedEvent.longitude]
    : [12.9716, 77.5946];

  // Graph instance for Dijkstra path computation
  const graph = useMemo(() => {
    if (Object.keys(junctionCoords).length > 0 && Object.keys(corridorConnections).length > 0) {
      // Map coordinates to include the junction name
      const nodes: Record<string, { name: string; lat: number; lng: number }> = {};
      for (const [name, coords] of Object.entries(junctionCoords)) {
        nodes[name] = { name, lat: coords.lat, lng: coords.lng };
      }
      return new TrafficGraph(nodes, corridorConnections);
    }
    return null;
  }, [junctionCoords, corridorConnections]);

  // Compute the dynamic detour route to display on the Leaflet map
  const diversionPath = useMemo(() => {
    if (!graph || !selectedEvent) return [];
    const conn = corridorConnections[selectedEvent.corridor];
    if (!conn) return [];
    
    // Find path bypassing the selected congested corridor
    return graph.findPath(conn.start, conn.end, new Set([selectedEvent.corridor]));
  }, [graph, selectedEvent, corridorConnections]);

  const handleLockPlan = () => {
    if (!selectedEvent) return;
    updateMutation.mutate({
      id: selectedEvent.id,
      data: { status: 'active' }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({ status: 'active' }) });
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({ status: 'planned' }) });
        toast.success("Traffic control plan successfully locked and activated!");
      },
      onError: () => {
        toast.error("Failed to activate plan. Please try again.");
      }
    });
  };

  // Build a synthetic PredictResult for the simulation component
  const buildPrediction = (ev: Event): PredictResult => {
    let recs: any[] = [];
    try { recs = JSON.parse(ev.recommendations_json); } catch { /* empty */ }
    return {
      risk_score: ev.risk_score,
      risk_label: getRiskLabel(ev.risk_score),
      priority_probability: ev.priority_probability,
      closure_probability: ev.closure_predicted ? 0.85 : 0.25,
      closure_predicted: ev.closure_predicted,
      predicted_resolution_minutes: ev.resolution_minutes,
      duration_band: ev.resolution_minutes < 60 ? 'Short' : ev.resolution_minutes < 180 ? 'Moderate' : 'Extended',
      recommendations: recs,
    };
  };

  return (
    <AppLayout>
      <div className="flex w-full h-full">
        {/* Left Panel: Ongoing & Upcoming Scenarios */}
        <div className="w-80 border-r border-border bg-card flex flex-col shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-border bg-muted/20">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Live Monitoring
            </h2>
          </div>
          
          <div className="flex-1 p-3 space-y-3">
            <div className="px-1 flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Ongoing Scenarios</span>
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
            </div>

            {isLoadingActive ? (
              <div className="space-y-3">
                {[1,2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            ) : activeEvents.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-xs border border-dashed rounded-lg">
                No active traffic events.
              </div>
            ) : (
              activeEvents.map(event => (
                <EventCard 
                  key={event.id} 
                  event={event} 
                  isSelected={selectedEventId === event.id}
                  onClick={() => setSelectedEventId(event.id)}
                />
              ))
            )}

            <div className="mt-6 mb-3 flex items-center justify-between px-1">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Upcoming Events</span>
            </div>
            
            {isLoadingPlanned ? (
              <div className="space-y-3">
                {[1].map(i => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : plannedEvents.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-xs border border-dashed rounded-lg">
                No upcoming events planned.
              </div>
            ) : (
              plannedEvents.map(event => (
                <div 
                  key={event.id} 
                  onClick={() => setSelectedEventId(event.id)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    selectedEventId === event.id 
                      ? 'bg-primary/5 border-primary shadow-sm' 
                      : 'bg-card border-border/50 hover:border-border/80 hover:shadow-sm'
                  }`}
                >
                  <div className="font-semibold text-xs text-foreground">{event.event_name}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {event.corridor}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {event.event_date}
                    </span>
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      Planned
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Center: Live Map */}
        <div className="flex-1 bg-muted relative">
          <LiveMap 
            hotspots={hotspots} 
            selectedEvent={selectedEvent}
            center={mapCenter}
            zoom={selectedEvent ? 14 : 12}
            mode={selectedEvent?.status === 'active' ? 'with' : 'without'}
            diversionPath={diversionPath}
          />
        </div>

        {/* Right Panel: Event Control HUD (The 3 Pillars) */}
        {selectedEvent ? (
          <div className="w-[420px] border-l border-border bg-card flex flex-col shrink-0 overflow-y-auto">
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20">
              <div>
                <h2 className="text-sm font-bold truncate max-w-[280px]" title={selectedEvent.event_name}>
                  {selectedEvent.event_name}
                </h2>
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">Command Center Detail</span>
              </div>
              <button 
                onClick={() => setSelectedEventId(null)}
                className="text-xs text-muted-foreground hover:text-foreground font-semibold"
              >
                Close
              </button>
            </div>

            {/* Quick Actions Card */}
            <div className="p-4 bg-muted/10 border-b border-border space-y-3 shrink-0">
              <Button 
                variant="outline" 
                className="w-full bg-[#1e3a8a] text-white hover:bg-[#1e40af] border-transparent font-bold text-xs h-9"
                onClick={() => setSimulatingEvent(selectedEvent)}
              >
                <Play className="h-3.5 w-3.5 mr-2" /> Simulate Traffic Flow
              </Button>

              {selectedEvent.status === 'planned' && (
                <Button 
                  onClick={handleLockPlan} 
                  className="w-full font-bold text-xs h-9"
                  variant="default"
                  disabled={updateMutation.isPending}
                >
                  <Lock className="h-3.5 w-3.5 mr-2" /> Lock & Activate Response
                </Button>
              )}
            </div>

            {/* Content Scrolling Area */}
            <div className="flex-1 p-4 space-y-5">
              
              {/* PILLAR 1: CONGESTION IMPACT ASSESSMENT */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  1. Congestion Impact Assessment
                </span>
                <div className="bg-muted/30 border border-border/50 rounded-xl p-3 space-y-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Disruption Score:</span>
                    <span className="font-bold text-sm" style={{ color: getRiskColor(selectedEvent.risk_score) }}>
                      {selectedEvent.risk_score.toFixed(0)}/100 ({getRiskLabel(selectedEvent.risk_score)} Risk)
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Est. Resolution Delay:</span>
                      <span className="font-semibold text-foreground">{selectedEvent.resolution_minutes} mins</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div 
                        className="h-full bg-primary" 
                        style={{ width: `${Math.min(100, (selectedEvent.resolution_minutes / 180) * 100)}%` }} 
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Priority Event Probability:</span>
                      <span className="font-semibold text-foreground">{(selectedEvent.priority_probability * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div 
                        className="h-full bg-indigo-500" 
                        style={{ width: `${selectedEvent.priority_probability * 100}%` }} 
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-1 border-t border-border/40">
                    <span className="text-muted-foreground">Road Closure Probability:</span>
                    <Badge variant={selectedEvent.closure_predicted ? "destructive" : "secondary"} className="text-[10px]">
                      {selectedEvent.closure_predicted ? "HIGH RISK" : "LOW RISK"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* PILLAR 2: AI RESPONSE PLAN & RECOMMENDATIONS */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  2. AI Response Recommendations
                </span>
                <div className="space-y-2.5">
                  {JSON.parse(selectedEvent.recommendations_json || '[]').map((rec: any, idx: number) => {
                    const isPersonnel = rec.category === 'Personnel';
                    const isInfra = rec.category === 'Infrastructure';
                    const isDiv = rec.category === 'Diversion';

                    let catBg = 'bg-blue-500/5 border-blue-500/20 text-blue-800';
                    if (isInfra) catBg = 'bg-amber-500/5 border-amber-500/20 text-amber-800';
                    if (isDiv) catBg = 'bg-violet-500/5 border-violet-500/20 text-violet-800';
                    
                    return (
                      <div key={idx} className={`p-3 border rounded-xl transition-all ${catBg}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs">{rec.action}</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-white border px-1.5 py-0.5 rounded shadow-sm">
                            {rec.category || 'Plan'}
                          </span>
                        </div>
                        <div className="text-[11px] leading-relaxed mt-2 opacity-80 border-t border-current/10 pt-1.5">
                          <strong>Reasoning:</strong> {rec.why}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* PILLAR 3: REAL-TIME MONITORING TIMELINE */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  3. Real-Time Deployment Feed
                </span>
                <div className="bg-muted/15 border border-border/50 rounded-xl p-3 space-y-4">
                  {selectedEvent.status === 'active' ? (
                    <div className="relative border-l border-border pl-4 ml-2 space-y-4 text-xs">
                      <div className="relative">
                        <span className="absolute -left-6 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500 flex items-center justify-center text-[8px] text-white">✓</span>
                        <div className="text-muted-foreground font-bold text-[10px]">09:00 AM</div>
                        <div className="font-semibold text-foreground mt-0.5">Officers Deployed</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">Response team checked-in at checkpoints.</div>
                      </div>
                      <div className="relative">
                        <span className="absolute -left-6 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500 flex items-center justify-center text-[8px] text-white">✓</span>
                        <div className="text-muted-foreground font-bold text-[10px]">09:12 AM</div>
                        <div className="font-semibold text-foreground mt-0.5">Physical Barricades Set</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">Access control barriers deployed at entrance.</div>
                      </div>
                      <div className="relative">
                        <span className="absolute -left-6 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500 flex items-center justify-center text-[8px] text-white">✓</span>
                        <div className="text-muted-foreground font-bold text-[10px]">09:20 AM</div>
                        <div className="font-semibold text-foreground mt-0.5">Diversion Active</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">Vehicles rerouted via detour paths.</div>
                      </div>
                      <div className="relative">
                        <span className="absolute -left-6 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-indigo-500 animate-pulse flex items-center justify-center text-[8px] text-white">📡</span>
                        <div className="text-muted-foreground font-bold text-[10px]">09:50 AM (Current)</div>
                        <div className="font-semibold text-foreground mt-0.5">Load Balancing Active</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">Detoured vehicles split dynamically. Flow stable.</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground text-xs">
                      <Lock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                      Plan not locked. Lock and activate the response plan to start real-time deployment logging.
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div className="w-80 border-l border-border bg-card flex flex-col shrink-0 items-center justify-center p-6 text-center text-muted-foreground">
            <MapPin className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-xs text-foreground">No Event Selected</p>
            <p className="text-xs mt-1 leading-relaxed">Select an active or planned scenario from the left panel to inspect the AI response and run micro-simulations.</p>
          </div>
        )}
      </div>

      {/* Simulation Replay Modal */}
      <Dialog open={!!simulatingEvent} onOpenChange={open => { if (!open) setSimulatingEvent(null); }}>
        <DialogContent className="max-w-5xl w-full h-[620px] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-5 pt-4 pb-0 shrink-0">
            <DialogTitle className="text-sm font-bold flex justify-between items-center">
              <span>
                Micro-Simulation: {simulatingEvent?.event_name}
                <span className="text-xs text-muted-foreground font-normal ml-2">
                  ({simulatingEvent?.corridor} · {simulatingEvent?.event_cause_ui})
                </span>
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden px-4 pb-4 pt-2">
            {simulatingEvent && (
              <TrafficSimulation
                corridorName={simulatingEvent.corridor}
                junctionName={simulatingEvent.junction || simulatingEvent.corridor.split(' ')[0] + ' Junction'}
                prediction={buildPrediction(simulatingEvent)}
                onExit={() => setSimulatingEvent(null)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function EventCard({ event, isSelected, onClick }: { event: Event, isSelected: boolean, onClick: () => void }) {
  const riskColor = getRiskColor(event.risk_score);
  
  return (
    <div 
      onClick={onClick}
      className={`p-3 rounded-lg border transition-all cursor-pointer ${
        isSelected 
          ? 'bg-primary/5 border-primary shadow-sm' 
          : 'bg-card border-border/50 hover:border-border/80 hover:shadow-sm'
      }`}
    >
      <div className="font-semibold text-xs text-foreground">{event.event_name}</div>
      <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
        <MapPin className="h-3 w-3 animate-bounce text-muted-foreground" /> {event.corridor}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <div 
          className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${riskColor}15`, color: riskColor }}
        >
          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: riskColor }}></div>
          {getRiskLabel(event.risk_score).toUpperCase()} RISK
        </div>
        <div className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
          {event.event_cause_ui}
        </div>
      </div>
    </div>
  );
}
