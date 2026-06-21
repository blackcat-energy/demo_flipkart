import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { LiveMap } from '@/components/map/LiveMap';
import { TrafficSimulation } from '@/components/simulation/TrafficSimulation';
import {
  useListCorridors, getListCorridorsQueryKey,
  useListZones, getListZonesQueryKey,
  useListJunctions, getListJunctionsQueryKey,
  useListPoliceStations, getListPoliceStationsQueryKey,
  usePredictEvent,
  useCreateEvent
} from '@workspace/api-client-react';
import { EVENT_TYPES, CROWD_ESTIMATES, getRiskColor } from '@/lib/constants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Play, AlertCircle, ChevronRight, Activity, Clock, ShieldAlert, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useLocation } from 'wouter';

export default function NewEvent() {
  const [_, setLocation] = useLocation();

  // Form State
  const [eventName, setEventName] = useState('');
  const [eventType, setEventType] = useState('');
  const [corridor, setCorridor] = useState('');
  const [zone, setZone] = useState('');
  const [junction, setJunction] = useState('');
  const [policeStation, setPoliceStation] = useState('');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [hour, setHour] = useState('12');
  const [crowd, setCrowd] = useState('');
  const [lat, setLat] = useState<number>(12.9716);
  const [lng, setLng] = useState<number>(77.5946);

  const [simulating, setSimulating] = useState(false);

  // Queries
  const { data: corridors = [] } = useListCorridors({ query: { queryKey: getListCorridorsQueryKey() } });
  const { data: zones = [] } = useListZones({ query: { queryKey: getListZonesQueryKey() } });
  const { data: junctions = [] } = useListJunctions({ query: { queryKey: getListJunctionsQueryKey() } });
  const { data: stations = [] } = useListPoliceStations({ query: { queryKey: getListPoliceStationsQueryKey() } });

  // Mutations
  const predictMutation = usePredictEvent();
  const createMutation = useCreateEvent();

  // Effects
  useEffect(() => {
    if (corridor) {
      const selected = corridors.find(c => c.name === corridor);
      if (selected) {
        setLat(selected.lat);
        setLng(selected.lng);
      }
    }
  }, [corridor, corridors]);

  const handlePredict = () => {
    if (!eventName || !eventType || !corridor || !zone || !date) {
      toast.error("Please fill all required fields");
      return;
    }

    predictMutation.mutate({
      data: {
        event_cause_ui: eventType,
        corridor,
        zone,
        junction: junction || undefined,
        police_station: policeStation || undefined,
        hour: parseInt(hour, 10),
        latitude: lat,
        longitude: lng
      }
    });
  };

  const handleSave = () => {
    const result = predictMutation.data;
    if (!result || !date) return;

    createMutation.mutate({
      data: {
        event_name: eventName,
        event_cause_ui: eventType,
        corridor,
        zone,
        junction: junction || undefined,
        police_station: policeStation || undefined,
        latitude: lat,
        longitude: lng,
        event_date: date.toISOString().split('T')[0],
        event_hour: parseInt(hour, 10),
        crowd_estimate: crowd || '<500',
        risk_score: result.risk_score,
        priority_probability: result.priority_probability,
        closure_predicted: result.closure_predicted,
        resolution_minutes: result.predicted_resolution_minutes,
        recommendations_json: JSON.stringify(result.recommendations),
        status: 'planned'
      }
    }, {
      onSuccess: () => {
        toast.success("Event created successfully");
        setLocation('/');
      },
      onError: () => {
        toast.error("Failed to create event");
      }
    });
  };

  const prediction = predictMutation.data;

  return (
    <AppLayout>
      <div className="flex w-full h-full">
        {/* Left Panel: Form */}
        <div className="w-[360px] border-r border-border bg-card flex flex-col shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-border bg-muted/20">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              New Scenario
            </h2>
          </div>

          <div className="p-4 space-y-4 flex-1">
            <div className="space-y-2">
              <Label>Event Name *</Label>
              <Input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. MG Road Protest" />
            </div>

            <div className="space-y-2">
              <Label>Event Type *</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Corridor *</Label>
              <Select value={corridor} onValueChange={setCorridor}>
                <SelectTrigger>
                  <SelectValue placeholder="Select corridor" />
                </SelectTrigger>
                <SelectContent>
                  {corridors.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Zone *</Label>
                <Select value={zone} onValueChange={setZone}>
                  <SelectTrigger>
                    <SelectValue placeholder="Zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Police Station *</Label>
                <Select value={policeStation} onValueChange={setPoliceStation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Station" />
                  </SelectTrigger>
                  <SelectContent>
                    {stations.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Junction (Optional)</Label>
              <Select value={junction} onValueChange={setJunction}>
                <SelectTrigger>
                  <SelectValue placeholder="Select junction" />
                </SelectTrigger>
                <SelectContent>
                  {junctions.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, "MMM d, yyyy") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Start Time *</Label>
                <Select value={hour} onValueChange={setHour}>
                  <SelectTrigger>
                    <SelectValue placeholder="Hour" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }).map((_, i) => (
                      <SelectItem key={i} value={i.toString()}>
                        {i.toString().padStart(2, '0')}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Expected Crowd</Label>
              <Select value={crowd} onValueChange={setCrowd}>
                <SelectTrigger>
                  <SelectValue placeholder="Select crowd size" />
                </SelectTrigger>
                <SelectContent>
                  {CROWD_ESTIMATES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            
            <div className="pt-4">
              <Button 
                onClick={handlePredict} 
                className="w-full font-bold text-sm h-11"
                disabled={predictMutation.isPending}
              >
                {predictMutation.isPending ? "Analyzing..." : "Analyze Impact →"}
              </Button>
            </div>

            {prediction && (
              <div className="pt-6 border-t border-border mt-6 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                <div>
                  <div className="text-xl font-bold leading-tight" style={{ color: getRiskColor(prediction.risk_score) }}>
                    {prediction.risk_label}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {prediction.duration_band}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="font-medium bg-muted/50">
                    Risk: {prediction.risk_score.toFixed(0)}
                  </Badge>
                  <Badge variant="outline" className="font-medium bg-muted/50">
                    Priority: {(prediction.priority_probability * 100).toFixed(0)}%
                  </Badge>
                  <Badge variant="outline" className="font-medium bg-muted/50">
                    Closure: {(prediction.closure_probability * 100).toFixed(0)}%
                  </Badge>
                </div>

                <div className="p-3 bg-muted/30 border border-border rounded-md text-sm font-medium">
                  {prediction.closure_predicted ? (
                     <span className="text-destructive flex items-center gap-1"><ShieldAlert className="h-4 w-4"/> Road closure likely</span>
                  ) : (
                     <span className="text-emerald-600">Road closure unlikely</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center: Map or Simulation */}
        <div className="flex-1 relative bg-muted flex flex-col">
          {simulating && prediction ? (
            <div className="p-6 h-full flex items-center justify-center bg-[#E5E7EB]/50">
              <div className="w-full max-w-4xl h-[600px]">
                <TrafficSimulation
                  corridorName={corridor || 'Unknown Corridor'}
                  junctionName={junction || (corridor ? corridor.split(' ')[0] + ' Junction' : 'Junction')}
                  prediction={prediction}
                  onExit={() => setSimulating(false)}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 relative">
              <LiveMap 
                interactive 
                onLocationSelect={(l, ln) => { setLat(l); setLng(ln); }}
                center={[lat, lng]}
                zoom={14}
                impactRadius={prediction ? (prediction.risk_score * 10) : undefined}
                riskScore={prediction?.risk_score}
                selectedEvent={{
                  id: 0,
                  event_name: eventName || 'New Event Location',
                  event_cause_ui: eventType,
                  corridor,
                  zone,
                  latitude: lat,
                  longitude: lng,
                  event_date: '',
                  event_hour: 0,
                  crowd_estimate: '',
                  risk_score: prediction?.risk_score || 0,
                  priority_probability: 0,
                  closure_predicted: false,
                  resolution_minutes: 0,
                  recommendations_json: '',
                  status: 'planned',
                  created_at: ''
                }}
              />
              
              {prediction && (
                <div className="absolute bottom-6 left-6 z-[1000] bg-card border border-border p-4 rounded-xl shadow-lg w-72">
                  <div className="font-bold text-sm mb-1">Impact Summary</div>
                  <div className="text-xs text-muted-foreground mb-3">{corridor}</div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Est. Delay</span>
                      <span className="font-bold">{prediction.predicted_resolution_minutes} mins</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Severity</span>
                      <span className="font-bold" style={{ color: getRiskColor(prediction.risk_score) }}>
                        {prediction.risk_score.toFixed(0)}/100
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel: Recommendations */}
        <div className="w-[360px] border-l border-border bg-card flex flex-col shrink-0 overflow-y-auto">
          {prediction ? (
            <>
              <div className="p-4 border-b border-border bg-muted/20">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  AI Response Plan
                </h2>
              </div>
              
              <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-2">
                    Response Plan Actions
                  </span>
                  <div className="space-y-2">
                    {prediction.recommendations.map((rec, idx) => (
                      <div key={idx} className="p-3 border border-border rounded-lg bg-card hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group text-xs">
                        <div className="font-bold text-foreground flex items-start justify-between">
                          <span>{rec.action}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                          <strong>Reasoning:</strong> {rec.why}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Similar Historical Reference Events */}
                {((prediction as any).similar_historical_events || []).length > 0 && (
                  <div className="pt-4 border-t border-border space-y-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                      Similar Historical Events
                    </span>
                    <div className="space-y-2.5">
                      {((prediction as any).similar_historical_events || []).map((ev: any, idx: number) => (
                        <div key={idx} className="p-3 border border-border/60 bg-muted/20 rounded-xl text-xs space-y-1">
                          <div className="font-semibold text-foreground">{ev.event_name}</div>
                          <div className="text-[10px] text-muted-foreground">{ev.event_date} · {ev.corridor}</div>
                          <div className="grid grid-cols-3 gap-2 mt-2 pt-1.5 border-t border-border/40 text-[10px]">
                            <div>
                              <span className="text-muted-foreground block text-[9px] uppercase font-semibold">Delay</span>
                              <span className="font-bold">{ev.actual_delay_minutes || ev.resolution_minutes} min</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground block text-[9px] uppercase font-semibold">Closure</span>
                              <span className="font-bold">{ev.actual_closures ?? ev.closure_predicted ? 'Yes' : 'No'}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground block text-[9px] uppercase font-semibold">Resolution</span>
                              <span className="font-bold">{ev.resolution_minutes} min</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-border bg-muted/10 space-y-3">
                {!simulating && (
                  <Button 
                    variant="outline" 
                    className="w-full bg-[#1e3a8a] text-white hover:bg-[#1e40af] border-transparent"
                    onClick={() => setSimulating(true)}
                  >
                    <Play className="h-4 w-4 mr-2" /> Simulate This Event
                  </Button>
                )}
                
                <Button 
                  onClick={handleSave} 
                  className="w-full font-bold h-12"
                  disabled={createMutation.isPending}
                >
                  Save & Activate
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
              <Shield className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="font-medium text-foreground">Awaiting Analysis</p>
              <p className="text-sm mt-1">Fill out the scenario details and click Analyze Impact to generate an AI response plan.</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
