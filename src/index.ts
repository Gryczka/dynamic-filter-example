/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc` (or `wrangler.toml`). After adding bindings,
 * a type definition for the `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// Define the structure for your environment variables (bindings)
interface Env {
	FILTER_RULES_KV: KVNamespace;
	RULE_ANALYTICS: AnalyticsEngineDataset; // Add Analytics Engine binding
	// Add other bindings if you have them
}

// Define the structure of a filter rule
interface Rule {
	id: string;
	description: string;
	target: 'header' | 'url' | 'method';
	property?: string; // e.g., Header name, or "pathname", "search", "host", "href" for URL
	condition: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'exists';
	value?: string; // Value to check against (not used for "exists" on headers)
	action: 'block'; // Currently only supporting "block"
}

/**
 * Evaluates a single rule against the incoming request.
 * @param request The incoming Request object.
 * @param rule The rule to evaluate.
 * @returns True if the rule matches, false otherwise.
 */
function evaluateRule(request: Request, rule: Rule): boolean {
	const url = new URL(request.url);
	let subject: string | null = null;

	switch (rule.target) {
		case 'header':
			if (!rule.property) {
				console.warn(`Rule ${rule.id}: Header target missing property.`);
				return false;
			}
			if (rule.condition === 'exists') {
				return request.headers.has(rule.property);
			}
			subject = request.headers.get(rule.property);
			break;
		case 'url':
			if (rule.condition === 'exists') {
				// 'exists' is not typically used for URL parts as they always exist (though may be empty)
				console.warn(`Rule ${rule.id}: 'exists' condition not well-defined for URL target.`);
				return false;
			}
			switch (rule.property) {
				case 'pathname':
					subject = url.pathname;
					break;
				case 'search': // Includes the leading '?'
					subject = url.search;
					break;
				case 'host':
					subject = url.host;
					break;
				case 'href':
					subject = url.href;
					break;
				default: // Default to pathname if property is unspecified or unknown
					subject = url.pathname;
					break;
			}
			break;
		case 'method':
			if (rule.condition === 'exists') {
				console.warn(`Rule ${rule.id}: 'exists' condition not applicable for method target.`);
				return false;
			}
			subject = request.method;
			break;
		default:
			console.error(`Rule ${rule.id}: Unknown target '${rule.target}'.`);
			return false;
	}

	// If subject is null (e.g., header not found) and condition wasn't 'exists' (which is handled for headers)
	if (subject === null) {
		return false;
	}

	// For string-based conditions, a string value is required
	if (rule.condition !== 'exists' && typeof rule.value !== 'string') {
		console.warn(`Rule ${rule.id}: Condition '${rule.condition}' requires a string value, but got '${typeof rule.value}'.`);
		return false;
	}

	switch (rule.condition) {
		case 'equals':
			return subject === rule.value;
		case 'contains':
			return subject.includes(rule.value!);
		case 'startsWith':
			return subject.startsWith(rule.value!);
		case 'endsWith':
			return subject.endsWith(rule.value!);
		// 'exists' for headers is handled above. Other 'exists' cases are filtered out or handled if rule.property is defined for header.
		// For other targets, 'exists' is already filtered out as not applicable or not well-defined.
		default:
			// This case should ideally not be reached if all conditions are handled above
			// and 'exists' is pre-filtered for non-header targets or when property is missing for headers.
			// However, to be safe and handle any unexpected rule.condition values:
			if (rule.condition === 'exists') {
				// This specific 'exists' case should have been handled earlier (e.g. for headers)
				// or deemed not applicable (e.g. for URL properties like pathname which always exist).
				// If we reach here with 'exists', it implies a logic flaw or an unhandled scenario.
				console.warn(`Rule ${rule.id}: Unhandled 'exists' condition for target '${rule.target}' and property '${rule.property}'.`);
				return false; // Or true, depending on desired default behavior for unhandled 'exists'
			}
			console.warn(`Rule ${rule.id}: Unknown or unhandled condition '${rule.condition}'.`);
			return false;
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		let rules: Rule[] = [];
		const rulesKey = 'FILTERING_RULES'; // Key where rules are stored in KV

		try {
			const rulesJson = await env.FILTER_RULES_KV.get(rulesKey);
			if (rulesJson) {
				const parsedRules = JSON.parse(rulesJson);
				if (Array.isArray(parsedRules)) {
					rules = parsedRules;
				} else {
					console.error(`Rules from KV ('${rulesKey}') are not an array. Proceeding without rules.`);
				}
			} else {
				console.log(`No rules found in KV at key '${rulesKey}'.`);
			}
		} catch (e: any) {
			console.error(`Failed to fetch or parse rules from KV ('${rulesKey}'): ${e.message}`);
		}

		const requestClone = request.clone(); // Clone request for analytics if needed for rule evaluation details

		for (const rule of rules) {
			if (rule.action === 'block') {
				if (evaluateRule(request, rule)) {
					console.log(`Request blocked by rule ID: ${rule.id} ('${rule.description}')`);

					// Log to Workers Analytics Engine
					ctx.waitUntil(
						(async () => {
							try {
								if (env.RULE_ANALYTICS) {
									env.RULE_ANALYTICS.writeDataPoint({
										indexes: [rule.id], // Indexed for querying by rule ID
										blobs: [
											requestClone.url,
											rule.description,
											requestClone.headers.get('User-Agent') || '',
											requestClone.headers.get('CF-Connecting-IP') || '',
											new Date().toISOString(),
										],
										doubles: [1], // Count for this execution
									});
									console.log(`Logged execution of rule ${rule.id} to Analytics Engine.`);
								} else {
									console.warn('RULE_ANALYTICS binding not available. Skipping analytics logging.');
								}
							} catch (analyticsError: any) {
								console.error(`Failed to log to Analytics Engine: ${analyticsError.message}`);
							}
						})()
					);

					return new Response('Forbidden: Access denied by security policy.', { status: 403 });
				}
			}
		}

		// If no rules blocked the request, proceed with original/allowed logic
		return new Response('Hello World! Request allowed.');
	},
} satisfies ExportedHandler<Env>;
