const locationService = require('./locationService');
const facilityService = require('./facilityService');
const routingService = require('./routingService');
const hazardService = require('./hazardService');
const trafficService = require('./trafficService');
const weatherService = require('./weatherService');
const engine = require('./emergencyRouteEngine');
const { nearestOnPolyline, bearing, destinationPoint, squareAround } = require('../utils/geo');
const { formatDistance, formatDuration } = require('../utils/format');
const { EMERGENCY_LABELS } = require('../utils/constants');
const { AppError } = require('../utils/errors');

/**
 * The Emergency Route Agent's tools. Every tool wraps a deterministic backend
 * service that talks to a real data source, records a trace step, and caches
 * its result for the lifetime of one agent run. Tools ensure their own
 * prerequisites, so they can be called in any order (by the fixed workflow or
 * by the LLM).
 */
class AgentToolbox {
  constructor({ emergencyType, origin, destination = null, facility = null, includeSimulated = false }) {
    this.emergencyType = emergencyType;
    this.origin = { ...origin };
    this.destination = destination ? { ...destination } : null;
    this.facility = facility;
    this.includeSimulated = includeSimulated;
    this.trace = [];
    this.state = {};
    this.pending = new Map();
  }

  /** Runs fn once per key; concurrent callers share the same promise. Failures are not cached. */
  memo(key, fn) {
    if (!this.pending.has(key)) {
      const promise = fn();
      this.pending.set(key, promise);
      promise.catch(() => this.pending.delete(key));
    }
    return this.pending.get(key);
  }

  async step(tool, label, fn) {
    const started = Date.now();
    const entry = { tool, label, status: 'ok', summary: '', durationMs: 0 };
    this.trace.push(entry);
    try {
      const { result, summary, status } = await fn();
      entry.summary = summary;
      if (status) entry.status = status;
      return result;
    } catch (err) {
      entry.status = 'error';
      entry.summary = err.message;
      throw err;
    } finally {
      entry.durationMs = Date.now() - started;
    }
  }

  /** Location Tool: validates the real device/manual coordinates and reverse-geocodes them. */
  getCurrentLocation() {
    return this.memo('location', () => this.step('getCurrentLocation', 'Location Tool', async () => {
      const coords = `${this.origin.lat.toFixed(5)}, ${this.origin.lng.toFixed(5)}`;
      let address = this.origin.address || null;
      let status;
      if (!address) {
        try {
          const geo = await locationService.reverseGeocode(this.origin);
          address = geo?.shortName || null;
        } catch {
          status = 'warning';
        }
      }
      this.origin.address = address;
      this.state.location = { ...this.origin };
      return {
        result: this.state.location,
        status,
        summary: address ? `Origin ${coords} resolved to "${address}".` : `Origin ${coords} (address lookup unavailable).`,
      };
    }));
  }

  /** Facility Search Tool: real facilities from OpenStreetMap, ranked by road ETA. */
  searchEmergencyFacilities({ categories } = {}) {
    return this.memo('facilities', () => this.step('searchEmergencyFacilities', 'Facility Search Tool', async () => {
      const result = await facilityService.searchFacilities({ center: this.origin, emergencyType: this.emergencyType, categories });
      this.state.facilities = result;
      return {
        result,
        status: result.facilities.length ? undefined : 'warning',
        summary: result.facilities.length
          ? `Found ${result.facilities.length} facilities (${result.categories.join(', ')}) within ${formatDistance(result.radius)} in OpenStreetMap${result.sourceId === 'nominatim' ? ' (Nominatim fallback: Overpass unavailable, list may be incomplete)' : ''}.`
          : `No ${result.categories.join('/')} found in OpenStreetMap within ${formatDistance(result.radius)}.`,
      };
    }));
  }

