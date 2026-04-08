/**
 * Service Status Service
 * Checks status pages for major tech services (cloud, dev tools, comms, AI, SaaS).
 * Returns aggregated status with summary counts.
 */

interface ServiceConfig {
  id: string;
  name: string;
  statusPage: string;
  customParser?: string;
  category: string;
}

interface ServiceStatus {
  id: string;
  name: string;
  category: string;
  status: string;
  description: string;
}

interface StatusResult {
  success: boolean;
  timestamp: string;
  summary: {
    operational: number;
    degraded: number;
    outage: number;
    unknown: number;
  };
  services: ServiceStatus[];
}

const SERVICES: ServiceConfig[] = [
  // Cloud Providers
  { id: 'aws', name: 'AWS', statusPage: 'https://health.aws.amazon.com/health/status', customParser: 'aws', category: 'cloud' },
  { id: 'azure', name: 'Azure', statusPage: 'https://azure.status.microsoft/en-us/status/feed/', customParser: 'rss', category: 'cloud' },
  { id: 'gcp', name: 'Google Cloud', statusPage: 'https://status.cloud.google.com/incidents.json', customParser: 'gcp', category: 'cloud' },
  { id: 'cloudflare', name: 'Cloudflare', statusPage: 'https://www.cloudflarestatus.com/api/v2/status.json', category: 'cloud' },
  { id: 'vercel', name: 'Vercel', statusPage: 'https://www.vercel-status.com/api/v2/status.json', category: 'cloud' },
  { id: 'netlify', name: 'Netlify', statusPage: 'https://www.netlifystatus.com/api/v2/status.json', category: 'cloud' },
  { id: 'digitalocean', name: 'DigitalOcean', statusPage: 'https://status.digitalocean.com/api/v2/status.json', category: 'cloud' },
  { id: 'render', name: 'Render', statusPage: 'https://status.render.com/api/v2/status.json', category: 'cloud' },
  { id: 'railway', name: 'Railway', statusPage: 'https://railway.instatus.com/summary.json', customParser: 'instatus', category: 'cloud' },

  // Developer Tools
  { id: 'github', name: 'GitHub', statusPage: 'https://www.githubstatus.com/api/v2/status.json', category: 'dev' },
  { id: 'gitlab', name: 'GitLab', statusPage: 'https://status.gitlab.com/1.0/status/5b36dc6502d06804c08349f7', customParser: 'statusio', category: 'dev' },
  { id: 'npm', name: 'npm', statusPage: 'https://status.npmjs.org/api/v2/status.json', category: 'dev' },
  { id: 'docker', name: 'Docker Hub', statusPage: 'https://www.dockerstatus.com/1.0/status/533c6539221ae15e3f000031', customParser: 'statusio', category: 'dev' },
  { id: 'bitbucket', name: 'Bitbucket', statusPage: 'https://bitbucket.status.atlassian.com/api/v2/status.json', category: 'dev' },
  { id: 'circleci', name: 'CircleCI', statusPage: 'https://status.circleci.com/api/v2/status.json', category: 'dev' },
  { id: 'jira', name: 'Jira', statusPage: 'https://jira-software.status.atlassian.com/api/v2/status.json', category: 'dev' },
  { id: 'confluence', name: 'Confluence', statusPage: 'https://confluence.status.atlassian.com/api/v2/status.json', category: 'dev' },
  { id: 'linear', name: 'Linear', statusPage: 'https://linearstatus.com/api/v2/status.json', customParser: 'incidentio', category: 'dev' },

  // Communication
  { id: 'slack', name: 'Slack', statusPage: 'https://slack-status.com/api/v2.0.0/current', customParser: 'slack', category: 'comm' },
  { id: 'discord', name: 'Discord', statusPage: 'https://discordstatus.com/api/v2/status.json', category: 'comm' },
  { id: 'zoom', name: 'Zoom', statusPage: 'https://www.zoomstatus.com/api/v2/status.json', category: 'comm' },
  { id: 'notion', name: 'Notion', statusPage: 'https://www.notion-status.com/api/v2/status.json', category: 'comm' },

  // AI Services
  { id: 'openai', name: 'OpenAI', statusPage: 'https://status.openai.com/api/v2/status.json', customParser: 'incidentio', category: 'ai' },
  { id: 'anthropic', name: 'Anthropic', statusPage: 'https://status.claude.com/api/v2/status.json', customParser: 'incidentio', category: 'ai' },
  { id: 'replicate', name: 'Replicate', statusPage: 'https://www.replicatestatus.com/api/v2/status.json', customParser: 'incidentio', category: 'ai' },

  // SaaS
  { id: 'stripe', name: 'Stripe', statusPage: 'https://status.stripe.com/current', customParser: 'stripe', category: 'saas' },
  { id: 'twilio', name: 'Twilio', statusPage: 'https://status.twilio.com/api/v2/status.json', category: 'saas' },
  { id: 'datadog', name: 'Datadog', statusPage: 'https://status.datadoghq.com/api/v2/status.json', category: 'saas' },
  { id: 'sentry', name: 'Sentry', statusPage: 'https://status.sentry.io/api/v2/status.json', category: 'saas' },
  { id: 'supabase', name: 'Supabase', statusPage: 'https://status.supabase.com/api/v2/status.json', category: 'saas' },
];

