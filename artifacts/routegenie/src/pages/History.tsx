import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { TrafficSimulation } from '@/components/simulation/TrafficSimulation';
import { useListEvents, getListEventsQueryKey, useReviewEvent } from '@workspace/api-client-react';
import { Event, PredictResult } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getRiskColor, getRiskLabel, EVENT_TYPES } from '@/lib/constants';
import { ChevronDown, ChevronUp, Search, Calendar as CalendarIcon, CheckCircle2, Play } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function History() {
  const [filterType, setFilterType] = useState<string>('all');
  const [searchCorridor, setSearchCorridor] = useState('');
  const [simEvent, setSimEvent] = useState<Event | null>(null);

  const { data: events = [], isLoading } = useListEvents(
    {},
    { query: { queryKey: getListEventsQueryKey() } }
  );

  const filteredEvents = events.filter(e => {
    if (filterType !== 'all' && e.event_cause_ui !== filterType) return false;
    if (searchCorridor && !e.corridor.toLowerCase().includes(searchCorridor.toLowerCase())) return false;
    return true;
  });

  // Build a synthetic PredictResult from a stored Event for the simulation
  function buildPrediction(ev: Event): PredictResult {
    let recs: any[] = [];
    try { recs = JSON.parse(ev.recommendations_json); } catch { /* empty */ }
    return {
      risk_score: ev.risk_score,
      risk_label: getRiskLabel(ev.risk_score),
      priority_probability: ev.priority_probability,
      closure_probability: ev.closure_predicted ? 0.85 : 0.2,
      closure_predicted: ev.closure_predicted,
      predicted_resolution_minutes: ev.resolution_minutes,
      duration_band: ev.resolution_minutes < 30 ? '< 30 min' : ev.resolution_minutes < 60 ? '30–60 min' : '> 60 min',
      recommendations: recs,
    };
  }

  return (
    <AppLayout>
      <div className="h-full flex flex-col p-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Historical Events</h1>
            <p className="text-muted-foreground text-sm mt-1">Review past scenarios and prediction accuracy.</p>
          </div>
        </div>

        <div className="flex gap-4 mb-6 shrink-0 bg-card p-4 rounded-xl border border-border">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by corridor..."
              className="pl-9 bg-background"
              value={searchCorridor}
              onChange={(e) => setSearchCorridor(e.target.value)}
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[200px] bg-background">
              <SelectValue placeholder="Event Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {EVENT_TYPES.map(type => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pb-12">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading history...</div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No events found matching your criteria.</div>
          ) : (
            filteredEvents.map(event => (
              <HistoryCard key={event.id} event={event} onSimulate={() => setSimEvent(event)} />
            ))
          )}
        </div>
      </div>

      {/* Simulation Modal */}
      <Dialog open={!!simEvent} onOpenChange={open => { if (!open) setSimEvent(null); }}>
        <DialogContent className="max-w-5xl w-full h-[680px] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-5 pt-4 pb-0 shrink-0">
            <DialogTitle className="text-base font-bold">
              Simulation Replay — {simEvent?.event_name}
              <span className="text-muted-foreground font-normal text-sm ml-2">
                ({simEvent?.corridor} · {simEvent?.event_cause_ui})
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden px-4 pb-4 pt-3">
            {simEvent && (
              <TrafficSimulation
                corridorName={simEvent.corridor}
                junctionName={simEvent.junction || simEvent.corridor.split(' ')[0] + ' Junction'}
                prediction={buildPrediction(simEvent)}
                lockedStage={3}
                defaultMode="with"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function HistoryCard({ event, onSimulate }: { event: Event; onSimulate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [delay, setDelay] = useState('');
  const [closures, setClosures] = useState(false);

  const reviewMutation = useReviewEvent();

  const handleReviewSubmit = () => {
    if (!delay) return;
    reviewMutation.mutate(
      { id: event.id, data: { actual_delay_minutes: Number(delay), actual_closures: closures } },
      {
        onSuccess: () => { toast.success('Review submitted successfully'); setReviewing(false); },
        onError:   () => { toast.error('Failed to submit review'); },
      }
    );
  };

  const hasReview = event.actual_delay_minutes !== null && event.actual_delay_minutes !== undefined;

  let accuracy: number | null = null;
  if (hasReview && event.resolution_minutes > 0) {
    const act = event.actual_delay_minutes!;
    const pred = event.resolution_minutes;
    accuracy = Math.max(0, (1 - Math.abs(act - pred) / pred)) * 100;
  }

  const recommendations = React.useMemo(() => {
    try { return JSON.parse(event.recommendations_json); }
    catch { return []; }
  }, [event.recommendations_json]);

  const riskColor = getRiskColor(event.risk_score);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden transition-all shadow-sm">
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${riskColor}15`, color: riskColor }}
          >
            <CalendarIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold text-foreground">{event.event_name}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
              <span>{format(new Date(event.event_date), 'MMM d, yyyy')}</span>
              <span>•</span>
              <span>{event.corridor}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Risk badge */}
          <div
            className="text-[11px] font-bold px-2 py-1 rounded-md uppercase tracking-wide"
            style={{ backgroundColor: `${riskColor}15`, color: riskColor }}
          >
            {getRiskLabel(event.risk_score)} Risk
          </div>
          {accuracy !== null && (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              {accuracy.toFixed(0)}% Accuracy
            </Badge>
          )}
          <Badge variant="outline" className="capitalize">{event.status}</Badge>
          <div className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="p-5 border-t border-border bg-muted/10">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-6 mb-5">
            <div>
              <div className="text-xs text-muted-foreground font-medium uppercase mb-1">Predicted Delay</div>
              <div className="font-bold text-lg">{event.resolution_minutes} mins</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-medium uppercase mb-1">Risk Score</div>
              <div className="font-bold text-lg" style={{ color: riskColor }}>{event.risk_score.toFixed(1)} / 100</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-medium uppercase mb-1">Crowd Estimate</div>
              <div className="font-bold text-lg">{event.crowd_estimate || '—'}</div>
            </div>
          </div>

          {/* Post-Event Analysis & Learning */}
          {hasReview && (
            <div className="mb-5 p-4 bg-card rounded-xl border border-border shadow-sm space-y-3">
              <div className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Post-Event Analysis & Learning
              </div>
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div className="bg-muted/30 border border-border/50 p-2.5 rounded-lg text-xs space-y-0.5">
                  <span className="text-muted-foreground block text-[9px] uppercase font-semibold">Predicted Delay</span>
                  <span className="font-bold text-base text-foreground">{event.resolution_minutes} min</span>
                </div>
                <div className="bg-muted/30 border border-border/50 p-2.5 rounded-lg text-xs space-y-0.5">
                  <span className="text-muted-foreground block text-[9px] uppercase font-semibold">Actual Delay</span>
                  <span className="font-bold text-base text-foreground">{event.actual_delay_minutes} min</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/30 border border-border/50 p-2.5 rounded-lg text-xs space-y-0.5">
                  <span className="text-muted-foreground block text-[9px] uppercase font-semibold">Prediction Accuracy</span>
                  <span className="font-bold text-base text-emerald-600">{(accuracy || 0).toFixed(0)}%</span>
                </div>
                <div className="bg-muted/30 border border-border/50 p-2.5 rounded-lg text-xs space-y-0.5">
                  <span className="text-muted-foreground block text-[9px] uppercase font-semibold">Recommendation Effectiveness</span>
                  <span className="font-bold text-base text-primary">
                    {Math.max(0, ((event.resolution_minutes * 1.35 - event.actual_delay_minutes!) / (event.resolution_minutes * 1.35)) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground text-center pt-1.5 border-t border-border/40">
                Performance indicators stored in local SQLite database for future routing calibration.
              </div>
            </div>
          )}

          {/* AI Recommendations */}
          {recommendations.length > 0 && (
            <div className="mb-5">
              <div className="text-sm font-bold mb-2">AI Response Plan Executed</div>
              <ul className="space-y-2">
                {recommendations.map((rec: any, idx: number) => (
                  <li key={idx} className="text-sm bg-card border border-border p-2.5 rounded-lg">
                    <span className="font-semibold">{rec.action}</span>
                    <span className="text-muted-foreground ml-2">— {rec.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Simulate button */}
          <div className="mb-4">
            <Button
              variant="outline"
              className="gap-2 bg-primary/5 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground"
              onClick={e => { e.stopPropagation(); onSimulate(); }}
            >
              <Play className="h-4 w-4" /> Replay Simulation
            </Button>
          </div>

          {/* Review section */}
          <div className="border-t border-border pt-4">
            {hasReview ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Review: Actual delay was {event.actual_delay_minutes} min
                {event.actual_closures ? ' with closures' : ' without closures'}.
              </div>
            ) : event.status === 'completed' ? (
              reviewing ? (
                <div className="bg-card border border-border p-4 rounded-lg flex items-end gap-4 max-w-lg">
                  <div className="space-y-2 flex-1">
                    <Label htmlFor={`delay-${event.id}`}>Actual Delay (mins)</Label>
                    <Input
                      id={`delay-${event.id}`}
                      type="number"
                      value={delay}
                      onChange={e => setDelay(e.target.value)}
                      placeholder="e.g. 45"
                    />
                  </div>
                  <div className="flex items-center space-x-2 pb-2 px-2">
                    <Checkbox id={`closures-${event.id}`} checked={closures} onCheckedChange={c => setClosures(!!c)} />
                    <Label htmlFor={`closures-${event.id}`}>Closures Required</Label>
                  </div>
                  <Button onClick={handleReviewSubmit} disabled={reviewMutation.isPending || !delay}>
                    Submit
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setReviewing(true)}>
                  Add Post-Event Review
                </Button>
              )
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