  /** Chooses the destination facility when the user asked for "nearest suitable". */
  selectDestinationFacility() {
    if (this.destination) return Promise.resolve(this.destination);
    return this.memo('selectFacility', async () => {
      const { facilities } = await this.searchEmergencyFacilities();
      return this.step('selectFacility', 'Facility Selection', async () => {
      const candidates = facilities.filter((f) => f.emergencyDepartment !== false);
      const pool = candidates.length ? candidates : facilities;
      if (!pool.length) {
        throw new AppError('No suitable emergency facility was found nearby. Please choose a destination manually.', 404, 'NO_FACILITY');
      }
      let chosen = pool[0];
      let why = 'fastest by road';
      const etaOf = (f) => f.roadDuration ?? Infinity;
      // For medical emergencies prefer a hospital over a clinic unless the clinic is >5 min sooner.
      if (this.emergencyType === 'medical' && chosen.category === 'clinic') {
        const hospital = pool.find((f) => f.category === 'hospital');
        if (hospital && etaOf(hospital) - etaOf(chosen) <= 300) {
          chosen = hospital;
          why = 'hospital preferred over a clinic (≤5 min difference)';
        }
      }
      // Medical/accident: prefer a facility explicitly tagged with an emergency department if ≤3 min slower.
      if (['medical', 'accident'].includes(this.emergencyType) && chosen.emergencyDepartment !== true) {
        const withEd = pool.find((f) => f.emergencyDepartment === true && f.category === 'hospital');
        if (withEd && etaOf(withEd) - etaOf(chosen) <= 180) {
          chosen = withEd;
          why = 'tagged with an emergency department in OSM (≤3 min slower than the fastest)';
        }
      }
      this.facility = chosen;
      this.destination = { lat: chosen.lat, lng: chosen.lng, name: chosen.displayName, address: chosen.address };
      const eta = chosen.roadDuration != null ? `, ETA ${formatDuration(chosen.roadDuration)} by road` : '';
      return {
        result: this.destination,
        summary: `Selected ${chosen.displayName} (${chosen.categoryLabel}${eta}; ${why}). Emergency department tag: ${
          chosen.emergencyDepartment === true ? 'yes' : chosen.emergencyDepartment === false ? 'no' : 'not specified in OSM'
        }.`,
      };
      });
    });
  }

  /** Routing Tool: route plus provider alternatives. */
  calculateRoute() {
    return this.memo('routes', async () => {
      await this.selectDestinationFacility();
      return this.step('calculateRoute', 'Routing Tool', async () => {
      // Copy: the routing service caches its results and we mutate labels / push detours.
      const routes = (await routingService.getRoutes(this.origin, this.destination, { alternatives: true, idPrefix: 'route' })).map((r) => ({ ...r }));
      routes.forEach((r, i) => { r.label = engine.routeLabel(i); });
      this.state.routes = routes;
      const p = routes[0];
      return {
        result: routes,
        summary: `${routingService.describeProvider().label} returned ${routes.length} route${routes.length > 1 ? 's' : ''}; primary ${formatDistance(p.distance)}, ${formatDuration(p.duration)}.`,
      };
      });
    });
  }

  async getAlternativeRoutes() {
    const routes = await this.calculateRoute();
    return routes.slice(1);
  }

  /** Hazard Tool: active hazards near the candidate routes and which routes they affect. */
  detectHazards() {
    return this.memo('hazards', async () => {
      const routes = await this.calculateRoute();
      return this.step('detectHazards', 'Hazard Tool', async () => {
      const hazardData = await hazardService.getActiveHazards({
        bbox: hazardService.bboxForRoutes(routes, 600),
        includeSimulated: this.includeSimulated,
      });
      const impacts = hazardService.findHazardsOnRoutes(routes, hazardData.hazards);
      this.state.hazardData = hazardData;
      this.state.hazardImpacts = impacts;
      const affected = Object.values(impacts).filter((list) => list.length).length;
      if (!hazardData.available) return { result: impacts, status: 'warning', summary: hazardData.note };
      const simulated = hazardData.hazards.filter((h) => h.isSimulated).length;
      return {
        result: impacts,
        summary: `${hazardData.hazards.length} active reported hazard(s) in the route area${simulated ? ` (${simulated} simulated)` : ''}; ${affected} of ${routes.length} route(s) affected.`,
      };
      });
    });
  }

