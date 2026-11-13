import { DEFAULT_INCIDENT_TYPES } from './takcad-client.ts';

// The incident types a dispatcher can choose (standalone), in the order the New Incident form lists them:
// the built-in ones, then the custom ones from Dispatcher Settings, with Other last. A type may carry a
// short code for the command line (`N mva, 120 main`); none has one yet.
export interface IncidentTypeOption {
    code: string;   // '' when the type has none
    name: string;
}

// `settings` is what getDispatcherSettings() returns.
export function incidentTypeOptions(settings: Record<string, unknown>): IncidentTypeOption[] {
    const list = settings.incident_types;
    const custom = Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : [];
    const extra = custom.filter(t => !DEFAULT_INCIDENT_TYPES.includes(t)).sort();
    const base = DEFAULT_INCIDENT_TYPES.filter(t => t !== 'Other');
    return [...base, ...extra, 'Other'].map(name => ({ code: '', name }));
}