function normalizeStatus(indicator: string): string {
  if (!indicator) return 'unknown';
  const val = indicator.toLowerCase();
  if (val === 'none' || val === 'operational' || val.includes('all systems operational')) {
    return 'operational';
  }
  if (val === 'minor' || val === 'degraded_performance' || val === 'partial_outage' || val.includes('degraded')) {
    return 'degraded';
  }
  if (val === 'major' || val === 'major_outage' || val === 'critical' || val.includes('outage')) {
    return 'outage';
  }
  return 'unknown';
}

async function checkStatusPage(service: ServiceConfig): Promise<ServiceStatus> {
  if (!service.statusPage) {
    return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: 'No API available' };
  }

  try {
    const headers: Record<string, string> = {
      'Accept': service.customParser === 'rss' ? 'application/xml, text/xml' : 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    };
    if (service.customParser !== 'incidentio') {
      headers['User-Agent'] = 'Mozilla/5.0 (compatible; GlobalIntel/1.0)';
    }

    const response = await fetch(service.statusPage, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: `HTTP ${response.status}` };
    }

    if (service.customParser === 'gcp') {
      const data = await response.json();
      const activeIncidents = Array.isArray(data) ? data.filter((i: any) =>
        i.end === undefined || new Date(i.end) > new Date()
      ) : [];
      if (activeIncidents.length === 0) {
        return { id: service.id, name: service.name, category: service.category, status: 'operational', description: 'All services operational' };
      }
      const severity = activeIncidents.some((i: any) => i.severity === 'high') ? 'outage' : 'degraded';
      return { id: service.id, name: service.name, category: service.category, status: severity, description: `${activeIncidents.length} active incident(s)` };
    }

    if (service.customParser === 'aws') {
      return { id: service.id, name: service.name, category: service.category, status: 'operational', description: 'Status page reachable' };
    }

    if (service.customParser === 'rss') {
      const text = await response.text();
      const hasRecentIncident = text.includes('<item>') &&
        (text.includes('degradation') || text.includes('outage') || text.includes('incident'));
      return {
        id: service.id, name: service.name, category: service.category,
        status: hasRecentIncident ? 'degraded' : 'operational',
        description: hasRecentIncident ? 'Recent incidents reported' : 'No recent incidents',
      };
    }

    if (service.customParser === 'instatus') {
      const data = await response.json();
      const pageStatus = data.page?.status;
      if (pageStatus === 'UP') {
        return { id: service.id, name: service.name, category: service.category, status: 'operational', description: 'All systems operational' };
      } else if (pageStatus === 'HASISSUES') {
        return { id: service.id, name: service.name, category: service.category, status: 'degraded', description: 'Some issues reported' };
      }
      return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: pageStatus || 'Unknown' };
    }

    if (service.customParser === 'statusio') {
      const data = await response.json();
      const overall = data.result?.status_overall;
      const statusCode = overall?.status_code;
      if (statusCode === 100) {
        return { id: service.id, name: service.name, category: service.category, status: 'operational', description: overall.status || 'All systems operational' };
      } else if (statusCode >= 300 && statusCode < 500) {
        return { id: service.id, name: service.name, category: service.category, status: 'degraded', description: overall.status || 'Degraded performance' };
      } else if (statusCode >= 500) {
        return { id: service.id, name: service.name, category: service.category, status: 'outage', description: overall.status || 'Service disruption' };
      }
      return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: overall?.status || 'Unknown status' };
    }

    if (service.customParser === 'slack') {
      const data = await response.json();
      if (data.status === 'ok') {
        return { id: service.id, name: service.name, category: service.category, status: 'operational', description: 'All systems operational' };
      } else if (data.status === 'active' || data.active_incidents?.length > 0) {
        const count = data.active_incidents?.length || 1;
        return { id: service.id, name: service.name, category: service.category, status: 'degraded', description: `${count} active incident(s)` };
      }
      return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: data.status || 'Unknown' };
    }

    if (service.customParser === 'stripe') {
      const data = await response.json();
      if (data.largestatus === 'up') {
        return { id: service.id, name: service.name, category: service.category, status: 'operational', description: data.message || 'All systems operational' };
      } else if (data.largestatus === 'degraded') {
        return { id: service.id, name: service.name, category: service.category, status: 'degraded', description: data.message || 'Degraded performance' };
      } else if (data.largestatus === 'down') {
        return { id: service.id, name: service.name, category: service.category, status: 'outage', description: data.message || 'Service disruption' };
      }
      return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: data.message || 'Unknown' };
    }

    if (service.customParser === 'incidentio') {
      const text = await response.text();
      if (text.startsWith('<!') || text.startsWith('<html')) {
        const operationalMatch = text.match(/All Systems Operational|fully operational|no issues/i);
        if (operationalMatch) {
          return { id: service.id, name: service.name, category: service.category, status: 'operational', description: 'All systems operational' };
        }
        const degradedMatch = text.match(/degraded|partial outage|experiencing issues/i);
        if (degradedMatch) {
          return { id: service.id, name: service.name, category: service.category, status: 'degraded', description: 'Some issues reported' };
        }
        return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: 'Could not parse status' };
      }
      try {
        const data = JSON.parse(text);
        const indicator = data.status?.indicator || '';
        const description = data.status?.description || '';
        if (indicator === 'none' || description.toLowerCase().includes('operational')) {
          return { id: service.id, name: service.name, category: service.category, status: 'operational', description: description || 'All systems operational' };
        } else if (indicator === 'minor' || indicator === 'maintenance') {
          return { id: service.id, name: service.name, category: service.category, status: 'degraded', description: description || 'Minor issues' };
        } else if (indicator === 'major' || indicator === 'critical') {
          return { id: service.id, name: service.name, category: service.category, status: 'outage', description: description || 'Major outage' };
        }
        return { id: service.id, name: service.name, category: service.category, status: 'operational', description: description || 'Status OK' };
      } catch {
        return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: 'Invalid response' };
      }
    }

    const text = await response.text();

    if (text.startsWith('<!') || text.startsWith('<html')) {
      return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: 'Blocked by service' };
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: 'Invalid JSON response' };
    }

    let status: string;
    let description: string;

    if (data.status?.indicator !== undefined) {
      status = normalizeStatus(data.status.indicator);
      description = data.status.description || '';
    } else if (data.status?.status) {
      status = data.status.status === 'ok' ? 'operational' : 'degraded';
      description = data.status.description || '';
    } else if (data.page && data.status) {
      status = normalizeStatus(data.status.indicator || data.status.description);
      description = data.status.description || 'Status available';
    } else {
      status = 'unknown';
      description = 'Unknown format';
    }

    return { id: service.id, name: service.name, category: service.category, status, description };
  } catch (error: any) {
    return { id: service.id, name: service.name, category: service.category, status: 'unknown', description: error.message || 'Request failed' };
  }
}

export async function getServiceStatus(params?: {
  category?: string;
}): Promise<StatusResult> {
  const category = params?.category;

  let servicesToCheck = SERVICES;
  if (category && category !== 'all') {
    servicesToCheck = SERVICES.filter((s) => s.category === category);
  }

  const results = await Promise.all(servicesToCheck.map(checkStatusPage));

  const statusOrder: Record<string, number> = { outage: 0, degraded: 1, unknown: 2, operational: 3 };
  results.sort((a, b) => (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2));

  const summary = {
    operational: results.filter((r) => r.status === 'operational').length,
    degraded: results.filter((r) => r.status === 'degraded').length,
    outage: results.filter((r) => r.status === 'outage').length,
    unknown: results.filter((r) => r.status === 'unknown').length,
  };

  return {
    success: true,
    timestamp: new Date().toISOString(),
    summary,
    services: results,
  };
}