  /** Weather risk along the trip (origin and destination). */
  getWeather() {
    return this.memo('weather', async () => {
      await this.selectDestinationFacility();
      return this.step('getWeather', 'Weather Tool', async () => {
      const weather = await weatherService.getWeatherRisk([this.origin, this.destination]);
      this.state.weather = weather;
      return {
        result: weather,
        status: weather.available ? undefined : 'warning',
        summary: weather.available ? `Open-Meteo: ${weather.condition}; driving weather risk ${weather.risk}.` : weather.note,
      };
      });
    });
  }

  /** Road conditions = reported hazards + weather. */
  async getRoadConditions() {
    const [hazardImpacts, weather] = await Promise.all([this.detectHazards(), this.getWeather()]);
    return { hazardImpacts, weather, hazardData: this.state.hazardData };
  }

  /** Traffic Tool. Honest about the absence of live traffic. */
  getTrafficInformation() {
    return this.memo('traffic', async () => {
      const routes = await this.calculateRoute();
      const impacts = await this.detectHazards();
      return this.step('getTrafficInformation', 'Traffic Tool', async () => {
      const traffic = trafficService.getTrafficInformation(routes, impacts);
      this.state.traffic = traffic;
      const reports = Object.values(traffic.reportedCongestion).flat().length;
      return {
        result: traffic,
        status: 'warning',
        summary: `Live traffic unavailable from configured providers. ${reports} user-reported congestion hazard(s) on candidate routes.`,
      };
      });
    });
  }

  /** Route Evaluation Tool: deterministic, explainable scoring. */
  evaluateRoute() {
    return this.memo('evaluation', async () => {
      const routes = await this.calculateRoute();
      const { hazardImpacts, weather, hazardData } = await this.getRoadConditions();
      const traffic = await this.getTrafficInformation();
      return this.step('evaluateRoute', 'Route Evaluation Tool', async () => {
      const evaluation = engine.evaluateRoutes({
        routes,
        hazardImpacts,
        traffic,
        weather,
        hazardData,
        emergencyType: this.emergencyType,
        facilityType: this.facility?.category,
      });
      this.state.evaluation = evaluation;
      return {
        result: evaluation,
        status: evaluation.allRoutesBlocked ? 'warning' : undefined,
        summary: evaluation.allRoutesBlocked
          ? 'All candidate routes pass a blocking hazard.'
          : `${evaluation.recommendedRoute} scores best (${evaluation.estimatedTimeText}, ${evaluation.distanceText}, risk ${evaluation.riskLevel}).`,
      };
      });
    });
  }

  /**
   * Rerouting Tool: generates detour candidates around blocking hazards.
   * OpenRouteService: avoid_polygons around the hazards.
   * OSRM (no avoid-area support): via-points offset perpendicular to the road on
   * both sides of the hazard, so the router is forced onto parallel roads.
   */
  recalculateRoute() {
    return this.memo('reroute', () => this.rerouteAroundBlockingHazards());
  }

