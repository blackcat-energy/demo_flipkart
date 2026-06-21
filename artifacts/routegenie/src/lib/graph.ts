export interface JunctionNode {
  name: string;
  lat: number;
  lng: number;
}

export interface CorridorEdge {
  name: string;
  start: string;
  end: string;
  baseWeight: number;
  currentVolume: number;
  capacity: number;
}

export class TrafficGraph {
  junctions: Record<string, JunctionNode> = {};
  corridors: Record<string, CorridorEdge> = {};

  constructor(
    junctions: Record<string, JunctionNode>,
    corridors: Record<string, { start: string, end: string }>
  ) {
    this.junctions = junctions;
    
    // Initialize edges
    for (const [name, conn] of Object.entries(corridors)) {
      const startNode = junctions[conn.start];
      const endNode = junctions[conn.end];
      let dist = 1.0;
      if (startNode && endNode) {
        dist = this.haversine(startNode.lat, startNode.lng, endNode.lat, endNode.lng);
      }
      this.corridors[name] = {
        name,
        start: conn.start,
        end: conn.end,
        baseWeight: dist,
        currentVolume: 0,
        capacity: 40 // adjusted capacity for dynamic redistribution
      };
    }
  }

  haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Update volume of a corridor
  updateVolume(corridorName: string, change: number) {
    if (this.corridors[corridorName]) {
      this.corridors[corridorName].currentVolume = Math.max(0, this.corridors[corridorName].currentVolume + change);
    }
  }

  // Reset volumes
  resetVolumes() {
    for (const edge of Object.values(this.corridors)) {
      edge.currentVolume = 0;
    }
  }

  // Get dynamic weight (BPR formula)
  getEdgeWeight(corridorName: string, isBlocked: boolean = false): number {
    const edge = this.corridors[corridorName];
    if (!edge) return Infinity;
    if (isBlocked) return Infinity; // complete block
    
    const alpha = 0.50; // increased sensitivity for immediate visual routing redistribution
    const beta = 4.0;
    const ratio = edge.currentVolume / edge.capacity;
    // BPR Congestion Weight: t = t0 * (1 + alpha * (V/C)^beta)
    return edge.baseWeight * (1 + alpha * Math.pow(ratio, beta));
  }

  // Dijkstra algorithm to find path (list of corridor names)
  findPath(startJunction: string, endJunction: string, blockedCorridors: Set<string> = new Set()): string[] {
    const dists: Record<string, number> = {};
    const prev: Record<string, { node: string, edge: string } | null> = {};
    const unvisited = new Set<string>();

    for (const name of Object.keys(this.junctions)) {
      dists[name] = Infinity;
      prev[name] = null;
      unvisited.add(name);
    }

    if (!this.junctions[startJunction]) {
      return [];
    }
    dists[startJunction] = 0;

    while (unvisited.size > 0) {
      // Find min dist node in unvisited
      let curr: string | null = null;
      let minDist = Infinity;
      for (const node of unvisited) {
        if (dists[node] < minDist) {
          minDist = dists[node];
          curr = node;
        }
      }

      if (curr === null || curr === endJunction || dists[curr] === Infinity) {
        break;
      }

      unvisited.delete(curr);

      for (const edge of Object.values(this.corridors)) {
        const neighbor =
          edge.start === curr ? edge.end :
          edge.end === curr ? edge.start :
          null;

        if (!neighbor || !unvisited.has(neighbor)) continue;

        const isBlocked = blockedCorridors.has(edge.name);
        const weight = this.getEdgeWeight(edge.name, isBlocked);
        const alt = dists[curr] + weight;

        if (alt < dists[neighbor]) {
          dists[neighbor] = alt;
          prev[neighbor] = { node: curr, edge: edge.name };
        }
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let curr = endJunction;
    while (prev[curr] !== null) {
      const step = prev[curr]!;
      path.unshift(step.edge);
      curr = step.node;
    }

    return path;
  }
}
