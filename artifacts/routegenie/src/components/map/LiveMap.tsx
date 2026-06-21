import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, CircleMarker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Hotspot, Event } from '@workspace/api-client-react';
import { getRiskColor } from '@/lib/constants';

// Fix leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface LiveMapProps {
  hotspots?: Hotspot[];
  selectedEvent?: Event | null;
  interactive?: boolean;
  onLocationSelect?: (lat: number, lng: number) => void;
  center?: [number, number];
  zoom?: number;
  impactRadius?: number;
  riskScore?: number;
  mode?: 'without' | 'with';
  diversionPath?: string[];
}

function MapUpdater({ center, zoom }: { center?: [number, number], zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom || map.getZoom(), { animate: true });
    }
  }, [center, zoom, map]);
  return null;
}

export function LiveMap({
  hotspots = [],
  selectedEvent,
  center = [12.9716, 77.5946], // Bengaluru center
  zoom = 12,
  mode = 'without',
  diversionPath = []
}: LiveMapProps) {
  const [junctionCoords, setJunctionCoords] = useState<Record<string, { lat: number, lng: number }>>({});
  const [corridorConnections, setCorridorConnections] = useState<Record<string, { start: string, end: string }>>({});

  useEffect(() => {
    fetch('/api/junction_coords')
      .then(res => res.json())
      .then(data => setJunctionCoords(data))
      .catch(err => console.error("Error loading junction coordinates:", err));

    fetch('/api/corridor_connections')
      .then(res => res.json())
      .then(data => setCorridorConnections(data))
      .catch(err => console.error("Error loading corridor connections:", err));
  }, []);

  // Custom marker for selected event
  const eventIcon = new L.Icon({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIcon2x,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  // Calculate corridor impact styling
  const getCorridorStyle = (corridorName: string) => {
    if (!selectedEvent) {
      return { color: '#4B5563', weight: 2.5, opacity: 0.5 };
    }

    const eventCorridor = selectedEvent.corridor;
    const isDiversionActive = mode === 'with';
    
    // Check if this corridor is part of the diversion route
    if (isDiversionActive && diversionPath.includes(corridorName)) {
      return { 
        color: '#2563EB', 
        weight: 5, 
        opacity: 0.9, 
        className: 'corridor-glow-blue' 
      };
    }

    if (corridorName === eventCorridor) {
      return { 
        color: '#DC2626', 
        weight: 6, 
        opacity: 0.9, 
        className: 'corridor-glow-red' 
      };
    }

    // Proximity Analysis (Find direct neighbors of the event corridor)
    const eventConn = corridorConnections[eventCorridor];
    const currentConn = corridorConnections[corridorName];

    if (eventConn && currentConn) {
      const shareJunction = 
        currentConn.start === eventConn.start || 
        currentConn.end === eventConn.start || 
        currentConn.start === eventConn.end || 
        currentConn.end === eventConn.end;

      if (shareJunction) {
        return { 
          color: '#EA580C', 
          weight: 4.5, 
          opacity: 0.8, 
          className: 'corridor-glow-orange' 
        };
      }
      
      // Secondary neighbors (1 step removed)
      // Check if current corridor shares a junction with any neighbor of the event corridor
      let isSecondary = false;
      for (const [name, conn] of Object.entries(corridorConnections)) {
        if (name === eventCorridor || name === corridorName) continue;
        const sharesWithEvent = conn.start === eventConn.start || conn.end === eventConn.start || conn.start === eventConn.end || conn.end === eventConn.end;
        if (sharesWithEvent) {
          const sharesWithCurrent = conn.start === currentConn.start || conn.end === currentConn.start || conn.start === currentConn.end || conn.end === currentConn.end;
          if (sharesWithCurrent) {
            isSecondary = true;
            break;
          }
        }
      }

      if (isSecondary) {
        return { 
          color: '#EAB308', 
          weight: 3.5, 
          opacity: 0.7 
        };
      }
    }

    // Default corridor flow
    return { color: '#16A34A', weight: 2.5, opacity: 0.4 };
  };

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer 
        center={center} 
        zoom={zoom} 
        className="w-full h-full"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="map-tiles grayscale"
        />
        
        <MapUpdater center={center} zoom={zoom} />

        {/* Dynamic Corridors */}
        {Object.entries(corridorConnections).map(([name, conn]) => {
          const startPt = junctionCoords[conn.start];
          const endPt = junctionCoords[conn.end];
          
          if (!startPt || !endPt) return null;
          const style = getCorridorStyle(name);

          // Build description for popup
          let statusDesc = "Normal Traffic Flow";
          if (name === selectedEvent?.corridor) {
            statusDesc = "CORE IMPACT: High Congestion / Blockage Point";
          } else if (style.className === 'corridor-glow-orange') {
            statusDesc = "SECONDARY IMPACT: Heavy Queuing / Spillover Risk";
          } else if (style.color === '#EAB308') {
            statusDesc = "TERTIARY WARNING: Congestion Buffer Zone";
          } else if (style.className === 'corridor-glow-blue') {
            statusDesc = "ACTIVE DETOUR: AI Rerouted Flow";
          }

          return (
            <Polyline
              key={`corridor-${name}`}
              positions={[
                [startPt.lat, startPt.lng],
                [endPt.lat, endPt.lng]
              ]}
              pathOptions={style}
            >
              <Popup>
                <div className="text-sm font-bold">{name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{statusDesc}</div>
                <div className="text-[10px] mt-1 text-muted-foreground/80">Connects: {conn.start} ⇆ {conn.end}</div>
              </Popup>
            </Polyline>
          );
        })}

        {/* Hotspots */}
        {hotspots.map((hotspot) => (
          <CircleMarker
            key={`hotspot-${hotspot.cluster_id}`}
            center={[hotspot.lat, hotspot.lng]}
            radius={Math.max(8, hotspot.risk_score / 5)}
            pathOptions={{
              color: getRiskColor(hotspot.risk_score),
              fillColor: getRiskColor(hotspot.risk_score),
              fillOpacity: 0.6,
              weight: 2,
            }}
            className="hotspot-marker"
          >
            <Popup>
              <div className="text-sm font-medium">Risk Score: {hotspot.risk_score.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Cluster Count: {hotspot.count}</div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Selected Event Marker */}
        {selectedEvent && (
          <Marker 
            position={[selectedEvent.latitude, selectedEvent.longitude]}
            icon={eventIcon}
          >
            <Popup>
              <div className="font-bold">{selectedEvent.event_name}</div>
              <div className="text-xs text-muted-foreground mt-1">Cause: {selectedEvent.event_cause_ui}</div>
            </Popup>
          </Marker>
        )}

        {/* Concentric Impact Rings (Concentric Rings / Heat Zones / Glow Effect) */}
        {selectedEvent && (
          <>
            {/* Core Impact Ring - Red (400m) */}
            <Circle
              center={[selectedEvent.latitude, selectedEvent.longitude]}
              radius={400}
              pathOptions={{
                color: '#DC2626',
                fillColor: '#DC2626',
                fillOpacity: 0.35,
                weight: 1.5,
                dashArray: '4, 4'
              }}
            />
            {/* Spillover Warning Ring - Orange (1000m) */}
            <Circle
              center={[selectedEvent.latitude, selectedEvent.longitude]}
              radius={1000}
              pathOptions={{
                color: '#EA580C',
                fillColor: '#EA580C',
                fillOpacity: 0.15,
                weight: 1,
                dashArray: '6, 6'
              }}
            />
            {/* Advisory Ring - Yellow (1800m) */}
            <Circle
              center={[selectedEvent.latitude, selectedEvent.longitude]}
              radius={1800}
              pathOptions={{
                color: '#EAB308',
                fillColor: '#EAB308',
                fillOpacity: 0.08,
                weight: 1,
                dashArray: '8, 8'
              }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