  async rerouteAroundBlockingHazards() {
    const routes = await this.calculateRoute();
    let evaluation = await this.evaluateRoute();
    if (!evaluation.allRoutesBlocked) return evaluation;

    const tried = new Set();
    for (let round = 0; round < 2 && evaluation.allRoutesBlocked; round += 1) {
      const blocked = evaluation.evaluations.filter((e) => e.blocked).sort((a, b) => a.baseDuration - b.baseDuration)[0];
      const hazard = blocked?.hazards.find((h) => h.blocking && !tried.has(h.id));
      if (!hazard) break;
      tried.add(hazard.id);

      // eslint-disable-next-line no-await-in-loop
      const added = await this.step('recalculateRoute', 'Rerouting Tool', async () => {
        const detours = await this.generateDetours(routes.find((r) => r.id === blocked.routeId), hazard, evaluation);
        const fresh = detours.filter(
          (d) => !routes.some((r) => Math.abs(r.distance - d.distance) < 30 && Math.abs(r.duration - d.duration) < 10),
        );
        fresh.forEach((d) => {
          d.label = `${engine.routeLabel(routes.length)} (detour)`;
          d.isDetour = true;
          routes.push(d);
        });
        return {
          result: fresh.length,
          status: fresh.length ? undefined : 'warning',
          summary: fresh.length
            ? `Generated ${fresh.length} detour candidate(s) around ${hazard.type} (${hazard.severity}).`
            : `Could not generate a detour around ${hazard.type} (${hazard.severity}).`,
        };
      });
      if (!added) break;
      // Re-run hazard detection and evaluation including the new candidates.
      // eslint-disable-next-line no-await-in-loop
      evaluation = await this.reEvaluate();
    }
    return evaluation;
  }

  reEvaluate() {
    for (const key of ['hazards', 'traffic', 'evaluation']) this.pending.delete(key);
    return this.evaluateRoute();
  }

  async generateDetours(route, hazard, evaluation) {
    const hazardPoint = { lat: hazard.latitude, lng: hazard.longitude };
    const radius = (this.state.hazardData?.hazards.find((h) => h.id === hazard.id)?.radiusMeters) || 150;
    const blockingHazards = evaluation.evaluations
      .flatMap((e) => e.hazards)
      .filter((h, i, arr) => h.blocking && arr.findIndex((x) => x.id === h.id) === i);

    if (routingService.supportsAvoidAreas()) {
      const polygons = blockingHazards.map((h) => squareAround({ lat: h.latitude, lng: h.longitude }, radius * 1.5));
      try {
        const avoided = await routingService.getRoutes(this.origin, this.destination, { avoidPolygons: polygons, idPrefix: 'avoid' });
        return avoided.map((r) => ({ ...r }));
      } catch {
        return [];
      }
    }

    const near = nearestOnPolyline(hazardPoint, route.geometry);
    const a = route.geometry[near.segmentIndex];
    const b = route.geometry[near.segmentIndex + 1] || a;
    const roadBearing = bearing({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
    const vias = [];
    for (const offset of [radius + 350, radius + 900]) {
      for (const side of [90, -90]) vias.push(destinationPoint(hazardPoint, roadBearing + side, offset));
    }
    const results = await Promise.allSettled(
      vias.map((via, i) => routingService.getRoutes(this.origin, this.destination, { via: [via], alternatives: false, idPrefix: `detour-${hazard.id}-${i}` })),
    );
    return results.filter((r) => r.status === 'fulfilled' && r.value[0]).map((r) => ({ ...r.value[0] }));
  }

  /** Compact, geometry-free view of the routes for the LLM. */
  routeSummaries() {
    return (this.state.routes || []).map((r) => ({
      route_id: r.id,
      label: r.label,
      distance_km: Number((r.distance / 1000).toFixed(2)),
      duration_min: Number((r.duration / 60).toFixed(1)),
      via_roads: r.summary || null,
      is_detour: Boolean(r.isDetour),
    }));
  }

  context() {
    return {
      emergency_type: this.emergencyType,
      emergency_label: EMERGENCY_LABELS[this.emergencyType],
      origin: { lat: this.origin.lat, lng: this.origin.lng, address: this.origin.address || null },
      destination: this.destination
        ? { lat: this.destination.lat, lng: this.destination.lng, name: this.destination.name || null, address: this.destination.address || null }
        : null,
      destination_facility: this.facility
        ? { name: this.facility.name, category: this.facility.categoryLabel, emergency_department: this.facility.emergencyDepartment }
        : null,
      simulation_mode: this.includeSimulated,
    };
  }
}

module.exports = AgentToolbox;
